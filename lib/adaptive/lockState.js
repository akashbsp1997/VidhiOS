// lib/adaptive/lockState.js
//
// The single shared "is this subtopic locked for this user" helper --
// every route that needs to enforce (not just display) the subtopic-chain
// gate calls this instead of recomputing paper order itself, so the
// dashboard's displayed order and server-side enforcement can never drift
// apart. DB-touching (unlike lib/adaptive/unlocks.js, which stays pure).

import { eq, inArray } from "drizzle-orm";
import { db } from "../db.js";
import { subtopics, mastery, sources, pyqs } from "../../db/schema.js";
import { computeDifficultyScore, orderSubtopicsWithinPaper, computeSubtopicLocks } from "./unlocks.js";

/**
 * Loads every subtopic in (subjectId, paper), computes the same
 * basics-to-advanced order the dashboard shows, and returns
 * Map<subtopicId, lockInfo> for this user. lockInfo: { locked,
 * requiredSubtopicId, requiredSubtopicText, requiredMasteryPct,
 * currentMasteryPct, difficultyScore }.
 */
export async function loadPaperLockMap(userId, subjectId, paper) {
  const paperSubtopics = await db
    .select()
    .from(subtopics)
    .where(eq(subtopics.subjectId, subjectId));
  const inPaper = paperSubtopics.filter((s) => s.paper === paper);
  if (!inPaper.length) return new Map();

  const ids = inPaper.map((s) => s.id);
  const sourceRows = await db.select().from(sources).where(inArray(sources.subtopicId, ids));
  const pyqRows = await db.select().from(pyqs);
  const masteryRows = await db.select().from(mastery).where(eq(mastery.userId, userId));
  const masteryBySubtopic = Object.fromEntries(masteryRows.map((m) => [m.subtopicId, m]));

  const sourcesBySubtopic = {}; // subtopicId -> [{sourceTier, ncertLevel, ncertClass}]
  for (const row of sourceRows) {
    (sourcesBySubtopic[row.subtopicId] ??= []).push({ sourceTier: row.sourceTier, ncertLevel: row.ncertLevel, ncertClass: row.ncertClass });
  }

  const pyqMarksBySubtopic = {};
  for (const q of pyqRows) {
    for (const t of q.topics) {
      if (ids.includes(t)) (pyqMarksBySubtopic[t] ??= []).push(q.marks);
    }
  }

  const withScore = inPaper.map((s) => ({
    id: s.id,
    topicText: s.topicText,
    pyqFrequency: s.pyqFrequency,
    syllabusOrder: s.syllabusOrder,
    difficultyScore: computeDifficultyScore(sourcesBySubtopic[s.id], pyqMarksBySubtopic[s.id]),
  }));
  const ordered = orderSubtopicsWithinPaper(withScore);

  const masteryScoreById = Object.fromEntries(ordered.map((s) => [s.id, masteryBySubtopic[s.id]?.masteryScore ?? 0]));
  const locks = computeSubtopicLocks(ordered, masteryScoreById);

  const result = new Map();
  const now = new Date();
  for (const s of ordered) {
    const lock = locks.get(s.id);
    // A redeemed 'unlock_pass' item (see lib/gamification/items.js) sets
    // mastery.unlockOverrideUntil on this exact subtopic -- while that's
    // still in the future, this subtopic reads as unlocked regardless of
    // what the real subtopic-chain mastery check above says. Doesn't touch
    // any OTHER subtopic's lock, and doesn't grant module-level access on
    // its own (see lib/adaptive/unlocks.js's computeModuleLocks, which
    // still gates module 2+ the normal way) -- "early access to a topic"
    // means the topic itself opens, not a skip straight past its modules.
    const overrideUntil = masteryBySubtopic[s.id]?.unlockOverrideUntil;
    const overridden = lock?.locked && overrideUntil && new Date(overrideUntil) > now;
    result.set(s.id, { ...lock, locked: overridden ? false : lock?.locked, unlockOverrideActive: Boolean(overridden), difficultyScore: s.difficultyScore });
  }
  return result;
}
