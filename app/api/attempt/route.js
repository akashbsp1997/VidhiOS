// app/api/attempt/route.js
//
// GET  ?subtopicId=CA1 (optional) -> the next question to answer. Omit
//      subtopicId for full adaptive mode (engine picks the subtopic too).
// POST { subtopicId, questionSource, questionRefId, questionTextSnapshot,
//        difficultyTier, marks, answerText } -> SAVES the attempt only, no
//      AI grading call and no mastery/tier update happen here anymore (see
//      the 2026-07-24 overnight-batch-grading change) -- grading and the
//      mastery/tier update both happen later, in
//      app/api/cron/grade-daily-answers/route.js's nightly run, via
//      lib/adaptive/masteryUpdate.js's applyGradedScore. Response is
//      { pending: true, attemptId }, not { feedback, mastery }. Does NOT
//      return the next question either way — call GET again (keeps the two
//      concerns separate; see docs/ARCHITECTURE.md).

// Explicit, not left at the platform default -- GET makes at most one AI
// call (generateQuestion), bounded by lib/ai/client.js's 25s timeout; POST
// makes none anymore (grading moved to the nightly batch cron, see below).
// 90s leaves headroom above that for the DB work either side without
// assuming the account's actual default ceiling is high enough (this
// project has needed to raise it explicitly before -- see
// app/api/lesson/route.js's history).
export const maxDuration = 90;

import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../../lib/db.js";
import { subtopics, mastery, pyqs, modelQuestions, attempts, sources, lessonModules, subjects } from "../../../db/schema.js";
import { chooseSubtopic, chooseQuestionPlan } from "../../../lib/adaptive/engine.js";
import { generateQuestion } from "../../../lib/ai/generateQuestion.js";
import { generateModuleTest } from "../../../lib/ai/generateModules.js";
import { getSessionUserId } from "../../../lib/supabase/server.js";
import { getSubjectConfig } from "../../../lib/subjects/config.js";
import { loadPaperLockMap } from "../../../lib/adaptive/lockState.js";
import { computeModuleLocks, isStageUnlocked } from "../../../lib/adaptive/unlocks.js";
import { isSubjectUnlocked, loadUnlockedSubjectIds } from "../../../lib/adaptive/subjectUnlockState.js";
import { isGatedCategory } from "../../../lib/adaptive/subjectUnlocks.js";
import { recordMissionSafe } from "../../../lib/gamification/missions.js";
import { recentCurrentAffairsExcerpts, pickReferencePyqs, labeledSourceExcerptBlocks } from "../../../lib/ai/contentGrounding.js";

