// app/api/cron/grade-daily-answers/route.js
//
// Wired to Vercel Cron via vercel.json, once nightly. Grades the backlog of
// answers saved-but-not-yet-graded since /api/attempt, /api/essay-attempt,
// and /api/mock-tests/grade-question all stopped grading inline (see the
// 2026-07-24 overnight-batch-grading change -- the whole point is spreading
// AI usage into one predictable nightly window instead of a live call on
// every submission). Reuses the exact same AI-grading functions those routes
// used to call directly (lib/ai/grade.js's gradeAnswer, lib/ai/gradeEssay.js's
// gradeEssay) -- no rubric logic is duplicated here.
//
// Runs BEFORE app/api/cron/prepare-next-day/route.js (see vercel.json's
// schedule gap) since that job pre-generates tomorrow's content based on the
// mastery this job just updated.
export const maxDuration = 90;

import { NextResponse } from "next/server";
import { eq, and, isNull, isNotNull, asc } from "drizzle-orm";
import { db } from "../../../../lib/db.js";
import { attempts, essayAttempts, mockTestQuestions, mockTests, subtopics, essayTopics, dailyResultsDigests, lessonModules, dragonChallenges } from "../../../../db/schema.js";
import { gradeAnswer } from "../../../../lib/ai/grade.js";
import { gradeEssay } from "../../../../lib/ai/gradeEssay.js";
import { getSubjectConfig } from "../../../../lib/subjects/config.js";
import { applyGradedScore } from "../../../../lib/adaptive/masteryUpdate.js";
import { isPassingScore } from "../../../../lib/adaptive/scoring.js";
import { recordMissionSafe } from "../../../../lib/gamification/missions.js";

// Conservative, not the refresh-sources precedent's 15 -- an AI grading call
// can retry up to lib/ai/client.js's ~29s worst case per item (vs. a source
// fetch's much cheaper failure mode), and this route's own maxDuration is
// 90s, shared across THREE item types graded sequentially below.
const MAX_ITEMS_PER_TYPE_PER_RUN = 10;

function dateOf(d) {
  return new Date(d).toISOString().slice(0, 10);
}

