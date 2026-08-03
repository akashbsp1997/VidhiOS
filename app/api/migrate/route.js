export const maxDuration = 60;

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from "../../../lib/db.js";

// Applies pending drizzle-kit migrations (drizzle/*.sql) against the real
// database. This exists because schema changes now ship as versioned
// migration files (see drizzle/, and the Phase 1 plan) instead of the old
// hand-DDL array that used to live in app/api/setup/route.js -- but running
// `npm run db:migrate` requires a local terminal with a real DATABASE_URL,
// which isn't how this project has been developed (GitHub's mobile web
// editor, no local dev environment). This route is the mobile-workflow
// equivalent: hit it once from a browser after a schema PR merges, same
// pattern as /api/setup for seed data.
//
// Safe to re-run: drizzle's migrator tracks applied migrations in a
// drizzle.__drizzle_migrations bookkeeping table and only runs new ones.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");
  if (!process.env.SETUP_SECRET || key !== process.env.SETUP_SECRET) {
    return NextResponse.json({ error: "Missing or wrong ?key=. Check SETUP_SECRET in your Vercel env vars." }, { status: 401 });
  }

  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
  } catch (err) {
    return NextResponse.json({ status: "error", message: err.message }, { status: 500 });
  }

  // Report new columns'/tables' presence so success is verifiable from the
  // HTTP response alone, without needing a separate DB connection. Extended
  // for Phase 2 (see db/schema.js's ingestUploads/ingestItems/sources.storageUploadId).
  try {
    const cols = await db.execute(sql`
      select table_name, column_name
      from information_schema.columns
      where table_schema = 'public'
        and (
          (table_name = 'subtopics' and column_name = 'subject_id') or
          (table_name = 'pyqs' and column_name = 'subject_id') or
          (table_name = 'sources' and column_name = 'source_tier') or
          (table_name = 'sources' and column_name = 'storage_upload_id') or
          (table_name = 'ingest_uploads' and column_name = 'source_url') or
          (table_name = 'ingest_uploads' and column_name = 'chunks_processed') or
          (table_name = 'attempts' and column_name = 'user_id') or
          (table_name = 'mastery' and column_name = 'user_id') or
          (table_name = 'lessons' and column_name = 'practice_generated_at') or
          (table_name = 'mastery' and column_name = 'current_module_index') or
          (table_name = 'model_questions' and column_name = 'module_id') or
          (table_name = 'attempts' and column_name = 'module_id') or
          (table_name = 'lesson_modules' and column_name = 'pyq_id') or
          (table_name = 'lesson_modules' and column_name = 'visual_image_data_uri') or
          (table_name = 'mastery' and column_name = 'module_progress') or
          (table_name = 'sources' and column_name = 'ncert_level') or
          (table_name = 'sources' and column_name = 'ncert_class') or
          (table_name = 'mastery' and column_name = 'notes') or
          (table_name = 'mastery' and column_name = 'self_status') or
          (table_name = 'model_questions' and column_name = 'format') or
          (table_name = 'model_questions' and column_name = 'correct_index') or
          (table_name = 'mastery' and column_name = 'unlock_override_until') or
          (table_name = 'player_state' and column_name = 'track') or
          (table_name = 'lesson_modules' and column_name = 'current_affairs_link') or
          (table_name = 'mastery' and column_name = 'growth_stage') or
          (table_name = 'mastery' and column_name = 'retention_ease_factor') or
          (table_name = 'mastery' and column_name = 'last_retention_checkpoint')
        )
      order by table_name, column_name
    `);
    const tables = await db.execute(sql`
      select table_name from information_schema.tables
      where table_schema = 'public'
        and table_name in ('subjects', 'ingest_uploads', 'ingest_items', 'lesson_modules', 'subject_unlocks', 'mock_tests', 'mock_test_questions', 'flashcard_reviews', 'current_affairs_items', 'interview_profiles', 'interview_sessions', 'essay_topics', 'essay_guides', 'essay_attempts', 'question_model_answers', 'player_state', 'player_items', 'daily_mission_log', 'pace_checkpoints', 'monthly_digests', 'daily_results_digests', 'quant_lessons', 'weekly_plan_adjustments', 'personal_sources')
    `);
    const compressedCols = await db.execute(sql`
      select table_name, column_name, data_type
      from information_schema.columns
      where table_schema = 'public'
        and column_name = 'extracted_text'
        and table_name in ('sources', 'ingest_uploads')
    `);
    const tableNames = tables.map((r) => r.table_name);
    return NextResponse.json({
      status: "ok",
      message: "Migrations applied (or already up to date).",
      subjectsTableExists: tableNames.includes("subjects"),
      lessonModulesTableExists: tableNames.includes("lesson_modules"),
      subjectUnlocksTableExists: tableNames.includes("subject_unlocks"),
      mockTestsTableExists: tableNames.includes("mock_tests") && tableNames.includes("mock_test_questions"),
      flashcardReviewsTableExists: tableNames.includes("flashcard_reviews"),
      currentAffairsTableExists: tableNames.includes("current_affairs_items"),
      interviewTablesExist: tableNames.includes("interview_profiles") && tableNames.includes("interview_sessions"),
      essayTablesExist: tableNames.includes("essay_topics") && tableNames.includes("essay_guides") && tableNames.includes("essay_attempts"),
      questionModelAnswersTableExists: tableNames.includes("question_model_answers"),
      extractedTextCompressed: compressedCols.every((r) => r.data_type === "bytea") && compressedCols.length === 2,
      paceCheckpointsTableExists: tableNames.includes("pace_checkpoints"),
      monthlyDigestsTableExists: tableNames.includes("monthly_digests"),
      dailyResultsDigestsTableExists: tableNames.includes("daily_results_digests"),
      quantLessonsTableExists: tableNames.includes("quant_lessons"),
      weeklyPlanAdjustmentsTableExists: tableNames.includes("weekly_plan_adjustments"),
      gamificationTablesExist: tableNames.includes("player_state") && tableNames.includes("player_items") && tableNames.includes("daily_mission_log"),
      personalSourcesTableExists: tableNames.includes("personal_sources"),
      ingestTablesFound: tableNames.filter((n) => n.startsWith("ingest_")),
      newColumnsFound: cols.map((r) => `${r.table_name}.${r.column_name}`),
    });
  } catch (err) {
    return NextResponse.json({
      status: "partial",
      message: `Migration ran, but the verification query failed: ${err.message}`,
    });
  }
}
