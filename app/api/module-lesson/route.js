// app/api/module-lesson/route.js
//
// Module-level counterpart to app/api/lesson/route.js: a subtopic is first
// decomposed into lesson_modules rows (the "plan" phase, an AI call), then
// each module independently runs its own Teach -> Grasp/Remember cycle
// (Test lives in app/api/attempt/route.js's moduleId branch, not here).
// Kept as its own route rather than folded into /api/lesson -- that route's
// nextMissingPhase is already a single-tier state machine (core/practice/
// image for ONE subtopic-wide lesson); cramming a second, outer plan-phase
// tier on top of it would make that function meaningfully harder to audit.
// Same "at most one AI phase per request" discipline as /api/lesson, same
// reason: bundling AI calls into one request was this session's root cause
// of finish_reason:"length"/timeout failures on a free-tier model.
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { and, eq, asc, inArray } from "drizzle-orm";
import { db } from "../../../lib/db.js";
import { subtopics, sources, lessons, lessonModules, mastery, subjects, pyqs, subjectBookPlans } from "../../../db/schema.js";
import { generateModulePlan, generateModulePlanFromPyqs } from "../../../lib/ai/generateModules.js";
import { generateSubjectBookPlan } from "../../../lib/ai/generateSubjectBookPlan.js";
import { ensureModuleStagePhase } from "../../../lib/adaptive/moduleContentReady.js";
import { casesSeed } from "../../../db/seed/cases.js";
import { getSessionUserId } from "../../../lib/supabase/server.js";
import { getSubjectConfig } from "../../../lib/subjects/config.js";
import { recentCurrentAffairsExcerpts, labeledSourceExcerptBlocks } from "../../../lib/ai/contentGrounding.js";
import { loadPaperLockMap } from "../../../lib/adaptive/lockState.js";
import { computeModuleLocks, isStageUnlocked, validateStageAdvance } from "../../../lib/adaptive/unlocks.js";
import { isSubjectUnlocked, checkLockdown } from "../../../lib/adaptive/subjectUnlockState.js";
import { recordMissionSafe } from "../../../lib/gamification/missions.js";
import { markTeachDone } from "../../../lib/gamification/bounties.js";

const VALID_STAGES = ["teach", "grasp", "remember", "test"];

// A subtopic only goes PYQ-anchored (see selectPyqCandidates below) once it
// has at least this many real PYQs -- with a threshold of 1, a subtopic
// with exactly one real PYQ would get exactly one module for its entire
// Teach->Grasp->Remember->Test cycle, a hard regression from the module
// range free decomposition already guarantees. Verified against real seed
// data: this threshold routes 65% of law-optional subtopics through PYQ
// anchoring and leaves the rest (0 or 1 PYQ) on unchanged free-decomposition
// behavior, rather than collapsing 26% of the syllabus to single-module
// subtopics under a naive ">=1" threshold.
const MIN_PYQS_FOR_ANCHORING = 2;
// Raised from 5/2 (2026-07-24 "rewrite Teach" change) -- modules are now
// treated like textbook chapters, not forced to fit a small fixed count, so
// a subtopic with a genuinely deep real PYQ history (up to 24 for some GS2
// subtopics) uses far more of it instead of silently discarding most of it.
// Still a sanity ceiling, not a target -- see lib/adaptive/planEngine.js's
// daysNeededForSubtopic for how the day-plan now spans a content-heavy
// subtopic across multiple days instead of assuming one module set fits in
// one sitting.
const MAX_MODULES = 12;
const MAX_PYQS_PER_YEAR = 3;

// Wider than lib/ai/contentGrounding.js's default 60-day/5-item window (used
// for Test-generation calibration reference) -- a foundational plan/Teach
// pass is meant to be a durable base, not a "recent news" snapshot, so it
// pulls from the last year.
const PLANNING_CURRENT_AFFAIRS_WINDOW = { days: 365, limit: 12 };

// Picks up to MAX_MODULES real PYQs to anchor modules to, favoring recency
// (what UPSC currently emphasizes) as the relevance signal, capped per year
// so a subtopic with many PYQs concentrated in a couple of recent sittings
// (some gs2 subtopics have 12-24 real PYQs) still gets some spread rather
// than 5 modules from the same one or two exams. Re-sorted by marks
// ascending afterward (a defensible foundational->advanced proxy) so the
// array order handed to the AI -- and therefore each module's orderIndex --
// already reads basics-first, without needing the AI to reorder (which
// would break positional pyqId matching).
function selectPyqCandidates(pyqCandidates) {
  const byYearDesc = [...pyqCandidates].sort((a, b) => b.year - a.year);
  const selected = [];
  const perYearCount = {};
  for (const q of byYearDesc) {
    if (selected.length >= MAX_MODULES) break;
    const count = perYearCount[q.year] || 0;
    if (count >= MAX_PYQS_PER_YEAR) continue;
    selected.push(q);
    perYearCount[q.year] = count + 1;
  }
  return selected.sort((a, b) => a.marks - b.marks);
}

