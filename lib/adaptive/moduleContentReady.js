// lib/adaptive/moduleContentReady.js
//
// The actual "generate this module's next missing phase and save it" step,
// extracted out of app/api/module-lesson/route.js's GET handler so it can be
// called from two places: that route (live, one phase per request, same
// discipline as always -- avoids finish_reason:"length"/timeout on the free
// tier) and app/api/cron/prepare-next-day/route.js (the new overnight
// pre-generation job, which loops phase-by-phase the same way but for
// tomorrow's plan topics instead of in response to a student's click).
//
// Deliberately narrow: this only knows how to generate ONE named phase for
// ONE module and persist it. Working out WHICH phase is next, and whether a
// student is even allowed to see it yet (stage/module locks), stays in each
// caller -- the live route's stage/force-aware nextMissingPhase() is a
// different question from the cron's "just fill in whatever teach/practice/
// image is still missing" loop (see nextMissingModulePhase below), so they're
// kept as two separate, purpose-fit functions rather than one over-general one.

import { and, eq, sql } from "drizzle-orm";
import { db } from "../db.js";
import { lessonModules, pyqs, sources, personalSources } from "../../db/schema.js";
import { generateModuleTeach, generateModuleOfficerRoleplay, generateModulePractice, generateModuleImage, PyqLeakError } from "../ai/generateModules.js";
import { recentCurrentAffairsExcerpts, labeledSourceExcerptBlocks } from "../ai/contentGrounding.js";

// Same wide window as app/api/module-lesson/route.js's plan phase (2026-07-24
// "rewrite Teach" change) -- Teach content is meant to be a durable
// foundation, not a "recent news" snapshot.
const TEACH_CURRENT_AFFAIRS_WINDOW = { days: 365, limit: 12 };
const MAX_RELATED_PYQS = 15;

/** teach -> officer -> practice -> image -> null, ignoring the requesting stage entirely -- what the overnight pre-gen loop (A5) needs, unlike the live route's per-requested-stage nextMissingPhase. */
export function nextMissingModulePhase(row) {
  if (!row?.generatedAt) return "teach";
  if (!row?.officerScenes) return "officer";
  if (!row?.practiceGeneratedAt) return "practice";
  if (!row?.visualImageDataUri) return "image";
  return null;
}

/**
 * Generates exactly the named phase ("teach" | "officer" | "practice" |
 * "image") for one module and writes it back. Caller is responsible for
 * having already decided this phase is actually missing -- this does not
 * check.
 */
export async function ensureModuleStagePhase(moduleRow, subtopicRow, subjectConfig, phase, userId = null) {
  let pyqQuestionText;
  if (moduleRow.pyqId) {
    const anchorRows = await db.select().from(pyqs).where(eq(pyqs.id, moduleRow.pyqId));
    pyqQuestionText = anchorRows[0]?.questionText;
  }

  if (phase === "teach") {
    // Grounding this phase never had before (2026-07-24 "rewrite Teach"
    // change) -- same sources/current-affairs/PYQ inputs the plan phase
    // uses (app/api/module-lesson/route.js), fetched fresh here since Teach
    // generates lazily per-module, well after the plan phase already ran.
    const srcRows = await db.select().from(sources).where(eq(sources.subtopicId, subtopicRow.id));
    // Bloom Knowledge Forest -- the requesting student's own uploaded
    // material for this subtopic (db/schema.js's personalSources), if any.
    // userId is optional and null for the overnight pre-gen cron path that
    // doesn't pass one yet -- Teach still generates fine without it, just
    // without that student's personal tier represented.
    const personalRows = userId
      ? await db.select().from(personalSources).where(and(eq(personalSources.userId, userId), eq(personalSources.subtopicId, subtopicRow.id)))
      : [];
    const sourceExcerpts = labeledSourceExcerptBlocks(srcRows, personalRows);
    const currentAffairsExcerpts = await recentCurrentAffairsExcerpts(subtopicRow.id, TEACH_CURRENT_AFFAIRS_WINDOW);
    const relatedPyqs = (await db.select().from(pyqs).where(sql`${subtopicRow.id} = ANY(${pyqs.topics})`)).slice(0, MAX_RELATED_PYQS);

    const teachArgs = {
      subtopicText: subtopicRow.topicText,
      moduleTitle: moduleRow.title,
      moduleScope: moduleRow.scopeNote,
      pyqQuestionText,
      sourceExcerpts,
      currentAffairsExcerpts,
      relatedPyqs,
      subjectConfig,
    };
    // See lib/ai/generateModules.js's PyqLeakError -- a first attempt that
    // verbatim-restates its anchor PYQ question retries ONCE with an
    // escalated instruction rather than ever persisting the leak. A second
    // failure propagates as an ordinary generation error (same as any other
    // AI call failure this route already surfaces) instead of looping.
    let teach;
    try {
      teach = await generateModuleTeach(teachArgs);
    } catch (err) {
      if (!(err instanceof PyqLeakError)) throw err;
      console.error(`moduleContentReady: Teach leaked PYQ question for module ${moduleRow.id}, retrying once with escalated instruction`);
      teach = await generateModuleTeach({ ...teachArgs, escalateAntiLeak: true });
    }
    const [saved] = await db
      .update(lessonModules)
      .set({ ...teach, generatedAt: new Date() })
      .where(eq(lessonModules.id, moduleRow.id))
      .returning();
    return saved;
  }

  if (phase === "officer") {
    // Reuses moduleRow.teachBeats -- the "teach" phase above must already
    // have run (STAGE_REQUIRES enforces the order), no new grounding
    // fetched here, zero new fact-finding.
    const officer = await generateModuleOfficerRoleplay({
      subtopicText: subtopicRow.topicText,
      moduleTitle: moduleRow.title,
      teachBeats: moduleRow.teachBeats,
      subjectConfig,
    });
    const [saved] = await db
      .update(lessonModules)
      .set({ officerScenes: officer })
      .where(eq(lessonModules.id, moduleRow.id))
      .returning();
    return saved;
  }

  if (phase === "practice") {
    const practice = await generateModulePractice({
      subtopicText: subtopicRow.topicText,
      moduleTitle: moduleRow.title,
      moduleScope: moduleRow.scopeNote,
      teachContent: moduleRow.teachContent,
      pyqQuestionText,
      subjectConfig,
    });
    const [saved] = await db
      .update(lessonModules)
      .set({ ...practice, practiceGeneratedAt: new Date() })
      .where(eq(lessonModules.id, moduleRow.id))
      .returning();
    return saved;
  }

  // phase === "image" -- officerScenes (from the phase above) points this
  // same one-image-per-module budget at the officer-roleplay scene instead
  // of a generic concept diagram, when available.
  const officerContext = moduleRow.officerScenes ? { officerRank: moduleRow.officerScenes.officerRank, issueBrief: moduleRow.officerScenes.issueBrief } : undefined;
  const visualImageDataUri = await generateModuleImage({ moduleTitle: moduleRow.title, keyPoints: moduleRow.keyPoints, officerContext });
  const [saved] = await db
    .update(lessonModules)
    .set({ visualImageDataUri })
    .where(eq(lessonModules.id, moduleRow.id))
    .returning();
  return saved;
}