// A module-level Test (components/ModuleTestPanel.jsx) always wants exactly
// its one question for a known subtopic+module, never the adaptive engine's
// subtopic-choosing logic -- there's only ever one question to serve per
// module, not a pool to rotate through. This short-circuits GET entirely,
// mirroring how `forcedSubtopicId` already short-circuits chooseSubtopic
// below, one level narrower.
//
// Every module's Test is generated now (2026-07-24 "content-first" change)
// -- a PYQ-anchored module (moduleRow.pyqId set) used to serve that exact
// real question verbatim, zero AI; it now generates a NEW question grounded
// in this module's own teachContent, using the anchor PYQ only as a
// difficulty/style/topic reference (see lib/ai/generateModules.js's
// generateModuleTest). The pyqId still matters for the module PLAN phase
// (which real questions the module list is built around, see
// app/api/module-lesson/route.js) and for the "grounded in a real PYQ" badge
// -- only the Test-stage SERVING mechanism changed.
async function handleModuleQuestion(userId, subtopicId, moduleId, { force = false } = {}) {
  const subtopicRows = await db.select().from(subtopics).where(eq(subtopics.id, subtopicId));
  const subtopicRow = subtopicRows[0];
  if (!subtopicRow) return NextResponse.json({ error: `Unknown subtopic: ${subtopicId}` }, { status: 404 });

  const moduleRows = await db.select().from(lessonModules).where(eq(lessonModules.id, moduleId));
  const moduleRow = moduleRows[0];
  if (!moduleRow || moduleRow.subtopicId !== subtopicId) {
    return NextResponse.json({ error: `Unknown module ${moduleId} for subtopic ${subtopicId}` }, { status: 404 });
  }

  if (!(await isSubjectUnlocked(userId, subtopicRow.subjectId))) {
    return NextResponse.json({ error: "subject_locked" }, { status: 403 });
  }

  const lockMap = await loadPaperLockMap(userId, subtopicRow.subjectId, subtopicRow.paper);
  if (lockMap.get(subtopicId)?.locked) {
    return NextResponse.json({ error: "locked", ...lockMap.get(subtopicId) }, { status: 403 });
  }

  const masteryRows = await db.select().from(mastery).where(and(eq(mastery.userId, userId), eq(mastery.subtopicId, subtopicId)));
  const masteryRow = masteryRows[0];
  const tier = masteryRow?.currentTier ?? 1;
  const moduleProgress = masteryRow?.moduleProgress ?? {};
  const subtopicMasteryScore = masteryRow?.masteryScore ?? 0;

  const allModules = await db
    .select({ id: lessonModules.id, orderIndex: lessonModules.orderIndex })
    .from(lessonModules)
    .where(eq(lessonModules.subtopicId, subtopicId));
  const moduleLocks = computeModuleLocks(
    [...allModules].sort((a, b) => a.orderIndex - b.orderIndex),
    moduleProgress,
    subtopicMasteryScore
  );
  if (moduleLocks.get(moduleId)?.locked) {
    return NextResponse.json({ error: "module_locked", ...moduleLocks.get(moduleId) }, { status: 403 });
  }

  const unlockedStage = moduleProgress[String(moduleId)]?.highestStage ?? "teach";
  if (!isStageUnlocked("test", unlockedStage)) {
    return NextResponse.json({ error: "stage_locked", requiredStage: unlockedStage }, { status: 403 });
  }

  // The anchor PYQ (when set) is fetched purely as a generation reference
  // now -- never served directly. groundedInPyq surfaces that provenance to
  // the client honestly (this question was generated in the style of a real
  // PYQ) without implying the served text IS that PYQ.
  let anchorPyq = null;
  if (moduleRow.pyqId) {
    const pyqRows = await db.select().from(pyqs).where(eq(pyqs.id, moduleRow.pyqId));
    anchorPyq = pyqRows[0] ?? null;
  }
  const groundedInPyq = anchorPyq ? { year: anchorPyq.year, marks: anchorPyq.marks } : null;

  // `force=true` (components/ModuleTestPanel.jsx's "Retry this test") always
  // means "generate a fresh one now" -- every module's Test is generated, so
  // there's no more "fixed real text" case to special-case. Without `force`,
  // prefer a cached row this user hasn't already attempted, over always
  // reusing the very first one ever generated.
  let questionRow;
  if (!force) {
    const cachedRows = await db
      .select()
      .from(modelQuestions)
      .where(and(eq(modelQuestions.subtopicId, subtopicId), eq(modelQuestions.moduleId, moduleId)));
    if (cachedRows.length) {
      const seenRows = await db
        .select({ id: attempts.questionRefId })
        .from(attempts)
        .where(and(eq(attempts.userId, userId), eq(attempts.moduleId, moduleId)));
      const seen = new Set(seenRows.map((r) => String(r.id)));
      questionRow = cachedRows.find((q) => !seen.has(String(q.id))) || cachedRows[0];
    }
  }

  if (!questionRow) {
    const generated = await generateModuleTest({
      subtopicText: subtopicRow.topicText,
      moduleTitle: moduleRow.title,
      moduleScope: moduleRow.scopeNote,
      teachContent: moduleRow.teachContent,
      pyqQuestionText: anchorPyq?.questionText,
      pyqMarks: anchorPyq?.marks,
      subjectConfig: getSubjectConfig(subtopicRow.subjectId),
    });
    [questionRow] = await db
      .insert(modelQuestions)
      .values({
        subtopicId,
        moduleId,
        difficultyTier: tier,
        marks: generated.marks,
        questionText: generated.questionText,
      })
      .returning();
  }

  return NextResponse.json({
    subtopicId,
    subtopicText: subtopicRow.topicText,
    moduleId,
    tier,
    questionSource: "model",
    questionRefId: String(questionRow.id),
    questionText: questionRow.questionText,
    marks: questionRow.marks,
    groundedInPyq,
  });
}

