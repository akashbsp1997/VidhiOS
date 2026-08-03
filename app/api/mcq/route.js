// app/api/mcq/route.js
//
// GET  -> the next Prelims-style MCQ. By default, drawn from a random
//      subtopic among this user's unlocked GS + optional subjects (see
//      lib/adaptive/subjectUnlockState.js) -- CSAT's reasoning/comprehension
//      side has no subtopic content to draw from and stays out of scope,
//      but its Basic Numeracy/Data Interpretation ("Quant") half now has
//      real subtopics (db/seed/csat-quant-syllabus.js) and can be targeted
//      explicitly via ?subjectId=prelims-csat (see components/
//      QuantPuzzleChain.jsx) -- an optional ?difficultyTier=1-3 threads
//      through to generation too. Options are returned but the correct
//      answer is NOT -- that only comes back from POST, after grading.
// POST { subtopicId, questionRefId, selectedIndex } -> deterministic
//      grading (no AI call needed, unlike descriptive answers) + records the
//      attempt. Deliberately separate from app/api/attempt/route.js's
//      questionSource:'pyq'|'model' descriptive flow and does NOT touch
//      mastery/currentTier/moduleProgress -- MCQ accuracy is tracked
//      independently (see stats below, computed on the fly from `attempts`
//      rather than a new running counter) so it can never distort the
//      descriptive-mastery-gated subject/subtopic/module unlock system.
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../../lib/db.js";
import { subtopics, sources, subjects, attempts, modelQuestions, pyqs } from "../../../db/schema.js";
import { getSessionUserId } from "../../../lib/supabase/server.js";
import { getSubjectConfig } from "../../../lib/subjects/config.js";
import { generateMcq } from "../../../lib/ai/generateMcq.js";
import { loadUnlockedSubjectIds, isSubjectUnlocked, checkLockdown } from "../../../lib/adaptive/subjectUnlockState.js";
import { isPassingScore } from "../../../lib/adaptive/scoring.js";
import { recordMissionSafe } from "../../../lib/gamification/missions.js";
import { markPrelimsDone } from "../../../lib/gamification/bounties.js";
import { recentCurrentAffairsExcerpts, pickReferencePyqs, labeledSourceExcerptBlocks } from "../../../lib/ai/contentGrounding.js";

const MCQ_DIFFICULTY_TIER = 2; // flat default -- no adaptive tiering for the general MCQ pool (see file header)
const MCQ_MARKS = 2; // standard real UPSC Prelims MCQ weight