export async function GET(request) {
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const subtopicTextCache = new Map();
  async function subtopicText(subtopicId) {
    if (subtopicTextCache.has(subtopicId)) return subtopicTextCache.get(subtopicId);
    const [row] = await db.select().from(subtopics).where(eq(subtopics.id, subtopicId));
    subtopicTextCache.set(subtopicId, row);
    return row;
  }

  // { "userId::date": { itemCount, totalScore, bySubtopic: Map<subtopicId, {topicText, itemCount, totalScore}> } }
  const digestAcc = new Map();
  function recordForDigest(userId, createdAt, subtopicId, topicText, score) {
    const date = dateOf(createdAt);
    const key = `${userId}::${date}`;
    if (!digestAcc.has(key)) digestAcc.set(key, { userId, date, itemCount: 0, totalScore: 0, bySubtopic: new Map() });
    const acc = digestAcc.get(key);
    acc.itemCount += 1;
    acc.totalScore += score;
    if (subtopicId) {
      const bucket = acc.bySubtopic.get(subtopicId) ?? { subtopicId, topicText, itemCount: 0, totalScore: 0 };
      bucket.itemCount += 1;
      bucket.totalScore += score;
      acc.bySubtopic.set(subtopicId, bucket);
    }
  }

  let attemptsGraded = 0;
  let essaysGraded = 0;
  let mockQuestionsGraded = 0;

  // --- attempts (subtopic/module practice) ---
  const pendingAttempts = await db
    .select()
    .from(attempts)
    .where(isNull(attempts.score))
    .orderBy(asc(attempts.createdAt))
    .limit(MAX_ITEMS_PER_TYPE_PER_RUN);

  for (const row of pendingAttempts) {
    try {
      const subtopicRow = await subtopicText(row.subtopicId);
      if (!subtopicRow) continue;

      let subtopicTextForGrading = subtopicRow.topicText;
      if (row.moduleId) {
        const [moduleRow] = await db.select().from(lessonModules).where(eq(lessonModules.id, row.moduleId));
        if (moduleRow) subtopicTextForGrading = `${subtopicRow.topicText} — module focus: "${moduleRow.title}" (${moduleRow.scopeNote})`;
      }

      const feedback = await gradeAnswer({
        questionText: row.questionTextSnapshot,
        marks: row.marks,
        subtopicText: subtopicTextForGrading,
        answerText: row.answerText,
        subjectConfig: getSubjectConfig(subtopicRow.subjectId),
      });

      await db.update(attempts).set({ score: feedback.score, feedback }).where(eq(attempts.id, row.id));
      await applyGradedScore(row.userId, row.subtopicId, row.moduleId, feedback.score / 100);
      if (isPassingScore(feedback.score)) await recordMissionSafe(row.userId, "pass");

      recordForDigest(row.userId, row.createdAt, row.subtopicId, subtopicRow.topicText, feedback.score);
      attemptsGraded++;
    } catch (err) {
      console.error(`grade-daily-answers: attempt ${row.id} failed:`, err.message);
    }
  }

  // --- essayAttempts (standalone essays only -- tournament rows are graded
  // synchronously via gradeNow:true and are never left with score:null) ---
  const pendingEssays = await db
    .select()
    .from(essayAttempts)
    .where(isNull(essayAttempts.score))
    .orderBy(asc(essayAttempts.createdAt))
    .limit(MAX_ITEMS_PER_TYPE_PER_RUN);

  for (const row of pendingEssays) {
    try {
      const [topic] = await db.select().from(essayTopics).where(eq(essayTopics.id, row.essayTopicId));
      if (!topic) continue;

      const feedback = await gradeEssay({ topicText: topic.topicText, essayText: row.essayText });
      await db.update(essayAttempts).set({ score: feedback.score, feedback }).where(eq(essayAttempts.id, row.id));
      if (isPassingScore(feedback.score)) await recordMissionSafe(row.userId, "pass");
      essaysGraded++;
      // Essays are intentionally excluded from dailyResultsDigests -- they've
      // never fed subtopic mastery (see essay-attempt/route.js's header
      // comment), so they don't belong in a subtopic-scoped marks archive;
      // still visible via GET /api/essay-attempt.
    } catch (err) {
      console.error(`grade-daily-answers: essay attempt ${row.id} failed:`, err.message);
    }
  }

  // --- dragonChallenges (the RPG intro question, see app/api/dragon-challenge)
  // -- one-time per (student, subtopic), submitted but not yet graded.
  // Deliberately excluded from dailyResultsDigests/mastery: this is a
  // diagnostic taken cold, before any teaching, not a scored study action.
  const pendingDragonChallenges = await db
    .select()
    .from(dragonChallenges)
    .where(and(isNotNull(dragonChallenges.submittedAt), isNull(dragonChallenges.score)))
    .orderBy(asc(dragonChallenges.submittedAt))
    .limit(MAX_ITEMS_PER_TYPE_PER_RUN);

  let dragonChallengesGraded = 0;
  for (const row of pendingDragonChallenges) {
    try {
      const subtopicRow = await subtopicText(row.subtopicId);
      if (!subtopicRow) continue;

      const feedback = await gradeAnswer({
        questionText: row.questionText,
        marks: row.marks,
        subtopicText: subtopicRow.topicText,
        answerText: row.answerText,
        subjectConfig: getSubjectConfig(subtopicRow.subjectId),
      });

      await db
        .update(dragonChallenges)
        .set({ score: feedback.score, feedback, gradedAt: new Date() })
        .where(and(eq(dragonChallenges.userId, row.userId), eq(dragonChallenges.subtopicId, row.subtopicId)));
      dragonChallengesGraded++;
    } catch (err) {
      console.error(`grade-daily-answers: dragon challenge (${row.userId}, ${row.subtopicId}) failed:`, err.message);
    }
  }

  // --- mockTestQuestions (only answered ones -- an unanswered question has
  // answerText:null too, and must never be sent for grading) ---
  const pendingMockQuestions = await db
    .select()
    .from(mockTestQuestions)
    .where(and(isNull(mockTestQuestions.score), isNotNull(mockTestQuestions.answerText)))
    .orderBy(asc(mockTestQuestions.id))
    .limit(MAX_ITEMS_PER_TYPE_PER_RUN);

  const touchedMockTestIds = new Set();
  for (const row of pendingMockQuestions) {
    try {
      const [test] = await db.select().from(mockTests).where(eq(mockTests.id, row.mockTestId));
      if (!test) continue;
      const subtopicRow = await subtopicText(row.subtopicId);

      const feedback = await gradeAnswer({
        questionText: row.questionText,
        marks: row.marks,
        subtopicText: subtopicRow?.topicText ?? row.subtopicId,
        answerText: row.answerText,
        subjectConfig: getSubjectConfig(test.subjectId),
      });

      await db.update(mockTestQuestions).set({ score: feedback.score, feedback }).where(eq(mockTestQuestions.id, row.id));
      if (isPassingScore(feedback.score)) await recordMissionSafe(test.userId, "pass");

      recordForDigest(test.userId, test.startedAt, row.subtopicId, subtopicRow?.topicText, feedback.score);
      touchedMockTestIds.add(test.id);
      mockQuestionsGraded++;
    } catch (err) {
      console.error(`grade-daily-answers: mock test question ${row.id} failed:`, err.message);
    }
  }

  // A touched test's totalScore can now be finalized once every ANSWERED
  // question in it has a score -- this is the aggregation
  // ../finish/route.js used to do inline at submit time, moved here since
  // grading no longer finishes within the same request/day.
  for (const mockTestId of touchedMockTestIds) {
    const [test] = await db.select().from(mockTests).where(eq(mockTests.id, mockTestId));
    if (!test || test.totalScore !== null) continue;
    const questions = await db.select().from(mockTestQuestions).where(eq(mockTestQuestions.mockTestId, mockTestId));
    const stillPending = questions.some((q) => q.answerText !== null && q.score === null);
    if (stillPending) continue;
    const totalScore = questions.reduce((sum, q) => sum + Math.round(((q.score ?? 0) / 100) * q.marks), 0);
    await db.update(mockTests).set({ totalScore }).where(eq(mockTests.id, mockTestId));
  }

  // --- write today's dailyResultsDigests rows (attempts + mockTestQuestions only) ---
  for (const acc of digestAcc.values()) {
    const bySubtopic = [...acc.bySubtopic.values()].map((b) => ({
      subtopicId: b.subtopicId,
      topicText: b.topicText,
      itemCount: b.itemCount,
      avgScore: Math.round(b.totalScore / b.itemCount),
    }));
    await db
      .insert(dailyResultsDigests)
      .values({
        userId: acc.userId,
        date: acc.date,
        itemCount: acc.itemCount,
        avgScore: Math.round(acc.totalScore / acc.itemCount),
        bySubtopic,
      })
      .onConflictDoUpdate({
        target: [dailyResultsDigests.userId, dailyResultsDigests.date],
        set: { itemCount: acc.itemCount, avgScore: Math.round(acc.totalScore / acc.itemCount), bySubtopic, generatedAt: new Date() },
      });
  }

  return NextResponse.json({
    attemptsGraded,
    essaysGraded,
    dragonChallengesGraded,
    mockQuestionsGraded,
    digestsWritten: digestAcc.size,
  });
}
