// lib/gamification/bounties.js
//
// Daily Bounty -- today's REAL plan-assigned learn-day topics (not just
// "any topic"), each with a 4-step quest: teach the content, map/study its
// current affairs, make a note, clear a Prelims question on it. All four
// done -> the topic "blooms" for the day (a seed bonus, surfaced as a
// bounty on the World Map). "Watering" (revision/retest) is a separate,
// already-built mechanic -- lib/adaptive/masteryUpdate.js's retest-grows-
// easeFactor logic and lib/forest/decay.js's applyRevision -- this file
// doesn't duplicate that, just names/surfaces the teach->bloom chain.
//
// Every exported step-marker is non-fatal by design (try/catch, logs and
// returns rather than throwing) -- same "gamification must never break the
// real feature" principle as recordMissionSafe/checkAndAwardOrnaments,
// since these are called from inside Teach/notes/MCQ routes whose real job
// must succeed regardless of what happens here.

import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db.js";
import { dailyBounties, subtopics as subtopicsTable } from "../../db/schema.js";
import { getPlanWindow } from "../adaptive/planState.js";
import { planStartDate } from "../adaptive/subjectUnlockState.js";
import { dayNumberForDate } from "../adaptive/planEngine.js";
import { grantSeeds } from "./missions.js";

export const BLOOM_BONUS_SEEDS = 25;

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

/** Today's plan-assigned learn-day subtopic ids. Empty on a test/revise day, or before onboarding. */
export async function todaysLearnSubtopicIds(userId) {
  const start = await planStartDate(userId);
  if (!start) return [];
  const todayDay = dayNumberForDate(start, new Date());
  const window = await getPlanWindow(userId, { fromDay: todayDay, toDay: todayDay });
  const today = window?.days?.find((d) => d.day === todayDay);
  return today?.type === "learn" ? today.subtopicIds : [];
}

async function maybeBloom(userId, bountyDate, subtopicId) {
  const [row] = await db
    .select()
    .from(dailyBounties)
    .where(and(eq(dailyBounties.userId, userId), eq(dailyBounties.bountyDate, bountyDate), eq(dailyBounties.subtopicId, subtopicId)));
  if (!row || row.bloomedAt) return;
  if (row.teachDoneAt && row.currentAffairsDoneAt && row.notesDoneAt && row.prelimsDoneAt) {
    await db
      .update(dailyBounties)
      .set({ bloomedAt: new Date() })
      .where(and(eq(dailyBounties.userId, userId), eq(dailyBounties.bountyDate, bountyDate), eq(dailyBounties.subtopicId, subtopicId)));
    await grantSeeds(userId, BLOOM_BONUS_SEEDS);
  }
}

async function markStep(userId, subtopicId, column) {
  const eligible = await todaysLearnSubtopicIds(userId);
  if (!eligible.includes(subtopicId)) return; // only today's actual plan topics earn bounty credit
  const bountyDate = todayUtc();
  await db.insert(dailyBounties).values({ userId, bountyDate, subtopicId }).onConflictDoNothing();
  await db
    .update(dailyBounties)
    .set({ [column]: new Date() })
    .where(and(eq(dailyBounties.userId, userId), eq(dailyBounties.bountyDate, bountyDate), eq(dailyBounties.subtopicId, subtopicId)));
  await maybeBloom(userId, bountyDate, subtopicId);
}

/** Call from wherever a student actually reaches Teach content for a subtopic. */
export async function markTeachDone(userId, subtopicId) {
  try {
    await markStep(userId, subtopicId, "teachDoneAt");
    // Auto-satisfied here, not from a separate "viewed the current affairs
    // tab" event -- see this file's header for why a topic with no real
    // current-affairs angle shouldn't be blocked from blooming on it.
    await markStep(userId, subtopicId, "currentAffairsDoneAt");
  } catch (err) {
    console.error("markTeachDone failed:", err);
  }
}

/** Call from wherever a student saves a real note for a subtopic. */
export async function markNotesDone(userId, subtopicId) {
  try {
    await markStep(userId, subtopicId, "notesDoneAt");
  } catch (err) {
    console.error("markNotesDone failed:", err);
  }
}

/** Call from wherever a student answers a Prelims/MCQ question for a subtopic. */
export async function markPrelimsDone(userId, subtopicId) {
  try {
    await markStep(userId, subtopicId, "prelimsDoneAt");
  } catch (err) {
    console.error("markPrelimsDone failed:", err);
  }
}

/** Today's bounty list with per-step status, for the map/dashboard widget. */
export async function todaysBounties(userId) {
  const ids = await todaysLearnSubtopicIds(userId);
  if (!ids.length) return [];
  const bountyDate = todayUtc();

  const [progressRows, subtopicRows] = await Promise.all([
    db.select().from(dailyBounties).where(and(eq(dailyBounties.userId, userId), eq(dailyBounties.bountyDate, bountyDate))),
    db.select({ id: subtopicsTable.id, topicText: subtopicsTable.topicText }).from(subtopicsTable).where(inArray(subtopicsTable.id, ids)),
  ]);
  const progressBySubtopic = Object.fromEntries(progressRows.map((r) => [r.subtopicId, r]));
  const textById = Object.fromEntries(subtopicRows.map((s) => [s.id, s.topicText]));

  return ids.map((id) => {
    const r = progressBySubtopic[id];
    return {
      subtopicId: id,
      topicText: textById[id] ?? id,
      teachDone: !!r?.teachDoneAt,
      currentAffairsDone: !!r?.currentAffairsDoneAt,
      notesDone: !!r?.notesDoneAt,
      prelimsDone: !!r?.prelimsDoneAt,
      bloomed: !!r?.bloomedAt,
    };
  });
}
