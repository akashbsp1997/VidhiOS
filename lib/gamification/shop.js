// lib/gamification/shop.js
//
// Seed shop -- spend seeds to unlock a currently-locked subtopic early.
// Reuses the EXACT mechanic app/api/items.js's free `unlock_pass` loot
// item already grants (mastery.unlockOverrideUntil, a time-bounded
// override -- see lib/adaptive/lockState.js's loadPaperLockMap), not a new
// unlock system: buying from the shop is just a second, deliberate way to
// get the same thing a lucky mission reward already can.
//
// Pricing is dynamic, not a fixed catalog, per two explicit factors:
//  - the buyer's own overall progress (a further-along student has more
//    seeds banked and shouldn't be able to trivially buy through the rest
//    of the syllabus for pocket change -- this is a seed SINK, it has to
//    actually cost something as the economy grows)
//  - how many prerequisite topics the purchase skips past in that paper's
//    real chain-lock order (lib/adaptive/unlocks.js) -- unlocking the very
//    next topic is cheap, unlocking one ten steps ahead of your frontier
//    is not, since that's genuinely worth more.

import { eq, and } from "drizzle-orm";
import { db } from "../db.js";
import { subtopics, sources, pyqs, mastery, playerState } from "../../db/schema.js";
import { computeDifficultyScore, orderSubtopicsWithinPaper, computeSubtopicLocks } from "../adaptive/unlocks.js";
import { computeMatureCount } from "./pvp.js";
import { spendSeeds } from "./missions.js";

export const BASE_UNLOCK_PRICE = 20;
export const PROGRESS_SURCHARGE_PER_MATURE = 2; // per the buyer's OWN mature-subtopic count, app-wide
export const SKIP_SURCHARGE_PER_TOPIC = 8; // per prerequisite topic the purchase skips past
export const UNLOCK_WINDOW_HOURS = 48; // matches items.js's UNLOCK_PASS_WINDOW_MS

// Same difficulty-ordering + chain-lock computation app/api/subtopics/route.js
// uses for real, just scoped to the one (subjectId, paper) a quote/purchase
// needs instead of the whole app's subtopic pool.
async function loadPaperContext(userId, subjectId, paper) {
  const [paperSubtopics, userMastery, sourceRows, allPyqs] = await Promise.all([
    db.select().from(subtopics).where(and(eq(subtopics.subjectId, subjectId), eq(subtopics.paper, paper))),
    db.select().from(mastery).where(eq(mastery.userId, userId)),
    db.select({ subtopicId: sources.subtopicId, sourceTier: sources.sourceTier, ncertLevel: sources.ncertLevel, ncertClass: sources.ncertClass }).from(sources),
    db.select({ topics: pyqs.topics, marks: pyqs.marks }).from(pyqs),
  ]);

  const masteryBySubtopic = Object.fromEntries(userMastery.map((m) => [m.subtopicId, m]));
  const paperIds = new Set(paperSubtopics.map((s) => s.id));
  const sourcesBySubtopic = {};
  for (const row of sourceRows) if (paperIds.has(row.subtopicId)) (sourcesBySubtopic[row.subtopicId] ??= []).push(row);
  const pyqMarksBySubtopic = {};
  for (const q of allPyqs) for (const t of q.topics) if (paperIds.has(t)) (pyqMarksBySubtopic[t] ??= []).push(q.marks);

  const withScore = paperSubtopics.map((s) => ({
    ...s,
    masteryScore: masteryBySubtopic[s.id]?.masteryScore ?? 0,
    difficultyScore: computeDifficultyScore(sourcesBySubtopic[s.id], pyqMarksBySubtopic[s.id]),
  }));
  const ordered = orderSubtopicsWithinPaper(withScore);
  const masteryScoreById = Object.fromEntries(ordered.map((s) => [s.id, s.masteryScore]));
  const locks = computeSubtopicLocks(ordered, masteryScoreById);
  return { ordered, locks };
}

/**
 * Dynamic price to unlock `subtopicId` early for this user, or null if
 * it's already unlocked (nothing to buy). Recomputed fresh on every call
 * -- never cached -- since it depends on live mastery state that changes
 * as the student (or a purchase itself) unlocks more of the chain.
 */
export async function priceForUnlock(userId, subtopicId) {
  const [subtopic] = await db.select().from(subtopics).where(eq(subtopics.id, subtopicId));
  if (!subtopic) throw new Error("Unknown subtopic.");

  const { ordered, locks } = await loadPaperContext(userId, subtopic.subjectId, subtopic.paper);
  const lockInfo = locks.get(subtopicId);
  if (!lockInfo?.locked) return null;

  const targetIndex = ordered.findIndex((s) => s.id === subtopicId);
  const frontierIndex = ordered.findIndex((s) => locks.get(s.id)?.locked); // first locked subtopic = the student's current frontier
  const topicsSkippedAhead = Math.max(1, targetIndex - (frontierIndex === -1 ? targetIndex : frontierIndex) + 1);

  const buyerMatureCount = await computeMatureCount(userId);
  const price = Math.round(BASE_UNLOCK_PRICE + PROGRESS_SURCHARGE_PER_MATURE * buyerMatureCount + SKIP_SURCHARGE_PER_TOPIC * topicsSkippedAhead);

  return { price, topicsSkippedAhead, subtopicId, topicText: subtopic.topicText, requiredSubtopicText: lockInfo.requiredSubtopicText };
}

/**
 * Charges the CURRENT quoted price (re-quoted here, not trusted from an
 * earlier client-held number -- the price can move if the student unlocks
 * more of the chain between quote and purchase) and grants the same
 * time-bounded unlock override useUnlockPass does. All-or-nothing: throws
 * (via spendSeeds) rather than partially charging.
 */
export async function purchaseUnlock(userId, subtopicId) {
  const quote = await priceForUnlock(userId, subtopicId);
  if (!quote) throw new Error("This subtopic isn't locked -- nothing to unlock.");

  await spendSeeds(userId, quote.price);

  const until = new Date(Date.now() + UNLOCK_WINDOW_HOURS * 60 * 60 * 1000);
  const [existingMastery] = await db.select().from(mastery).where(and(eq(mastery.userId, userId), eq(mastery.subtopicId, subtopicId)));
  if (existingMastery) {
    await db.update(mastery).set({ unlockOverrideUntil: until }).where(and(eq(mastery.userId, userId), eq(mastery.subtopicId, subtopicId)));
  } else {
    await db.insert(mastery).values({ userId, subtopicId, unlockOverrideUntil: until });
  }

  return { subtopicId, pricePaid: quote.price, unlockOverrideUntil: until };
}

/** Current seed balance, for the shop page header. */
export async function currentSeeds(userId) {
  const [ps] = await db.select({ seeds: playerState.seeds }).from(playerState).where(eq(playerState.userId, userId));
  return ps?.seeds ?? 0;
}
