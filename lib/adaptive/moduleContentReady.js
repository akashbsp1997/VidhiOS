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

import { eq, sql } from "drizzle-orm";
import { db } from "../db.js";
import { lessonModules, pyqs, sources } from "../../db/schema.js";
import { generateModuleTeach, generateModulePractice, generateModuleImage } from "../ai/generateModules.js";
import { sortByTierPriority } from "../sources/tiers.js";
import { recentCurrentAffairsExcerpts } from "../ai/contentGrounding.js";

// Same wide window as app/api/module-lesson/route.js's plan phase (2026-07-24
// "rewrite Teach" change) -- Teach content is meant to be a durable
// foundation, not a "recent news" snapshot.
const TEACH_CURRENT_AFFAIRS_WINDOW = { days: 365, limit: 12 };
const MAX_RELATED_PYQS = 15;

/** teach -> practice -> image -> null, ignoring the requesting stage entirely -- what the overnight pre-gen loop (A5) needs, unlike the live route's per-requested-stage nextMissingPhase. */
export function nextMissingModulePhase(row) {
  if (!row?.generatedAt) return "teach";
  if (!row?.practiceGeneratedAt) return "practice";
  if (!row?.visualImageDataUri) return "image";
  return null;
}

/**
 * Generates exactly the named phase ("teach" | "practice" | "image") for one
 * module and writes it back. Caller is responsible for having already
 * decided this phase is actually missing -- this does not check.
 */
export async function ensureModuleStagePhase(moduleRow, subtopicRow, subjectConfig, phase) {
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
    const sourceExcerpts = sortByTierPriority(srcRows.filter((s) => s.extractedText))
      .map((s) => s.extractedText)
      .slice(0, 2);
    const currentAffairsExcerpts = await recentCurrentAffairsExcerpts(subtopicRow.id, TEACH_CURRENT_AFFAIRS_WINDOW);
    const relatedPyqs = (await db.select().from(pyqs).where(sql`${subtopicRow.id} = ANY(${pyqs.topics})`)).slice(0, MAX_RELATED_PYQS);

    const teach = await generateModuleTeach({
      subtopicText: subtopicRow.topicText,
      moduleTitle: moduleRow.title,
      moduleScope: moduleRow.scopeNote,
      pyqQuestionText,
      sourceExcerpts,
      currentAffairsExcerpts,
      relatedPyqs,
      subjectConfig,
    });
    const [saved] = await db
      .update(lessonModules)
      .set({ ...teach, generatedAt: new Date() })
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

  // phase === "image"
  const visualImageDataUri = await generateModuleImage({ moduleTitle: moduleRow.title, keyPoints: moduleRow.keyPoints });
  const [saved] = await db
    .update(lessonModules)
    .set({ visualImageDataUri })
    .where(eq(lessonModules.id, moduleRow.id))
    .returning();
  return saved;
}
