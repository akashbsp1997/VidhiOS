// app/api/mock-tests/route.js
//
// GET            -> this user's past mock tests (history list).
// GET ?id=<id>   -> one test's full state (questions + answers/scores if
//      graded) -- used both to resume an in-progress test and to view a
//      finished one's report.
// POST { subjectId, size } -> starts a new mock test: a bundle of several
//      questions from that subject, drawn as REAL PYQs first (authentic and
//      free -- no generation call), falling back to AI-generated questions
//      only if the subject doesn't have enough real PYQs to fill the paper.
//      Grading happens later, one question at a time (see
//      /api/mock-tests/grade-question) -- never in this request, and never
//      all at once, so a 20-question full mock can't blow past a serverless
//      function's time limit the way grading everything in one request
//      would.
//
// POST can call generateQuestion in a loop (see the fallback-fill section
// below) when a subject's real PYQ bank can't cover `questionCount` --
// several sequential AI calls, unlike every other AI-calling route in this
// app, which does exactly one. 120s (not 60s) to give that loop real room;
// still a real risk for a subject with few/no PYQs (GS1/GS3/GS4 today) on
// a full 20-question mock, where nearly every question needs generating.
export const maxDuration = 120;

import { NextResponse } from "next/server";
import { and, eq, desc } from "drizzle-orm";
import { db } from "../../../lib/db.js";
import { subtopics, sources, pyqs, mockTests, mockTestQuestions, modelQuestions, subjects } from "../../../db/schema.js";
import { getSessionUserId } from "../../../lib/supabase/server.js";
import { getSubjectConfig } from "../../../lib/subjects/config.js";
import { generateQuestion } from "../../../lib/ai/generateQuestion.js";
import { labeledSourceExcerptBlocks } from "../../../lib/ai/contentGrounding.js";
import { isSubjectUnlocked, checkLockdown } from "../../../lib/adaptive/subjectUnlockState.js";