export async function GET(request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const forcedSubtopicId = searchParams.get("subtopicId") || undefined;
  const moduleIdParam = searchParams.get("moduleId");
  const force = searchParams.get("force") === "true";

  try {
    if (moduleIdParam) {
      if (!forcedSubtopicId) return NextResponse.json({ error: "subtopicId is required alongside moduleId" }, { status: 400 });
      return await handleModuleQuestion(userId, forcedSubtopicId, Number(moduleIdParam), { force });
    }

    const allSubtopics = await db.select().from(subtopics);
    if (!allSubtopics.length) {
      return NextResponse.json(
        { error: "No subtopics found. Run `npm run seed` after your first `drizzle-kit push` — see README." },
        { status: 404 }
      );
    }
    const allMastery = await db.select().from(mastery).where(eq(mastery.userId, userId));
    const masteryBySubtopic = Object.fromEntries(allMastery.map((m) => [m.subtopicId, m]));

    // Direct-URL bypass check (e.g. /practice/{lockedSubtopicId}) -- a
    // locked subtopic must 403 here even though nothing in the UI would
    // normally link to it. Subject-level gate checked first (cheaper, and
    // logically prior -- a subtopic in a not-yet-unlocked subject has no
    // meaningful paper-lock state to report).
    if (forcedSubtopicId) {
      const forcedRow = allSubtopics.find((s) => s.id === forcedSubtopicId);
      if (forcedRow) {
        if (!(await isSubjectUnlocked(userId, forcedRow.subjectId))) {
          return NextResponse.json({ error: "subject_locked" }, { status: 403 });
        }
        const lockMap = await loadPaperLockMap(userId, forcedRow.subjectId, forcedRow.paper);
        if (lockMap.get(forcedSubtopicId)?.locked) {
          return NextResponse.json({ error: "locked", ...lockMap.get(forcedSubtopicId) }, { status: 403 });
        }
      }
    }

    // No forced subtopic: the adaptive lottery must never land on a locked
    // subtopic OR a subtopic whose whole subject isn't unlocked yet. Subject
    // gate first (one query for all this user's unlocked ids + one for
    // every subject's category, not per-subtopic), then the existing
    // per-(subjectId,paper) paper-lock pass.
    let eligibleSubtopics = allSubtopics;
    if (!forcedSubtopicId) {
      const { unlockedGsIds, optionalSubjectId } = await loadUnlockedSubjectIds(userId);
      const allSubjectRows = await db.select({ id: subjects.id, category: subjects.category }).from(subjects);
      const categoryBySubject = Object.fromEntries(allSubjectRows.map((s) => [s.id, s.category]));
      const subjectUnlockedForUser = (subjectId) => {
        const category = categoryBySubject[subjectId];
        if (!isGatedCategory(category)) return true;
        return unlockedGsIds.includes(subjectId) || optionalSubjectId === subjectId;
      };

      const groups = {};
      for (const s of allSubtopics) {
        if (!subjectUnlockedForUser(s.subjectId)) continue;
        const key = `${s.subjectId}::${s.paper}`;
        (groups[key] ??= []).push(s);
      }
      const lockedIds = new Set();
      for (const key of Object.keys(groups)) {
        const [subjectId, paperStr] = key.split("::");
        const lockMap = await loadPaperLockMap(userId, subjectId, Number(paperStr));
        for (const [id, info] of lockMap.entries()) {
          if (info.locked) lockedIds.add(id);
        }
      }
      eligibleSubtopics = allSubtopics.filter((s) => subjectUnlockedForUser(s.subjectId) && !lockedIds.has(s.id));

      // The adaptive lottery must never cold-pick a subtopic the student has
      // never actually opened via Teach -- a mastery row only ever gets
      // created on a first Teach/module visit (app/api/lesson/route.js,
      // app/api/module-lesson/route.js), so its presence is exactly "has
      // this subtopic been taught at all yet." Without this, a brand-new,
      // never-taught subtopic was just as eligible as one the student had
      // actually studied, so adaptive practice could -- and did -- quiz on
      // material never covered. A `forcedSubtopicId` request (a student
      // explicitly opening Practice for one specific subtopic, e.g. from its
      // own page) is NOT filtered this way -- that's a deliberate choice by
      // the student, not the auto-lottery.
      eligibleSubtopics = eligibleSubtopics.filter((s) => masteryBySubtopic[s.id] != null);
    }

    if (!forcedSubtopicId && !eligibleSubtopics.length) {
      return NextResponse.json(
        { error: "Nothing to practice yet -- start today's Learn topics first, then adaptive practice opens up for them." },
        { status: 409 }
      );
    }

    const subtopicStates = eligibleSubtopics.map((s) => ({
      id: s.id,
      mastery: masteryBySubtopic[s.id]?.masteryScore ?? 0,
      pyqFrequency: s.pyqFrequency,
    }));

    const subtopicId = forcedSubtopicId || chooseSubtopic(subtopicStates);
    const subtopicRow = allSubtopics.find((s) => s.id === subtopicId);
    if (!subtopicRow) {
      return NextResponse.json({ error: `Unknown subtopic: ${subtopicId}` }, { status: 404 });
    }
    const tier = masteryBySubtopic[subtopicId]?.currentTier ?? 1;

    // pyqPool is fetched as a GENERATION REFERENCE now, never served
    // directly (see the 2026-07-24 "content-first" change) -- real PYQs are
    // never again the literal text a student answers outside mock tests.
    const pyqPool = await db.select().from(pyqs).where(sql`${subtopicId} = ANY(${pyqs.topics})`);
    const modelPool = await db.select().from(modelQuestions).where(eq(modelQuestions.subtopicId, subtopicId));
    const seenRows = await db
      .select({ id: attempts.questionRefId })
      .from(attempts)
      .where(and(eq(attempts.subtopicId, subtopicId), eq(attempts.userId, userId)));
    const seenQuestionRefIds = seenRows.map((r) => r.id);

    const plan = chooseQuestionPlan({ tier, seenQuestionRefIds, modelPool });

    let questionText, marks, questionRefId;
    let groundedInPyq = null;

    if (plan.source === "model") {
      const q = modelPool.find((m) => String(m.id) === String(plan.id));
      if (!q) return NextResponse.json({ error: "Planned model question vanished — try again" }, { status: 500 });
      questionText = q.questionText;
      marks = q.marks;
      questionRefId = String(q.id);
    } else {
      const srcRows = await db.select().from(sources).where(eq(sources.subtopicId, subtopicId));
      const sourceExcerpts = labeledSourceExcerptBlocks(srcRows);
      const currentAffairsExcerpts = await recentCurrentAffairsExcerpts(subtopicId);
      const referencePyqs = pickReferencePyqs(pyqPool, seenQuestionRefIds);
      if (referencePyqs[0]) groundedInPyq = { year: referencePyqs[0].year, marks: referencePyqs[0].marks };

      const generated = await generateQuestion({
        subtopicText: subtopicRow.topicText,
        difficultyTier: plan.difficultyTier,
        sourceExcerpts,
        currentAffairsExcerpts,
        referencePyqs,
        subjectConfig: getSubjectConfig(subtopicRow.subjectId),
      });
      const [inserted] = await db
        .insert(modelQuestions)
        .values({
          subtopicId,
          difficultyTier: plan.difficultyTier,
          marks: generated.marks,
          questionText: generated.questionText,
        })
        .returning();
      questionText = inserted.questionText;
      marks = inserted.marks;
      questionRefId = String(inserted.id);
    }

    return NextResponse.json({
      subtopicId,
      subtopicText: subtopicRow.topicText,
      tier,
      questionSource: "model",
      questionRefId,
      groundedInPyq,
      questionText,
      marks,
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
    const body = await request.json();
    const { subtopicId, questionSource, questionRefId, questionTextSnapshot, difficultyTier, marks, answerText, moduleId } = body || {};

    if (!subtopicId || !questionRefId || !questionTextSnapshot || typeof answerText !== "string") {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const subtopicRows = await db.select().from(subtopics).where(eq(subtopics.id, subtopicId));
    const subtopicRow = subtopicRows[0];
    if (!subtopicRow) return NextResponse.json({ error: "Unknown subtopic" }, { status: 404 });

    if (!(await isSubjectUnlocked(userId, subtopicRow.subjectId))) {
      return NextResponse.json({ error: "subject_locked" }, { status: 403 });
    }

    const [inserted] = await db
      .insert(attempts)
      .values({
        userId,
        subtopicId,
        questionSource: questionSource || "pyq",
        questionRefId: String(questionRefId),
        questionTextSnapshot,
        difficultyTier: difficultyTier || 1,
        marks: marks || 15,
        answerText,
        score: null, // graded overnight -- see app/api/cron/grade-daily-answers/route.js
        feedback: null,
        moduleId: moduleId || null,
      })
      .returning();

    // Bumping testAttempts is a pure DB write (no AI, no score needed), so
    // it still happens immediately -- it's what the NEXT module's
    // attempt-count unlock condition checks (lib/adaptive/unlocks.js's
    // computeModuleLocks). The mastery-FLOOR condition for that same next
    // module still needs tonight's grading; bestScore01 is likewise only
    // knowable once a score exists, so that update lives in
    // lib/adaptive/masteryUpdate.js's applyGradedScore, called by the
    // grading cron, not here.
    if (moduleId) {
      const existingRows = await db
        .select()
        .from(mastery)
        .where(and(eq(mastery.userId, userId), eq(mastery.subtopicId, subtopicId)));
      const existing = existingRows[0];
      const moduleProgress = { ...(existing?.moduleProgress ?? {}) };
      const key = String(moduleId);
      const prevEntry = moduleProgress[key] ?? {};
      moduleProgress[key] = { ...prevEntry, testAttempts: (prevEntry.testAttempts ?? 0) + 1 };

      if (existing) {
        await db
          .update(mastery)
          .set({ moduleProgress })
          .where(and(eq(mastery.userId, userId), eq(mastery.subtopicId, subtopicId)));
      } else {
        await db.insert(mastery).values({ userId, subtopicId, moduleProgress });
      }
    }

    const practiceMission = await recordMissionSafe(userId, "practice");
    const missionRewards = [practiceMission].filter((m) => m?.newlyCompleted).map((m) => m.item);

    return NextResponse.json({ pending: true, attemptId: inserted.id, missionRewards });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