// Enriches plain lesson_modules rows with their anchor PYQ's year/marks (for
// the "Grounded in a real PYQ" UI badge) via one follow-up lookup, rather
// than denormalizing that data onto lesson_modules itself -- matches how
// this codebase handles other FK relationships (e.g. sources.storageUploadId)
// by referencing and re-fetching instead of duplicating.
// `moduleLocks` (optional Map from computeModuleLocks) merges locked/lockReason
// into each entry so the client never needs a separate lock-fetching round
// trip -- omit it only for the allModulesComplete response, where lock state
// is moot.
async function buildModulesSummary(moduleRows, moduleLocks) {
  const pyqIds = moduleRows.map((m) => m.pyqId).filter(Boolean);
  const anchorRows = pyqIds.length ? await db.select().from(pyqs).where(inArray(pyqs.id, pyqIds)) : [];
  const anchorById = Object.fromEntries(anchorRows.map((p) => [p.id, p]));
  return moduleRows.map((m) => {
    const anchor = m.pyqId ? anchorById[m.pyqId] : null;
    const lock = moduleLocks?.get(m.id);
    return {
      id: m.id,
      orderIndex: m.orderIndex,
      title: m.title,
      scopeNote: m.scopeNote,
      articleRef: m.articleRef || "",
      pyqId: m.pyqId ?? null,
      pyqYear: anchor?.year ?? null,
      pyqMarks: anchor?.marks ?? null,
      locked: lock?.locked ?? false,
      lockReason: lock?.reason ?? null,
      // Same requiredMasteryPct/currentMasteryPct on every locked module in
      // this subtopic (computeModuleLocks derives both from the one
      // subtopic-wide masteryScore) -- carried per-module rather than once
      // at the top level so ModuleTestPanel's "Next module" button can show
      // *why* module N+1 specifically is locked without a second fetch.
      requiredMasteryPct: lock?.requiredMasteryPct ?? null,
      currentMasteryPct: lock?.currentMasteryPct ?? null,
    };
  });
}

// Grasp is satisfied the instant the practice phase completes; Remember
// additionally needs the image phase -- same three-phase asymmetry as
// /api/lesson's STAGE_REQUIRES (Grasp doesn't need the diagram, Remember
// does).
const STAGE_REQUIRES = {
  teach: ["teach"],
  grasp: ["teach", "practice"],
  remember: ["teach", "practice", "image"],
};

function nextMissingPhase(row, requiredPhases, stage, force) {
  for (const phase of requiredPhases) {
    if (phase === "teach" && (!row?.generatedAt || (force && stage === "teach"))) return "teach";
    if (phase === "practice" && (!row?.practiceGeneratedAt || (force && stage === "grasp"))) return "practice";
    if (phase === "image" && (!row?.visualImageDataUri || (force && stage === "remember"))) return "image";
  }
  return null;
}

/**
 * Lazily loads (or generates once, cached forever, shared across every
 * student -- a syllabus plan is the same for everyone) the Subject-wide
 * book plan covering `subtopicRow`'s own (subjectId, paper, section) --
 * see db/schema.js's subjectBookPlans and lib/ai/generateSubjectBookPlan.js.
 * The first student to open ANY chapter in a Subject pays for the whole
 * Subject's plan once; every subsequent chapter (this student or anyone
 * else) reads the cached row for free. Returns this SPECIFIC chapter's
 * { modules, prerequisiteSubtopicIds } slice, never the whole plan.
 */
