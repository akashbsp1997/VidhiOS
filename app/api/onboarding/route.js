// app/api/onboarding/route.js
//
// GET  -> this user's current subject-unlock state, plus the data the
//      onboarding picker needs (recommended GS default, the 48 optional
//      choices, the placement quiz) -- so app/onboarding/page.jsx never
//      needs a second endpoint.
// POST { gsSubjectIds, optionalSubjectId, quizAnswers } -> one-time
//      initialization (see lib/adaptive/subjectUnlockState.js's
//      initializeSubjectUnlocks) PLUS scoring the mandatory placement quiz
//      (db/seed/placementQuiz.js) into playerState.track -- both happen in
//      the same submit since they're one onboarding action. 409 if
//      onboarding already ran for this user -- re-picking is a distinct,
//      deliberate settings action, not something this route does silently.
// quizAnswers is { [questionId]: optionIndex } -- scored server-side against
// PLACEMENT_QUIZ_QUESTIONS, never trusting a client-computed point total.
import { NextResponse } from "next/server";
import { db } from "../../../lib/db.js";
import { subjects, playerState } from "../../../db/schema.js";
import { eq } from "drizzle-orm";
import { getSessionUserId } from "../../../lib/supabase/server.js";
import { getOptionalSubjects } from "../../../lib/subjects/papers.js";
import { RECOMMENDED_INITIAL_GS_SUBJECT_IDS, GS_UNLOCK_ORDER } from "../../../lib/adaptive/subjectUnlocks.js";
import { hasStartedOnboarding, loadUnlockedSubjectIds, initializeSubjectUnlocks } from "../../../lib/adaptive/subjectUnlockState.js";
import { PLACEMENT_QUIZ_QUESTIONS, scoreToTrack } from "../../../db/seed/placementQuiz.js";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const onboardingComplete = await hasStartedOnboarding(userId);
    const { unlockedGsIds, optionalSubjectId } = await loadUnlockedSubjectIds(userId);
    const gsSubjects = await db
      .select({ id: subjects.id, displayName: subjects.displayName })
      .from(subjects)
      .where(eq(subjects.category, "gs"));
    const gsOrdered = GS_UNLOCK_ORDER.map((id) => gsSubjects.find((s) => s.id === id)).filter(Boolean);

    return NextResponse.json({
      onboardingComplete,
      unlockedGsIds,
      optionalSubjectId,
      recommendedGsSubjectIds: RECOMMENDED_INITIAL_GS_SUBJECT_IDS,
      gsSubjects: gsOrdered,
      optionalSubjects: getOptionalSubjects(),
      placementQuiz: PLACEMENT_QUIZ_QUESTIONS,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

function scorePlacementQuiz(quizAnswers) {
  let total = 0;
  for (const q of PLACEMENT_QUIZ_QUESTIONS) {
    const idx = quizAnswers?.[q.id];
    const option = Number.isInteger(idx) ? q.options[idx] : undefined;
    total += option?.points ?? 0;
  }
  return total;
}

export async function POST(request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const { gsSubjectIds, optionalSubjectId, quizAnswers } = await request.json();
    if (!quizAnswers || typeof quizAnswers !== "object") {
      return NextResponse.json({ error: "quizAnswers is required -- the placement quiz must be completed to start your plan." }, { status: 400 });
    }

    await initializeSubjectUnlocks(userId, { gsSubjectIds, optionalSubjectId });

    const track = scoreToTrack(scorePlacementQuiz(quizAnswers));
    const [existing] = await db.select().from(playerState).where(eq(playerState.userId, userId));
    if (existing) {
      await db.update(playerState).set({ track, trackSetAt: new Date() }).where(eq(playerState.userId, userId));
    } else {
      await db.insert(playerState).values({ userId, track, trackSetAt: new Date() });
    }

    return NextResponse.json({ ok: true, track });
  } catch (err) {
    const alreadyDone = /already initialized/i.test(err.message);
    return NextResponse.json({ error: err.message }, { status: alreadyDone ? 409 : 400 });
  }
}
