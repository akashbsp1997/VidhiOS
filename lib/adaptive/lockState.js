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
import { computeDifficultyScore, orderSubtopicsWithinPaper, computeSubtopicLocks, computeSectionLocks, computeCrossChapterLocks } from "./unlocks.js";

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
    section: s.section,
    pyqFrequency: s.pyqFrequency,
    syllabusOrder: s.syllabusOrder,
    prerequisiteSubtopicIds: s.prerequisiteSubtopicIds,
    difficultyScore: computeDifficultyScore(sourcesBySubtopic[s.id], pyqMarksBySubtopic[s.id]),
  }));
  const ordered = orderSubtopicsWithinPaper(withScore);
  const topicTextById = Object.fromEntries(ordered.map((s) => [s.id, s.topicText]));

  const masteryScoreById = Object.fromEntries(ordered.map((s) => [s.id, masteryBySubtopic[s.id]?.masteryScore ?? 0]));
  const locks = computeSubtopicLocks(ordered, masteryScoreById);
  // Subject-level ("section") gate and cross-chapter prerequisite gate,
  // both composed with the subtopic-chain gate above -- a subtopic is truly
  // locked if ANY of the three says locked. Each kept as a distinct flag
  // rather than collapsed silently into `locked` so callers can tell a
  // student *why* ("your previous chapter" vs "your previous subject" vs
  // "a specific other chapter this one depends on").
  const sectionLocks = computeSectionLocks(ordered, masteryScoreById);
  const crossChapterLocks = computeCrossChapterLocks(ordered, masteryScoreById);

  const result = new Map();
  const now = new Date();
  for (const s of ordered) {
    const lock = locks.get(s.id);
    const sectionLock = sectionLocks.get(s.id);
    const crossChapterLock = crossChapterLocks.get(s.id);
    // A redeemed 'unlock_pass' item (see lib/gamification/items.js) sets
    // mastery.unlockOverrideUntil on this exact subtopic -- while that's
    // still in the future, this subtopic's own subtopic-CHAIN lock reads as
    // unlocked regardless of what the real chain mastery check above says.
    // Deliberately does NOT override the section-level or cross-chapter
    // gates -- "early access to a topic" means the topic itself opens, not
    // a skip past its whole subject or a specific real dependency; see
    // lib/adaptive/unlocks.js's computeSectionLocks/computeCrossChapterLocks
    // header comments.
    const overrideUntil = masteryBySubtopic[s.id]?.unlockOverrideUntil;
    const overridden = lock?.locked && overrideUntil && new Date(overrideUntil) > now;
    const chainLocked = overridden ? false : lock?.locked;
    result.set(s.id, {
      ...lock,
      locked: chainLocked || sectionLock?.locked || crossChapterLock?.locked,
      unlockOverrideActive: Boolean(overridden),
      difficultyScore: s.difficultyScore,
      lockedBySection: Boolean(sectionLock?.locked),
      sectionLockInfo: sectionLock?.locked
        ? { requiredSection: sectionLock.requiredSection, requiredMasteryPct: sectionLock.requiredMasteryPct, currentMasteryPct: sectionLock.currentMasteryPct }
        : null,
      lockedByPrerequisite: Boolean(crossChapterLock?.locked),
      prerequisiteLockInfo: crossChapterLock?.locked
        ? { missingSubtopicIds: crossChapterLock.missingPrereqIds, missingSubtopicTexts: crossChapterLock.missingPrereqIds.map((id) => topicTextById[id] ?? id) }
        : null,
    });
  }
  return result;
}