async function loadOrCreateSubjectBookPlan(subtopicRow, subjectConfig) {
  const existing = await db
    .select()
    .from(subjectBookPlans)
    .where(
      and(eq(subjectBookPlans.subjectId, subtopicRow.subjectId), eq(subjectBookPlans.paper, subtopicRow.paper), eq(subjectBookPlans.section, subtopicRow.section))
    );
  if (existing[0]?.planData?.[subtopicRow.id]) return existing[0].planData[subtopicRow.id];

  const siblingChapters = await db
    .select()
    .from(subtopics)
    .where(and(eq(subtopics.subjectId, subtopicRow.subjectId), eq(subtopics.paper, subtopicRow.paper), eq(subtopics.section, subtopicRow.section)))
    .orderBy(asc(subtopics.syllabusOrder));
  const siblingIds = siblingChapters.map((c) => c.id);

  // Same "fetch everything, group in JS" approach lib/adaptive/lockState.js
  // already uses for pyqs.topics -- simpler and plenty fast at this table's
  // real size than trying to push an array-overlap filter into SQL.
  const allPyqRows = await db.select().from(pyqs);
  const pyqsByChapter = {};
  for (const q of allPyqRows) {
    for (const t of q.topics) {
      if (siblingIds.includes(t)) (pyqsByChapter[t] ??= []).push(q);
    }
  }
  const sourceRows = await db.select().from(sources).where(inArray(sources.subtopicId, siblingIds));
  const sourcesByChapter = {};
  for (const row of sourceRows) (sourcesByChapter[row.subtopicId] ??= []).push(row);
  const currentAffairsByChapter = Object.fromEntries(
    await Promise.all(siblingChapters.map(async (c) => [c.id, await recentCurrentAffairsExcerpts(c.id, PLANNING_CURRENT_AFFAIRS_WINDOW)]))
  );

  const chapters = siblingChapters.map((c) => {
    const allChapterPyqs = pyqsByChapter[c.id] ?? [];
    const selected = selectPyqCandidates(allChapterPyqs);
    const anchored = selected.length >= MIN_PYQS_FOR_ANCHORING;
    return {
      subtopicId: c.id,
      topicText: c.topicText,
      mode: anchored ? "pyq-anchored" : "free",
      pyqCandidates: anchored ? selected : undefined,
      referencePyqs: !anchored && allChapterPyqs.length ? allChapterPyqs : undefined,
      sourceExcerpts: labeledSourceExcerptBlocks(sourcesByChapter[c.id] ?? []),
      currentAffairsExcerpts: currentAffairsByChapter[c.id],
      caseAnchors: casesSeed.filter((cs) => cs.topics.includes(c.id)).map((cs) => ({ case: cs.case, point: cs.point })),
    };
  });

  const planData = await generateSubjectBookPlan({ subjectConfig, sectionLabel: subtopicRow.section, chapters });

  // A free-decomposition chapter whose AI output was entirely unusable
  // falls back to an isolated single-chapter call -- the same behavior this
  // app had before the Subject-wide plan existed, so one bad chapter in a
  // Subject never blocks the rest of it.
  for (const chapter of chapters) {
    if (planData[chapter.subtopicId].modules == null) {
      const freeModules = await generateModulePlan({
        subtopicText: chapter.topicText,
        sourceExcerpts: chapter.sourceExcerpts,
        currentAffairsExcerpts: chapter.currentAffairsExcerpts,
        referencePyqs: chapter.referencePyqs,
        caseAnchors: chapter.caseAnchors,
        subjectConfig,
      });
      planData[chapter.subtopicId].modules = freeModules.map((m) => ({ ...m, pyqId: null }));
    }
  }

  // Two concurrent first-openers of the same Subject can both reach here --
  // onConflictDoNothing lets whichever insert wins stand, then every caller
  // (including the "losing" one) re-reads the row so nobody acts on their
  // own now-discarded plan.
  await db
    .insert(subjectBookPlans)
    .values({ subjectId: subtopicRow.subjectId, paper: subtopicRow.paper, section: subtopicRow.section, planData })
    .onConflictDoNothing({ target: [subjectBookPlans.subjectId, subjectBookPlans.paper, subjectBookPlans.section] });
  const finalRow = await db
    .select()
    .from(subjectBookPlans)
    .where(
      and(eq(subjectBookPlans.subjectId, subtopicRow.subjectId), eq(subjectBookPlans.paper, subtopicRow.paper), eq(subjectBookPlans.section, subtopicRow.section))
    );
  const finalPlanData = finalRow[0]?.planData ?? planData;

  // Cross-chapter prerequisite edges, backfilled from whichever plan
  // actually won the race above -- see db/schema.js's
  // subtopics.prerequisiteSubtopicIds, consumed by
  // lib/adaptive/unlocks.js's computeCrossChapterLocks (gating) and
  // lib/adaptive/planEngine.js's assignLearningDays (scheduling). One-time,
  // only runs the first time this Subject's plan is generated -- a no-op
  // read-only path on every later chapter-open once cached.
  for (const chapter of chapters) {
    const prereqs = finalPlanData[chapter.subtopicId]?.prerequisiteSubtopicIds ?? [];
    if (prereqs.length) {
      await db.update(subtopics).set({ prerequisiteSubtopicIds: prereqs }).where(eq(subtopics.id, chapter.subtopicId));
    }
  }

  return finalPlanData[subtopicRow.id] ?? planData[subtopicRow.id];
}

