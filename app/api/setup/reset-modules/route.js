export const maxDuration = 60;

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "../../../../lib/db.js";

// One-time reset of module content after the 2026-07-24 "rewrite Teach"
// change (richer plan/Teach grounding, raised module cap, chapter-style
// pacing) -- nothing in this app ever re-runs the plan/Teach phase once a
// subtopic already has lesson_modules rows, so subtopics planned before this
// change would otherwise be stuck with the old, thinner content forever.
// This clears every lesson_modules row (and its now-orphaned module-scoped
// model_questions/attempts references) so every subtopic replans and
// re-teaches under the new pipeline next time it's opened, or via the
// nightly prepare-next-day cron.
//
// Deliberately does NOT touch mastery.masteryScore/attemptsCount/
// currentTier/recentScores -- that's the real adaptive-engine learning
// signal built from actual graded scores, not module-structure bookkeeping,
// and isn't invalidated by restructuring how modules are chaptered. Only
// moduleProgress/currentModuleIndex/stage (module-specific bookkeeping) reset.
//
// Gated by SETUP_SECRET *and* a second explicit `confirm` param, same
// destructive-action pattern as app/api/setup/phase1-reset -- intended to be
// run exactly once, not idempotently re-run.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");
  const confirm = searchParams.get("confirm");
  if (!process.env.SETUP_SECRET || key !== process.env.SETUP_SECRET) {
    return NextResponse.json({ error: "Missing or wrong ?key=. Check SETUP_SECRET in your Vercel env vars." }, { status: 401 });
  }
  if (confirm !== "yes-reset-modules") {
    return NextResponse.json(
      {
        error:
          "This deletes all lesson_modules rows (and detaches/deletes their dependent attempts/model_questions rows) so every subtopic replans and re-teaches under the new pipeline. Mastery scores are preserved. Re-run with &confirm=yes-reset-modules to proceed.",
      },
      { status: 400 }
    );
  }

  const log = [];
  let hadError = false;

  try {
    const result = await db.execute(sql`update attempts set module_id = null where module_id is not null`);
    log.push(`OK  detach:attempts.module_id (${result.length ?? result.rowCount ?? "?"} rows)`);
  } catch (err) {
    hadError = true;
    log.push(`FAIL detach:attempts.module_id -- ${err.message}`);
  }

  try {
    const result = await db.execute(sql`delete from model_questions where module_id is not null`);
    log.push(`OK  delete:model_questions (module-scoped) (${result.length ?? result.rowCount ?? "?"} rows)`);
  } catch (err) {
    hadError = true;
    log.push(`FAIL delete:model_questions -- ${err.message}`);
  }

  try {
    const result = await db.execute(sql`
      update mastery
      set module_progress = '{}'::jsonb, current_module_index = null, stage = 'teach'
      where module_progress != '{}'::jsonb
    `);
    log.push(`OK  reset:mastery.moduleProgress (${result.length ?? result.rowCount ?? "?"} rows)`);
  } catch (err) {
    hadError = true;
    log.push(`FAIL reset:mastery.moduleProgress -- ${err.message}`);
  }

  try {
    const [{ count: modulesBefore }] = await db.execute(sql`select count(*)::int as count from lesson_modules`);
    await db.execute(sql`delete from lesson_modules`);
    log.push(`OK  delete:lesson_modules (deleted ${modulesBefore} rows)`);
  } catch (err) {
    hadError = true;
    log.push(`FAIL delete:lesson_modules -- ${err.message}`);
  }

  return NextResponse.json(
    {
      status: hadError ? "partial" : "ok",
      log,
      next: hadError
        ? "One or more steps failed -- read the FAIL lines above."
        : "Module reset complete. Every subtopic replans and re-teaches under the new content-rich pipeline next time it's opened.",
    },
    { status: hadError ? 207 : 200 }
  );
}
