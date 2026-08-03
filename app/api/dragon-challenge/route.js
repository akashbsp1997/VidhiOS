// app/api/dragon-challenge/route.js
//
// GET lazily creates this subtopic's one-time Dragon's Challenge (preferring
// a real Mains PYQ over an AI-invented question, same precedent as
// lib/ai/generateModules.js's module planning), at most one AI call, same
// "at most one AI phase per request" discipline as every other content
// route. POST saves the student's answer and marks it pending -- grading
// happens in tonight's batch run (app/api/cron/grade-daily-answers), same
// 2026-07-24 convention as attempts/essayAttempts. Submitting, not being
// graded, is what the dispatcher (app/learn/[subtopicId]/page.jsx) treats
// as "done" -- a student is never blocked waiting on the dragon's verdict.
export const maxDuration = 30;

import { NextResponse } from "next/server";
import { and, eq, desc, sql } from "drizzle-orm";
import { db } from "../../../lib/db.js";
import { subtopics, pyqs, dragonChallenges } from "../../../db/schema.js";
import { generateDragonQuestion } from "../../../lib/ai/generateDragonChallenge.js";
import { getSessionUserId } from "../../../lib/supabase/server.js";
import { getSubjectConfig } from "../../../lib/subjects/config.js";
import { isSubjectUnlocked, checkLockdown } from "../../../lib/adaptive/subjectUnlockState.js";

// A question below this doesn't read as "tough Mains-level" -- below it,
// generate one instead of reusing a real but too-minor PYQ.
const MIN_MARKS_FOR_REAL_PYQ = 10;

export async function GET(request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const subtopicId = searchParams.get("subtopicId");
  if (!subtopicId) return NextResponse.json({ error: "subtopicId is required" }, { status: 400 });

  try {
    const lockdown = await checkLockdown(userId);
    if (lockdown) return NextResponse.json({ error: "locked_down", ...lockdown }, { status: 403 });

    const subtopicRows = await db.select().from(subtopics).where(eq(subtopics.id, subtopicId));
    const subtopicRow = subtopicRows[0];
    if (!subtopicRow) return NextResponse.json({ error: `Unknown subtopic: ${subtopicId}` }, { status: 404 });
    if (!(await isSubjectUnlocked(userId, subtopicRow.subjectId))) {
      return NextResponse.json({ error: "subject_locked" }, { status: 403 });
    }

    const existingRows = await db
      .select()
      .from(dragonChallenges)
      .where(and(eq(dragonChallenges.userId, userId), eq(dragonChallenges.subtopicId, subtopicId)));
    if (existingRows[0]) {
      const c = existingRows[0];
      return NextResponse.json({
        questionText: c.questionText,
        marks: c.marks,
        submittedAt: c.submittedAt,
        score: c.score,
        feedback: c.feedback,
      });
    }

    const realPyqRows = await db
      .select()
      .from(pyqs)
      .where(and(sql`${subtopicId} = ANY(${pyqs.topics})`, sql`${pyqs.marks} >= ${MIN_MARKS_FOR_REAL_PYQ}`))
      .orderBy(desc(pyqs.marks))
      .limit(1);

    let questionText, marks, pyqId;
    if (realPyqRows[0]) {
      ({ questionText, marks, id: pyqId } = realPyqRows[0]);
    } else {
      const subjectConfig = getSubjectConfig(subtopicRow.subjectId);
      const generated = await generateDragonQuestion({ subtopicText: subtopicRow.topicText, subjectConfig });
      questionText = generated.questionText;
      marks = generated.marks;
      pyqId = null;
    }

    const [saved] = await db
      .insert(dragonChallenges)
      .values({ userId, subtopicId, questionText, marks, pyqId })
      .onConflictDoNothing()
      .returning();
    // onConflictDoNothing can return nothing under a race (two tabs open at
    // once) -- re-read rather than assume `saved` exists.
    const finalRow = saved ?? (await db.select().from(dragonChallenges).where(and(eq(dragonChallenges.userId, userId), eq(dragonChallenges.subtopicId, subtopicId))))[0];

    return NextResponse.json({
      questionText: finalRow.questionText,
      marks: finalRow.marks,
      submittedAt: finalRow.submittedAt,
      score: finalRow.score,
      feedback: finalRow.feedback,
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
    const { subtopicId, answerText } = await request.json();
    if (!subtopicId || !answerText || !answerText.trim()) {
      return NextResponse.json({ error: "subtopicId and answerText are required" }, { status: 400 });
    }

    const existingRows = await db
      .select()
      .from(dragonChallenges)
      .where(and(eq(dragonChallenges.userId, userId), eq(dragonChallenges.subtopicId, subtopicId)));
    if (!existingRows[0]) {
      return NextResponse.json({ error: "No Dragon's Challenge question found for this subtopic yet -- load it first." }, { status: 404 });
    }

    await db
      .update(dragonChallenges)
      .set({ answerText, submittedAt: new Date() })
      .where(and(eq(dragonChallenges.userId, userId), eq(dragonChallenges.subtopicId, subtopicId)));

    return NextResponse.json({ pending: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