export async function GET(request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const subtopicId = searchParams.get("subtopicId");
  const moduleIndex = Number(searchParams.get("moduleIndex") ?? 0);
  const stage = searchParams.get("stage") || "teach";
  const force = searchParams.get("force") === "true";
  // Bypasses the legacy-lessons short-circuit below even when a complete
  // legacy row exists -- the one-click "Upgrade to modules" action in
  // components/LegacyLearnFlow.jsx. Once this runs once, lesson_modules has
  // rows for the subtopic and every future GET takes the normal module path
  // without needing this flag again.
  const upgrade = searchParams.get("upgrade") === "true";
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

    const lockMap = await loadPaperLockMap(userId, subtopicRow.subjectId, subtopicRow.paper);
    const subtopicLockInfo = lockMap.get(subtopicId);
    if (subtopicLockInfo?.locked) {
      return NextResponse.json({ error: "locked", ...subtopicLockInfo }, { status: 403 });
    }

    const subjectRows = await db.select().from(subjects).where(eq(subjects.id, subtopicRow.subjectId));
    const subjectDisplayName = subjectRows[0]?.displayName ?? subtopicRow.subjectId;
    const subjectConfig = getSubjectConfig(subtopicRow.subjectId);

    const masteryRows = await db
      .select()
      .from(mastery)
      .where(and(eq(mastery.userId, userId), eq(mastery.subtopicId, subtopicId)));
    const masteryRow = masteryRows[0];
    const subtopicMasteryScore = masteryRow?.masteryScore ?? 0;
    const moduleProgress = masteryRow?.moduleProgress ?? {};

    const modules = await db
      .select()
      .from(lessonModules)
      .where(eq(lessonModules.subtopicId, subtopicId))
      .orderBy(asc(lessonModules.orderIndex));

    if (modules.length === 0) {
      if (!upgrade) {
        const legacyRows = await db.select().from(lessons).where(eq(lessons.subtopicId, subtopicId));
        const legacyRow = legacyRows[0];
        if (legacyRow && legacyRow.practiceGeneratedAt) {
          return NextResponse.json({ legacyAvailable: true, ready: false });
        }
      }

      // Sourced from this chapter's Subject-wide book plan (generated once,
      // cached forever per (subjectId, paper, section) -- see
      // lib/ai/generateSubjectBookPlan.js) instead of an isolated
      // per-chapter call, so sibling chapters in the same Subject inform
      // each other's module boundaries and cross-chapter prerequisites.
      const { modules: planned } = await loadOrCreateSubjectBookPlan(subtopicRow, subjectConfig);

      const inserted = await db
        .insert(lessonModules)
        .values(planned.map((m, i) => ({ subtopicId, orderIndex: i, title: m.title, scopeNote: m.scopeNote, articleRef: m.articleRef ?? "", pyqId: m.pyqId })))
        .returning();

      // computeModuleLocks relies on array order matching orderIndex order --
      // RETURNING typically preserves multi-row VALUES order in Postgres, but
      // this sort makes that assumption explicit rather than relied-upon.
      const insertedOrdered = [...inserted].sort((a, b) => a.orderIndex - b.orderIndex);
      const freshLocks = computeModuleLocks(insertedOrdered, moduleProgress, subtopicMasteryScore);
      return NextResponse.json({
        subtopicId,
        subtopicText: subtopicRow.topicText,
        subjectDisplayName,
        modules: await buildModulesSummary(insertedOrdered, freshLocks),
        ready: false,
        nextPhase: "module-teach",
      });
    }

    const moduleLocks = computeModuleLocks(modules, moduleProgress, subtopicMasteryScore);

    if (moduleIndex >= modules.length) {
      return NextResponse.json({
        subtopicId,
        subtopicText: subtopicRow.topicText,
        subjectDisplayName,
        modules: await buildModulesSummary(modules, moduleLocks),
        allModulesComplete: true,
      });
    }

    const row = modules[moduleIndex];
    if (moduleLocks.get(row.id)?.locked) {
      return NextResponse.json({ error: "module_locked", ...moduleLocks.get(row.id) }, { status: 403 });
    }

    const unlockedStage = moduleProgress[String(row.id)]?.highestStage ?? "teach";
    if (!isStageUnlocked(stage, unlockedStage)) {
      return NextResponse.json({ error: "stage_locked", requiredStage: unlockedStage }, { status: 403 });
    }

    // Only recorded once every lock check above has passed -- a 403'd
    // request never counts as "engaged with learning content today."
    await recordMissionSafe(userId, "learn");
    await markTeachDone(userId, subtopicId);

    const phase = nextMissingPhase(row, STAGE_REQUIRES[stage] ?? [], stage, force);
    const modulesSummary = await buildModulesSummary(modules, moduleLocks);

    if (phase === null) {
      return NextResponse.json({
        subtopicId,
        subtopicText: subtopicRow.topicText,
        subjectDisplayName,
        modules: modulesSummary,
        moduleIndex,
        unlockedStage,
        ...row,
        ready: true,
        cached: true,
      });
    }

    if (phase === "teach") {
      const saved = await ensureModuleStagePhase(row, subtopicRow, subjectConfig, "teach", userId);
      return NextResponse.json({
        subtopicId,
        subtopicText: subtopicRow.topicText,
        subjectDisplayName,
        modules: modulesSummary,
        moduleIndex,
        unlockedStage,
        ...saved,
        ready: false,
        nextPhase: "practice",
      });
    }

    if (phase === "practice") {
      const saved = await ensureModuleStagePhase(row, subtopicRow, subjectConfig, "practice");

      // Grasp is fully satisfied here; Remember still needs the image phase,
      // so only Grasp's own request reports ready:true -- a Remember request
      // gets ready:false + nextPhase:"image" and the client's poll loop
      // continues, exactly like /api/lesson's practice-phase branch.
      const ready = stage !== "remember";
      return NextResponse.json({
        subtopicId,
        subtopicText: subtopicRow.topicText,
        subjectDisplayName,
        modules: modulesSummary,
        moduleIndex,
        unlockedStage,
        ...saved,
        ready,
        nextPhase: ready ? null : "image",
      });
    }

    // phase === "image"
    const saved = await ensureModuleStagePhase(row, subtopicRow, subjectConfig, "image");

    return NextResponse.json({
      subtopicId,
      subtopicText: subtopicRow.topicText,
      subjectDisplayName,
      modules: modulesSummary,
      moduleIndex,
      unlockedStage,
      ...saved,
      ready: true,
      nextPhase: null,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// Mirrors /api/lesson's POST exactly (mastery.stage bookkeeping), extended
// with currentModuleIndex so re-entering a subtopic resumes on the right
// module. `action` distinguishes a plain tab-click bookkeeping POST ("view",
// the default -- today's exact behavior, no unlock change) from a stage's
// own Continue button ("advance"), which is what actually raises
// moduleProgress[moduleId].highestStage -- the high-water mark
// lib/adaptive/unlocks.js's isStageUnlocked reads. Without this distinction,
// clicking the "Remember" tab directly would silently unlock past
// Teach/Grasp, exactly the bug decision 1 in the design closes.
export async function POST(request) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  try {
    const { subtopicId, moduleIndex, stage, action } = await request.json();
    if (!subtopicId || typeof moduleIndex !== "number" || !VALID_STAGES.includes(stage)) {
      return NextResponse.json({ error: "subtopicId, a numeric moduleIndex, and a valid stage are required" }, { status: 400 });
    }
    const effectiveAction = action === "advance" ? "advance" : "view";

    const moduleRows = await db
      .select()
      .from(lessonModules)
      .where(and(eq(lessonModules.subtopicId, subtopicId), eq(lessonModules.orderIndex, moduleIndex)));
    const moduleRow = moduleRows[0];
    if (!moduleRow) return NextResponse.json({ error: `No module at index ${moduleIndex} for subtopic ${subtopicId}` }, { status: 404 });

    const existingRows = await db
      .select()
      .from(mastery)
      .where(and(eq(mastery.userId, userId), eq(mastery.subtopicId, subtopicId)));
    const existing = existingRows[0];
    const moduleProgress = { ...(existing?.moduleProgress ?? {}) };
    const key = String(moduleRow.id);
    const currentUnlockedStage = moduleProgress[key]?.highestStage ?? "teach";

    if (effectiveAction === "advance") {
      if (!validateStageAdvance(currentUnlockedStage, stage)) {
        return NextResponse.json({ error: "Cannot advance more than one stage at a time", currentUnlockedStage }, { status: 400 });
      }
      moduleProgress[key] = { ...moduleProgress[key], highestStage: stage };
    }

    if (existing) {
      await db
        .update(mastery)
        .set({ stage, currentModuleIndex: moduleIndex, moduleProgress })
        .where(and(eq(mastery.userId, userId), eq(mastery.subtopicId, subtopicId)));
    } else {
      await db.insert(mastery).values({ userId, subtopicId, stage, currentModuleIndex: moduleIndex, moduleProgress });
    }

    return NextResponse.json({ subtopicId, moduleIndex, stage, unlockedStage: moduleProgress[key]?.highestStage ?? "teach" });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
