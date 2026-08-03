// lib/gamification/alliances.js
//
// Kingshot-style alliances (guilds) -- a student belongs to at most one at
// a time. Alliances compete on aggregate stats (total mature plants across
// every member, total seeds banked), shown as a leaderboard and as tags on
// the World Map/Arena. No chat, no shared territory grid -- the
// competitive/social layer is the leaderboard plus the same PvP guard this
// file wires in (allies can't attack each other), not a whole second
// real-time system.

import { eq, and, ne, inArray } from "drizzle-orm";
import { db } from "../db.js";
import { alliances, allianceMembers, playerState } from "../../db/schema.js";
import { computeMatureCount, anonymizedLabel } from "./pvp.js";

const TAG_PATTERN = /^[A-Z0-9]{2,5}$/;

function normalizeTag(tag) {
  return String(tag || "").trim().toUpperCase();
}

/** Creates a new alliance and makes the creator its leader. Fails if the name/tag is taken, or the user is already in one. */
export async function createAlliance(userId, name, tag) {
  const cleanName = String(name || "").trim();
  const cleanTag = normalizeTag(tag);
  if (!cleanName || cleanName.length > 40) throw new Error("Alliance name must be 1-40 characters.");
  if (!TAG_PATTERN.test(cleanTag)) throw new Error("Tag must be 2-5 letters/numbers (e.g. \"GS2\", \"VAJRA\").");

  const [existingMembership] = await db.select().from(allianceMembers).where(eq(allianceMembers.userId, userId));
  if (existingMembership) throw new Error("You're already in an alliance -- leave it first.");

  const [row] = await db.insert(alliances).values({ name: cleanName, tag: cleanTag, createdBy: userId }).returning();
  await db.insert(allianceMembers).values({ userId, allianceId: row.id, role: "leader" });
  return row;
}

/** Joins an existing alliance -- open membership, no approval step (matches this app's low-stakes social layer; an invite/approval flow is a real feature to add later if this gets abused, not a day-one requirement). */
export async function joinAlliance(userId, allianceId) {
  const [existingMembership] = await db.select().from(allianceMembers).where(eq(allianceMembers.userId, userId));
  if (existingMembership) throw new Error("You're already in an alliance -- leave it first.");

  const [alliance] = await db.select().from(alliances).where(eq(alliances.id, allianceId));
  if (!alliance) throw new Error("Unknown alliance.");

  await db.insert(allianceMembers).values({ userId, allianceId, role: "member" });
  return alliance;
}

/** Leaves the current alliance. If the leaving member was the only one, the alliance itself is deleted rather than left as an empty, permanently-orphaned row. */
export async function leaveAlliance(userId) {
  const [membership] = await db.select().from(allianceMembers).where(eq(allianceMembers.userId, userId));
  if (!membership) throw new Error("You're not in an alliance.");

  await db.delete(allianceMembers).where(eq(allianceMembers.userId, userId));

  const [remaining] = await db
    .select({ count: allianceMembers.userId })
    .from(allianceMembers)
    .where(eq(allianceMembers.allianceId, membership.allianceId));
  if (!remaining) {
    await db.delete(alliances).where(eq(alliances.id, membership.allianceId));
  } else if (membership.role === "leader") {
    // Leadership passes to whoever's been there longest -- simplest
    // succession rule that never leaves an alliance leaderless.
    const [nextLeader] = await db
      .select()
      .from(allianceMembers)
      .where(eq(allianceMembers.allianceId, membership.allianceId))
      .orderBy(allianceMembers.joinedAt)
      .limit(1);
    if (nextLeader) await db.update(allianceMembers).set({ role: "leader" }).where(eq(allianceMembers.userId, nextLeader.userId));
  }
}