// `subjectId` (optional): forces the pool to one specific ungated subject
// instead of this user's unlocked GS/optional set -- e.g. "prelims-csat"
// for components/QuantPuzzleChain.jsx, since CSAT isn't part of the GS/
// optional unlock system at all (see loadUnlockedSubjectIds) and has no
// meaningful "spread across my unlocked subjects" pool to draw from; it's
// exactly one fixed subject. Still runs through isSubjectUnlocked so a
// caller can't pass an arbitrary gated subjectId to bypass real locking.
// `difficultyTier` (optional, 1-3, default MCQ_DIFFICULTY_TIER): threaded
// into the cache lookup AND the generation call, so a puzzle-chain-style
// caller escalating tier per correct answer gets genuinely harder cached/
// generated questions instead of always the same flat-tier pool the plain
// Quiz Arcade call (no params) still gets.
export async function GET(request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const forcedSubjectId = searchParams.get("subjectId") || null;
  const requestedTier = Number(searchParams.get("difficultyTier"));
  const difficultyTier = Number.isInteger(requestedTier) && requestedTier >= 1 && requestedTier <= 3 ? requestedTier : MCQ_DIFFICULTY_TIER;

  try {
    const lockdown = await checkLockdown(userId);
    if (lockdown) return NextResponse.json({ error: "locked_down", ...lockdown }, { status: 403 });

    let pool;
    if (forcedSubjectId) {
      if (!(await isSubjectUnlocked(userId, forcedSubjectId))) {
        return NextResponse.json({ error: "subject_locked" }, { status: 403 });
      }
      pool = await db.select().from(subtopics).where(eq(subtopics.subjectId, forcedSubjectId));
      if (!pool.length) {
        return NextResponse.json({ error: `No subtopics found for subject "${forcedSubjectId}".` }, { status: 404 });
      }
    } else {
      const { unlockedGsIds, optionalSubjectId } = await loadUnlockedSubjectIds(userId);
      const unlockedSubjectIds = optionalSubjectId ? [...unlockedGsIds, optionalSubjectId] : unlockedGsIds;
      if (!unlockedSubjectIds.length) {
        return NextResponse.json({ error: "onboarding_not_complete" }, { status: 409 });
      }

      pool = await db.select().from(subtopics).where(inArray(subtopics.subjectId, unlockedSubjectIds));
      if (!pool.length) {
        return NextResponse.json({ error: "No subtopics with content in your unlocked subjects yet." }, { status: 404 });
      }
    }

    // Spread coverage rather than pure random -- prefer whichever unlocked
    // subtopic this user has answered the fewest MCQs on so far (ties broken
    // randomly), so a small pool doesn't get dominated by repeats of one topic.
    const attemptCounts = await db
      .select({ subtopicId: attempts.subtopicId, count: sql`count(*)`.mapWith(Number) })
      .from(attempts)
      .where(and(eq(attempts.userId, userId), eq(attempts.questionSource, "mcq"), inArray(attempts.subtopicId, pool.map((s) => s.id))))
      .groupBy(attempts.subtopicId);
    const countBySubtopic = Object.fromEntries(attemptCounts.map((r) => [r.subtopicId, r.count]));
    const minCount = Math.min(...pool.map((s) => countBySubtopic[s.id] ?? 0));
    const leastAttempted = pool.filter((s) => (countBySubtopic[s.id] ?? 0) === minCount);
    const subtopicRow = leastAttempted[Math.floor(Math.random() * leastAttempted.length)];

    // Prefer a cached MCQ this user hasn't seen yet over always generating
    // fresh -- scoped to this exact difficultyTier, so a puzzle-chain
    // caller escalating tiers never gets served a cached easy-tier question
    // out of a harder tier's request (or vice versa).
    const cachedRows = await db
      .select()
      .from(modelQuestions)
      .where(and(eq(modelQuestions.subtopicId, subtopicRow.id), eq(modelQuestions.format, "mcq"), eq(modelQuestions.difficultyTier, difficultyTier)));
    let questionRow;
    if (cachedRows.length) {
      const seenRows = await db
        .select({ id: attempts.questionRefId })
        .from(attempts)
        .where(and(eq(attempts.userId, userId), eq(attempts.subtopicId, subtopicRow.id), eq(attempts.questionSource, "mcq")));
      const seen = new Set(seenRows.map((r) => String(r.id)));
      questionRow = cachedRows.find((q) => !seen.has(String(q.id)));
    }

    if (!questionRow) {
      const srcRows = await db.select().from(sources).where(eq(sources.subtopicId, subtopicRow.id));
      const sourceExcerpts = labeledSourceExcerptBlocks(srcRows);
      // Same grounding upgrade as app/api/attempt/route.js's descriptive
      // generation (see the 2026-07-24 "content-first" change) -- MCQ never
      // served a raw PYQ to begin with, this just strengthens what it's
      // grounded in. No "seen" tracking for reference PYQs here (unlike the
      // MCQ pool cache itself) -- picking a reference is calibration
      // variety, not correctness, low-stakes to leave unseen-agnostic.
      const pyqPool = await db.select().from(pyqs).where(sql`${subtopicRow.id} = ANY(${pyqs.topics})`);
      const referencePyqs = pickReferencePyqs(pyqPool, []);
      const currentAffairsExcerpts = await recentCurrentAffairsExcerpts(subtopicRow.id);
      const generated = await generateMcq({
        subtopicText: subtopicRow.topicText,
        sourceExcerpts,
        currentAffairsExcerpts,
        referencePyqs,
        difficultyTier,
        subjectConfig: getSubjectConfig(subtopicRow.subjectId),
      });
      [questionRow] = await db
        .insert(modelQuestions)
        .values({
          subtopicId: subtopicRow.id,
          difficultyTier,
          marks: MCQ_MARKS,
          questionText: generated.questionText,
          format: "mcq",
          options: generated.options,
          correctIndex: generated.correctIndex,
          explanation: generated.explanation,
        })
        .returning();
    }

    return NextResponse.json({
      subtopicId: subtopicRow.id,
      subtopicText: subtopicRow.topicText,
      questionRefId: String(questionRow.id),
      questionText: questionRow.questionText,
      options: questionRow.options,
      difficultyTier: questionRow.difficultyTier,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const lockdown = await checkLockdown(userId);
    if (lockdown) return NextResponse.json({ error: "locked_down", ...lockdown }, { status: 403 });

    const { subtopicId, questionRefId, selectedIndex } = await request.json();
    if (!subtopicId || !questionRefId || !Number.isInteger(selectedIndex)) {
      return NextResponse.json({ error: "subtopicId, questionRefId, and a numeric selectedIndex are required" }, { status: 400 });
    }

    const subtopicRows = await db.select().from(subtopics).where(eq(subtopics.id, subtopicId));
    const subtopicRow = subtopicRows[0];
    if (!subtopicRow) return NextResponse.json({ error: "Unknown subtopic" }, { status: 404 });

    if (!(await isSubjectUnlocked(userId, subtopicRow.subjectId))) {
      return NextResponse.json({ error: "subject_locked" }, { status: 403 });
    }

    const questionRows = await db.select().from(modelQuestions).where(eq(modelQuestions.id, Number(questionRefId)));
    const questionRow = questionRows[0];
    if (!questionRow || questionRow.format !== "mcq" || questionRow.subtopicId !== subtopicId) {
      return NextResponse.json({ error: "Unknown MCQ" }, { status: 404 });
    }

    const correct = selectedIndex === questionRow.correctIndex;
    await db.insert(attempts).values({
      userId,
      subtopicId,
      questionSource: "mcq",
      questionRefId: String(questionRow.id),
      questionTextSnapshot: questionRow.questionText,
      difficultyTier: questionRow.difficultyTier,
      marks: questionRow.marks,
      answerText: questionRow.options[selectedIndex] ?? "",
      score: correct ? 100 : 0,
      feedback: { selectedIndex, correctIndex: questionRow.correctIndex, explanation: questionRow.explanation, correct },
    });

    const statsRows = await db
      .select({ score: attempts.score })
      .from(attempts)
      .where(and(eq(attempts.userId, userId), eq(attempts.questionSource, "mcq")));
    const stats = { attempted: statsRows.length, correct: statsRows.filter((r) => r.score === 100).length };

    await recordMissionSafe(userId, "practice");
    if (isPassingScore(correct ? 100 : 0)) await recordMissionSafe(userId, "pass");
    await markPrelimsDone(userId, subtopicId);

    return NextResponse.json({ correct, correctIndex: questionRow.correctIndex, explanation: questionRow.explanation, stats });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