// Real GS Mains paper: 20 questions, 250 marks, 3 hours. Sectional is a
// shorter practice slice, not a real paper size -- just enough to be a
// focused session rather than the full exam commitment.
const SIZE_CONFIG = {
  sectional: { questionCount: 5, durationMinutes: 45 },
  full: { questionCount: 20, durationMinutes: 180 },
};

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export async function GET(request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (id) {
      const [test] = await db.select().from(mockTests).where(eq(mockTests.id, Number(id)));
      if (!test || test.userId !== userId) return NextResponse.json({ error: "Not found" }, { status: 404 });

      const questionRows = await db.select().from(mockTestQuestions).where(eq(mockTestQuestions.mockTestId, test.id));
      const subtopicRows = await db.select({ id: subtopics.id, topicText: subtopics.topicText }).from(subtopics);
      const topicTextById = Object.fromEntries(subtopicRows.map((s) => [s.id, s.topicText]));
      const ordered = [...questionRows].sort((a, b) => a.orderIndex - b.orderIndex);

      return NextResponse.json({
        mockTestId: test.id,
        subjectId: test.subjectId,
        size: test.size,
        totalMarks: test.totalMarks,
        durationMinutes: test.durationMinutes,
        startedAt: test.startedAt,
        submittedAt: test.submittedAt,
        totalScore: test.totalScore,
        questions: ordered.map((q) => ({
          id: q.id,
          orderIndex: q.orderIndex,
          subtopicId: q.subtopicId,
          subtopicText: topicTextById[q.subtopicId] ?? q.subtopicId,
          questionText: q.questionText,
          marks: q.marks,
          answerText: q.answerText,
          score: q.score,
          feedback: q.feedback,
        })),
      });
    }

    const rows = await db.select().from(mockTests).where(eq(mockTests.userId, userId)).orderBy(desc(mockTests.startedAt));
    const subjectRows = await db.select({ id: subjects.id, displayName: subjects.displayName }).from(subjects);
    const subjectById = Object.fromEntries(subjectRows.map((s) => [s.id, s]));
    return NextResponse.json({
      tests: rows.map((t) => ({
        id: t.id,
        subjectId: t.subjectId,
        subjectDisplayName: subjectById[t.subjectId]?.displayName ?? t.subjectId,
        size: t.size,
        totalMarks: t.totalMarks,
        totalScore: t.totalScore,
        startedAt: t.startedAt,
        submittedAt: t.submittedAt,
      })),
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

    const { subjectId, size, subtopicIds: requestedSubtopicIds } = await request.json();
    if (!SIZE_CONFIG[size]) return NextResponse.json({ error: "size must be 'sectional' or 'full'" }, { status: 400 });
    if (!(await isSubjectUnlocked(userId, subjectId))) {
      return NextResponse.json({ error: "subject_locked" }, { status: 403 });
    }

    const { questionCount, durationMinutes } = SIZE_CONFIG[size];

    let subjectSubtopics = await db.select().from(subtopics).where(eq(subtopics.subjectId, subjectId));
    if (!subjectSubtopics.length) {
      return NextResponse.json({ error: "This subject has no content yet." }, { status: 404 });
    }
    // Part E5: an optional caller-supplied subset -- e.g. "test me on just
    // what the fixed onboarding week covered" (see
    // db/seed/onboardingWeekPlans.js) -- narrows the pool to exactly those
    // subtopics instead of the whole subject. Still one subjectId per test
    // (unchanged schema); a week spanning PSIR + GS needs one call per
    // subject, same as any other multi-subject test today.
    if (Array.isArray(requestedSubtopicIds) && requestedSubtopicIds.length) {
      const requestedSet = new Set(requestedSubtopicIds);
      const scoped = subjectSubtopics.filter((s) => requestedSet.has(s.id));
      if (!scoped.length) {
        return NextResponse.json({ error: "None of the given subtopicIds belong to this subject." }, { status: 400 });
      }
      subjectSubtopics = scoped;
    }
    const poolSubtopicIds = subjectSubtopics.map((s) => s.id);

    // Real PYQs first -- more authentic than an AI-generated question, and
    // free (no generation call). One candidate per PYQ even if it tags
    // several of this subject's subtopics.
    const allPyqs = await db.select().from(pyqs);
    const pyqCandidates = [];
    for (const q of allPyqs) {
      const matchedSubtopic = q.topics.find((t) => poolSubtopicIds.includes(t));
      if (matchedSubtopic) {
        pyqCandidates.push({ subtopicId: matchedSubtopic, questionSource: "pyq", questionRefId: String(q.id), questionText: q.questionText, marks: q.marks });
      }
    }

    // Prefer PYQs this user hasn't already drawn into an earlier mock test,
    // falling back to reuse once the unseen pool runs out.
    const usedRows = await db
      .select({ questionRefId: mockTestQuestions.questionRefId })
      .from(mockTestQuestions)
      .innerJoin(mockTests, eq(mockTestQuestions.mockTestId, mockTests.id))
      .where(and(eq(mockTests.userId, userId), eq(mockTestQuestions.questionSource, "pyq")));
    const usedIds = new Set(usedRows.map((r) => r.questionRefId));
    const unseenPyqs = pyqCandidates.filter((c) => !usedIds.has(c.questionRefId));
    const pyqPool = shuffle(unseenPyqs.length >= questionCount ? unseenPyqs : pyqCandidates);

    const selected = pyqPool.slice(0, questionCount);

    // Not enough real PYQs to fill the paper -- generate AI questions for
    // the remainder, cycling through subtopics not already used in this test.
    if (selected.length < questionCount) {
      const usedInThisTest = new Set(selected.map((s) => s.subtopicId));
      const remaining = shuffle(subjectSubtopics.filter((s) => !usedInThisTest.has(s.id)));
      const fallbackPool = remaining.length ? remaining : shuffle(subjectSubtopics);
      const subjectConfig = getSubjectConfig(subjectId);

      let i = 0;
      while (selected.length < questionCount && fallbackPool.length && i < fallbackPool.length * 3) {
        const subtopicRow = fallbackPool[i % fallbackPool.length];
        i++;
        const srcRows = await db.select().from(sources).where(eq(sources.subtopicId, subtopicRow.id));
        const sourceExcerpts = labeledSourceExcerptBlocks(srcRows);
        const generated = await generateQuestion({ subtopicText: subtopicRow.topicText, difficultyTier: 2, sourceExcerpts, subjectConfig });
        const [inserted] = await db
          .insert(modelQuestions)
          .values({ subtopicId: subtopicRow.id, difficultyTier: 2, marks: generated.marks, questionText: generated.questionText })
          .returning();
        selected.push({ subtopicId: subtopicRow.id, questionSource: "model", questionRefId: String(inserted.id), questionText: generated.questionText, marks: generated.marks });
      }
    }

    const finalOrder = shuffle(selected);
    const totalMarks = finalOrder.reduce((sum, s) => sum + s.marks, 0);

    const [test] = await db.insert(mockTests).values({ userId, subjectId, size, totalMarks, durationMinutes }).returning();

    const insertedQuestions = await db
      .insert(mockTestQuestions)
      .values(
        finalOrder.map((q, idx) => ({
          mockTestId: test.id,
          orderIndex: idx,
          subtopicId: q.subtopicId,
          questionSource: q.questionSource,
          questionRefId: q.questionRefId,
          questionText: q.questionText,
          marks: q.marks,
        }))
      )
      .returning();

    const subtopicById = Object.fromEntries(subjectSubtopics.map((s) => [s.id, s]));
    const ordered = [...insertedQuestions].sort((a, b) => a.orderIndex - b.orderIndex);

    return NextResponse.json({
      mockTestId: test.id,
      subjectId,
      size,
      totalMarks,
      durationMinutes,
      questions: ordered.map((q) => ({
        id: q.id,
        orderIndex: q.orderIndex,
        subtopicId: q.subtopicId,
        subtopicText: subtopicById[q.subtopicId]?.topicText ?? q.subtopicId,
        questionText: q.questionText,
        marks: q.marks,
      })),
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