async function allianceStats(allianceId) {
  const members = await db
    .select({ userId: allianceMembers.userId, role: allianceMembers.role, joinedAt: allianceMembers.joinedAt })
    .from(allianceMembers)
    .where(eq(allianceMembers.allianceId, allianceId));
  const userIds = members.map((m) => m.userId);
  if (!userIds.length) return { memberCount: 0, totalMature: 0, totalSeeds: 0, members: [] };

  const [seedRows, matureCounts] = await Promise.all([
    db.select({ userId: playerState.userId, seeds: playerState.seeds }).from(playerState).where(inArray(playerState.userId, userIds)),
    Promise.all(userIds.map((id) => computeMatureCount(id))),
  ]);
  const seedsByUser = Object.fromEntries(seedRows.map((r) => [r.userId, r.seeds]));
  const totalSeeds = userIds.reduce((s, id) => s + (seedsByUser[id] ?? 0), 0);
  const totalMature = matureCounts.reduce((s, c) => s + c, 0);

  const membersWithStats = members.map((m, i) => ({ ...m, label: anonymizedLabel(m.userId), matureCount: matureCounts[i], seeds: seedsByUser[m.userId] ?? 0 }));
  return { memberCount: members.length, totalMature, totalSeeds, members: membersWithStats };
}

/** Every alliance, ranked by total mature plants across all members -- the leaderboard. */
export async function listAlliances() {
  const all = await db.select().from(alliances);
  const withStats = await Promise.all(
    all.map(async (a) => {
      const stats = await allianceStats(a.id);
      return { id: a.id, name: a.name, tag: a.tag, description: a.description, memberCount: stats.memberCount, totalMature: stats.totalMature, totalSeeds: stats.totalSeeds };
    })
  );
  return withStats.sort((a, b) => b.totalMature - a.totalMature);
}

/** This user's own alliance, with full member roster and stats, or null if they're not in one. */
export async function myAlliance(userId) {
  const [membership] = await db.select().from(allianceMembers).where(eq(allianceMembers.userId, userId));
  if (!membership) return null;
  const [alliance] = await db.select().from(alliances).where(eq(alliances.id, membership.allianceId));
  if (!alliance) return null;
  const stats = await allianceStats(alliance.id);
  return { id: alliance.id, name: alliance.name, tag: alliance.tag, description: alliance.description, myRole: membership.role, ...stats };
}

/** Whether two users share an alliance. Note: lib/gamification/pvp.js's assertEligible has its own inlined copy of this exact query rather than importing it from here, to avoid a circular import (this file already imports from pvp.js) -- keep both in sync if the membership model ever changes. */
export async function sameAlliance(userIdA, userIdB) {
  const rows = await db
    .select({ userId: allianceMembers.userId, allianceId: allianceMembers.allianceId })
    .from(allianceMembers)
    .where(inArray(allianceMembers.userId, [userIdA, userIdB]));
  if (rows.length < 2) return false;
  return rows[0].allianceId === rows[1].allianceId;
}

/** This user's alliance tag, or null -- for tagging labels on the World Map/Arena without a full alliance fetch. */
export async function allianceTagFor(userId) {
  const [row] = await db
    .select({ tag: alliances.tag })
    .from(allianceMembers)
    .innerJoin(alliances, eq(alliances.id, allianceMembers.allianceId))
    .where(eq(allianceMembers.userId, userId));
  return row?.tag ?? null;
}

/** Batch version of allianceTagFor -- { [userId]: tag } for only the users who are in an alliance. Used at the API route layer (not inside pvp.js -- see that file's own inlined sameAlliance for why) to tag Arena opponent labels without an N-query round trip per opponent. */
export async function tagsForUsers(userIds) {
  if (!userIds.length) return {};
  const rows = await db
    .select({ userId: allianceMembers.userId, tag: alliances.tag })
    .from(allianceMembers)
    .innerJoin(alliances, eq(alliances.id, allianceMembers.allianceId))
    .where(inArray(allianceMembers.userId, userIds));
  return Object.fromEntries(rows.map((r) => [r.userId, r.tag]));
}
