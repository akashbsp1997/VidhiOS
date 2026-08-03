// lib/gamification/ornaments.js
//
// Milestone-earned cosmetic badges ("ornaments") -- distinct from
// lib/gamification/items.js's random mission-loot badges (those are
// flavor, earned by chance); these are deterministic, tied to a real,
// checkable achievement, and each can only be earned once per student.
// Still stored as ordinary playerItems rows with itemType:'cosmetic_badge'
// (see listBadges) -- no new table needed, just a distinct, matchable
// label and a real threshold check instead of a random roll.

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db.js";
import { playerItems, mastery, sources, lessonModules } from "../../db/schema.js";
import { MATURE_GROWTH_STAGES } from "../forest/estate.js";

export const ORNAMENT_DEFS = [
  {
    key: "ncert_master",
    label: "NCERT Master",
    threshold: 10,
    description: "Reached Healthy Tree or beyond on 10+ subtopics grounded in real NCERT sources.",
  },
  {
    key: "current_affairs_master",
    label: "Current Affairs Master",
    threshold: 10,
    description: "Reached Healthy Tree or beyond on 10+ subtopics whose Teach content links real current-affairs items.",
  },
];

/** Subtopics this user has matured that also have at least one NCERT-tier source registered. */
async function countMatureNcertGrounded(userId) {
  const [row] = await db
    .select({ count: sql`count(distinct ${mastery.subtopicId})`.mapWith(Number) })
    .from(mastery)
    .innerJoin(sources, and(eq(sources.subtopicId, mastery.subtopicId), eq(sources.sourceTier, "ncert")))
    .where(and(eq(mastery.userId, userId), inArray(mastery.growthStage, MATURE_GROWTH_STAGES)));
  return row?.count ?? 0;
}

/** Subtopics this user has matured whose Teach content (any module) links a real current-affairs item. */
async function countMatureCurrentAffairsGrounded(userId) {
  const [row] = await db
    .select({ count: sql`count(distinct ${mastery.subtopicId})`.mapWith(Number) })
    .from(mastery)
    .innerJoin(
      lessonModules,
      and(eq(lessonModules.subtopicId, mastery.subtopicId), sql`jsonb_array_length(${lessonModules.currentAffairsLink}) > 0`)
    )
    .where(and(eq(mastery.userId, userId), inArray(mastery.growthStage, MATURE_GROWTH_STAGES)));
  return row?.count ?? 0;
}

const COUNTERS = { ncert_master: countMatureNcertGrounded, current_affairs_master: countMatureCurrentAffairsGrounded };

/**
 * Checks every ornament definition against this user's current stats and
 * awards any newly-crossed threshold, exactly once each (checked by label,
 * same "does this exact badge already exist" guard for every definition).
 * Called after a graded attempt (lib/adaptive/masteryUpdate.js), same spot
 * "bearing fruit" seeds are granted -- non-fatal by design, same as
 * recordMissionSafe: the gamification layer must never break real grading.
 */
export async function checkAndAwardOrnaments(userId) {
  const awarded = [];
  for (const def of ORNAMENT_DEFS) {
    try {
      const [existing] = await db
        .select({ id: playerItems.id })
        .from(playerItems)
        .where(and(eq(playerItems.userId, userId), eq(playerItems.itemType, "cosmetic_badge"), eq(playerItems.label, def.label)));
      if (existing) continue;

      const count = await COUNTERS[def.key](userId);
      if (count < def.threshold) continue;

      const [item] = await db.insert(playerItems).values({ userId, itemType: "cosmetic_badge", label: def.label }).returning();
      awarded.push(item);
    } catch (err) {
      console.error(`checkAndAwardOrnaments(${def.key}) failed:`, err);
    }
  }
  return awarded;
}
