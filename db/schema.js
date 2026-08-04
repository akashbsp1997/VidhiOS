// db/schema.js
// Drizzle ORM schema (Postgres). Run `npx drizzle-kit push` to create these tables
// on your Supabase Postgres instance — see README for setup.

import {
  pgTable,
  pgSchema,
  text,
  integer,
  real,
  boolean,
  uuid,
  timestamp,
  jsonb,
  serial,
  primaryKey,
  unique,
} from "drizzle-orm/pg-core";
import { compressedText } from "../lib/db/compressedText.js";

// Supabase Auth's own schema/table -- referenced, never created/migrated by us.
// Deliberately declares ONLY `id` (an FK target) -- drizzle-kit does NOT
// actually skip generating DDL for other columns just because the schema
// is "auth" (confirmed live: declaring `createdAt` here produced a real
// `ALTER TABLE auth.users ADD COLUMN ...` migration against Supabase's own
// managed table, which must never run). Account age
// (lib/gamification/missions.js's accountAgeXp) instead reads
// auth.users.created_at via a raw, read-only SQL query -- see
// loadPlayerState -- never through a Drizzle-tracked column on this table.
const authSchema = pgSchema("auth");
export const authUsers = authSchema.table("users", {
  id: uuid("id").primaryKey(),
});

/**
 * One row per exam component this app can serve content for: each optional
 * subject (Law Optional today, more later), each GS Mains paper, Essay, and
 * (structurally representable, not yet built) Prelims GS/CSAT. `answerFormat`
 * is the seam a future MCQ-based Prelims engine hangs off without touching
 * the descriptive-format tables/routes that exist today.
 */
export const subjects = pgTable("subjects", {
  id: text("id").primaryKey(), // slug, e.g. "law-optional", "gs1", "essay"
  displayName: text("display_name").notNull(), // e.g. "Law Optional", "GS Paper I"
  category: text("category").notNull(), // 'optional' | 'gs' | 'essay' | 'prelims'
  examStage: text("exam_stage").notNull(), // 'mains' | 'prelims'
  answerFormat: text("answer_format").notNull(), // 'descriptive' | 'essay' | 'mcq'
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * The 81-topic syllabus taxonomy (Paper I: Constitutional & Admin Law, International
 * Law. Paper II: Crimes, Torts, Contracts & Mercantile Law, Contemporary Legal
 * Developments). Reused from VidhiOS's already-verified topic codes so nothing
 * needs re-mapping.
 *
 * `id` is the sole PK across ALL subjects/subtopics, not just Law's -- existing
 * Law codes ("CA1", "IL4", ...) are never renamed. Every subtopic code for a
 * NEW subject added later must be prefixed with that subject's slug (e.g.
 * "gs1-ind1") to keep this column globally unique by convention, since nothing
 * enforces uniqueness beyond the PK itself.
 */
export const subtopics = pgTable("subtopics", {
  id: text("id").primaryKey(), // e.g. "CA1", "IL4", "CR10"
  subjectId: text("subject_id")
    .notNull()
    .references(() => subjects.id),
  paper: integer("paper").notNull(), // 1 or 2
  section: text("section").notNull(), // e.g. "Constitutional and Administrative Law"
  topicText: text("topic_text").notNull(),
  pyqFrequency: integer("pyq_frequency").notNull().default(0), // denormalized count, refreshed by seed script
  // This subtopic's position within its own seed file's array (0-based) --
  // e.g. gs2-c1 "Indian Constitution -- historical underpinnings..." is
  // position 0, gs2-c8 "Appointment to Constitutional posts" is position 7.
  // Seed files are already hand-ordered to match the real official
  // syllabus's own sequence, section by section -- a far more reliable
  // "basics first" signal than lib/adaptive/unlocks.js's computeDifficultyScore
  // heuristic, which can rank a broad, richly-sourced, high-PYQ foundational
  // topic as MORE advanced than a thin, sparsely-sourced one purely because
  // sparse data defaults to a neutral (not "basic") score. Primary sort key
  // in orderSubtopicsWithinPaper/byScheduleOrder/byGsOrder now; difficultyScore
  // is still the tiebreaker within a syllabusOrder tie (e.g. optionals whose
  // seed arrays aren't meaningfully pre-ordered).
  syllabusOrder: integer("syllabus_order").notNull().default(0),
  // Cross-chapter prerequisite edges -- ids of OTHER subtopics (within the
  // same subjectId; cross-subject prerequisites aren't modeled) that must
  // individually clear the mastery threshold before this one unlocks, ON
  // TOP OF the existing sequential syllabusOrder-based chain
  // (lib/adaptive/unlocks.js's computeSubtopicLocks). Populated as a
  // byproduct of the Subject Book Plan's per-Subject planning call (see
  // lib/ai/generateSubjectBookPlan.js's prerequisiteSubtopicIds output),
  // written back the first time that Subject's plan is generated -- see
  // app/api/module-lesson/route.js's loadOrCreateSubjectBookPlan. Empty
  // array (the default, and the case for every subtopic whose Subject
  // hasn't been planned yet) means "no dependency beyond the normal
  // sequential chain." Can genuinely point EARLIER in syllabusOrder than
  // this subtopic itself -- a compound/synthesis chapter can legitimately
  // sit before its prerequisites in the raw syllabus list.
  prerequisiteSubtopicIds: text("prerequisite_subtopic_ids").array().notNull().default([]),
});

/**
 * Official/government source documents registered against a subtopic. `official`
 * distinguishes primary sources (India Code, UN, court/ministry sites) from
 * secondary reference material. Cache fields hold the last successful fetch so
 * the app can show/ground content without re-fetching on every view.
 *
 * `sourceTier` is the trust/licensing hierarchy content is grounded against, in
 * priority order: 'ncert' (root -- NCERT permits free educational reproduction)
 * > 'official' (govt works meant for redistribution, e.g. PIB/ministry releases)
 * > 'newspaper' (editorial content -- fetch policy caps this to excerpts, never
 * full paywalled-article text) > 'private_vendor' (commercially sold coaching
 * content -- fetch policy never extracts full text for this tier, link/title
 * only; see lib/sources/fetchAndCache.js). Nullable until backfilled; existing
 * rows predate this tiering and default to 'official' on backfill.
 */
export const sources = pgTable("sources", {
  id: serial("id").primaryKey(),
  subtopicId: text("subtopic_id")
    .notNull()
    .references(() => subtopics.id),
  title: text("title").notNull(),
  // Normally a real http(s) URL. Rows created from an ingested upload (see
  // ingestUploads below) instead carry the sentinel "storage://ingest-uploads/<path>"
  // -- url stays NOT NULL either way so every other reader of this column
  // (app/sources/[subtopicId]/page.jsx, lib/sources/*) doesn't need a null
  // check; that page special-cases the storage:// prefix and resolves a
  // fresh signed URL via /api/sources/signed-url instead of rendering it
  // as a normal href.
  url: text("url").notNull(),
  sourceType: text("source_type").notNull(), // 'bare_act' | 'judgment' | 'treaty' | 'commission_report' | 'gazette' | 'press_release' | 'other'
  sourceTier: text("source_tier"), // 'ncert' | 'official' | 'newspaper' | 'private_vendor'
  // Only meaningful when sourceTier = 'ncert' -- which school class range a
  // concept is taught at is itself a real basics-to-advanced signal (see
  // lib/adaptive/unlocks.js's sourceScore), distinct from the coarser
  // ncert-vs-not distinction sourceTier alone gives. 'foundational' = class
  // 6-8, 'middle' = class 9-10, 'senior' = class 11-12. Null for every
  // non-NCERT source, and for an NCERT source not yet tagged (falls back to
  // 'senior' in scoring -- see drizzle/0011's backfill for why that's the
  // right default for every NCERT source in this app as of 2026-07-22).
  ncertLevel: text("ncert_level"),
  // Precise NCERT bibliographic metadata -- AI-suggested during ingest
  // review (see lib/ingest/config.js's buildNcertSourceSystem), always
  // operator-verified before commit like every other suggested field, never
  // written directly from an AI call. ncertClass (6-12) is the finer-grained
  // signal lib/adaptive/unlocks.js's sourceScore prefers over the coarser
  // ncertLevel bucket when both are present -- commit.js derives ncertLevel
  // from ncertClass automatically on approve, so older code paths reading
  // only ncertLevel keep working. All null for a non-NCERT source, or an
  // NCERT source whose class genuinely isn't stated anywhere in the document
  // (the AI is instructed to leave these null rather than guess).
  ncertClass: integer("ncert_class"),
  ncertBook: text("ncert_book"),
  ncertChapter: text("ncert_chapter"),
  ncertSubject: text("ncert_subject"),
  official: boolean("official").notNull().default(true),
  addedAt: timestamp("added_at").notNull().defaultNow(),
  // Set only for rows created via the ingestion pipeline (app/api/ingest/*) --
  // null for every manually-seeded/URL-fetched row. Lets /api/sources/signed-url
  // find the backing Storage object without parsing the storage:// sentinel.
  storageUploadId: integer("storage_upload_id").references(() => ingestUploads.id),
  // --- cache, populated by lib/sources/fetchAndCache.js ---
  fetchedAt: timestamp("fetched_at"),
  // Stored gzip-compressed (see lib/db/compressedText.js) -- transparent to
  // every reader, still a plain JS string once selected. Truncated extract,
  // ~8-10k chars pre-compression.
  extractedText: compressedText("extracted_text"),
  status: text("status").notNull().default("pending"), // 'pending' | 'ok' | 'error'
  errorMsg: text("error_msg"),
});

/**
 * One row per PDF uploaded through the ingestion pipeline (app/api/ingest/*),
 * created only after the bytes are already confirmed present in the private
 * 'ingest-uploads' Supabase Storage bucket -- so a row here always has a real
 * backing object, never a dangling reference. The PDF itself is the
 * permanent backup; this row tracks status through extraction and AI
 * structuring. See docs/ARCHITECTURE.md (Phase 2) for the full pipeline.
 */
export const ingestUploads = pgTable("ingest_uploads", {
  id: serial("id").primaryKey(),
  docType: text("doc_type").notNull(), // see lib/ingest/docTypes.js's INGEST_DOC_TYPES for the canonical list
  subjectId: text("subject_id")
    .notNull()
    .references(() => subjects.id),
  storagePath: text("storage_path").notNull(), // object key within the 'ingest-uploads' bucket
  originalFilename: text("original_filename").notNull(),
  // Set only when this upload came from app/api/ingest/fetch-url (fetching
  // a public PDF URL server-side) rather than a browser file upload -- kept
  // for provenance, so the operator can click through and verify a
  // candidate against its real public source (e.g. ncert.nic.in) before
  // approving it, same spirit as sources.url for hand-registered sources.
  // Null for browser-uploaded files, which have no such public origin.
  sourceUrl: text("source_url"),
  fileSizeBytes: integer("file_size_bytes").notNull(),
  contentHash: text("content_hash").notNull(), // sha256 of the raw PDF bytes -- exact-duplicate detection
  pageCount: integer("page_count"), // from pdf-parse; null until extraction runs
  extractedCharCount: integer("extracted_char_count"),
  // Stored gzip-compressed (see lib/db/compressedText.js), transparent to
  // every reader. Full extracted text, NOT capped like sources.extractedText
  // -- the biggest real compression win in this app, since a full PDF's
  // text can run well past sources.extractedText's ~8-10k char cap.
  extractedText: compressedText("extracted_text"),
  textTruncatedForAi: boolean("text_truncated_for_ai").notNull().default(false), // legacy -- see chunksProcessed/totalChunks, which superseded this once /api/ingest/structure started chunking instead of hard-truncating
  // A document longer than its docType's textCap (lib/ingest/config.js) gets
  // processed one chunk at a time -- one /api/ingest/structure call per
  // chunk, not one call for the whole (possibly huge) document, since a
  // single AI call has real per-request size/duration/rate-limit costs on
  // the free tier. totalChunks is computed and stored on the first
  // structure call; chunksProcessed only increments on a SUCCESSFUL chunk,
  // so a failed attempt retries the same chunk rather than skipping it or
  // losing earlier chunks' already-inserted ingestItems.
  totalChunks: integer("total_chunks"),
  chunksProcessed: integer("chunks_processed").notNull().default(0),
  status: text("status").notNull().default("uploaded"), // uploaded -> extracted -> structured | needs_ocr | duplicate | error ("extracted" also covers "more chunks left to structure")
  dupOfUploadId: integer("dup_of_upload_id"), // self-referencing; set when status = 'duplicate'
  errorMsg: text("error_msg"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  extractedAt: timestamp("extracted_at"),
  structuredAt: timestamp("structured_at"),
});

/**
 * One AI-suggested candidate record per row, awaiting operator review --
 * never written to subtopics/pyqs/sources until approved. itemType decides
 * which live table a commit targets (see lib/ingest/commit.js); it's set
 * from the upload's docType via a fixed mapping, never chosen by the AI.
 */
export const ingestItems = pgTable("ingest_items", {
  id: serial("id").primaryKey(),
  uploadId: integer("upload_id")
    .notNull()
    .references(() => ingestUploads.id),
  itemType: text("item_type").notNull(), // 'subtopic' | 'pyq' | 'source'
  suggestedSubtopicId: text("suggested_subtopic_id"), // AI's best-guess match against an EXISTING subtopics.id -- not a DB FK, since it may not exist yet
  suggestedSubtopicIsNew: boolean("suggested_subtopic_is_new").notNull().default(false),
  suggestedData: jsonb("suggested_data").notNull(), // raw AI output, shaped per itemType -- see lib/ingest/config.js
  finalData: jsonb("final_data"), // operator-edited version; falls back to suggestedData at commit time
  reviewStatus: text("review_status").notNull().default("pending"), // 'pending' | 'approved' | 'rejected'
  commitError: text("commit_error"), // set if an approve attempt's commit step failed -- reviewStatus stays 'pending' so it's retryable, never silently dropped
  committedTable: text("committed_table"), // 'subtopics' | 'pyqs' | 'sources', set only on a successful commit
  committedId: text("committed_id"), // the live row's PK, as text
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * Bloom Knowledge Forest -- a student's own procured study material
 * (a purchased Laxmikanth/Spectrum/PMF-or-Vision-IAS PDF, etc.), uploaded
 * for their own grounding only. Deliberately a SEPARATE table from `sources`
 * rather than another sourceTier value there: `sources` is a global,
 * admin-curated catalog every user's generation draws on (see
 * lib/ai/contentGrounding.js's labeledSourceExcerptBlocks) -- sharing a
 * user's personally-procured, possibly-copyrighted material into that same
 * global pool would mean every OTHER user's content gets grounded in it
 * too, which is both a real licensing problem and not what "their own"
 * means. Rows here are scoped strictly to userId and never read by any
 * query that doesn't explicitly filter on the requesting user's own id
 * (this app enforces that in the query layer, same pattern as
 * attempts/mastery -- see lib/supabase/server.js's getSessionUserId, there
 * is no separate Postgres RLS policy layer here).
 */
export const personalSources = pgTable("personal_sources", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => authUsers.id),
  subtopicId: text("subtopic_id")
    .notNull()
    .references(() => subtopics.id),
  title: text("title").notNull(),
  storagePath: text("storage_path").notNull(), // private 'personal-sources' Storage bucket, prefixed by userId -- see app/api/my-sources/*
  fileSizeBytes: integer("file_size_bytes"),
  pageCount: integer("page_count"),
  // Stored gzip-compressed, same as sources.extractedText -- see
  // lib/db/compressedText.js.
  extractedText: compressedText("extracted_text"),
  status: text("status").notNull().default("pending"), // 'pending' | 'extracted' | 'needs_ocr' | 'error'
  errorMsg: text("error_msg"),
  addedAt: timestamp("added_at").notNull().defaultNow(),
});

/**
 * Real UPSC CSE Mains PYQs across subjects (Law Optional 2023-2025, GS Paper
 * II 2015-2025, more to follow). `topics` holds one or more subtopic codes.
 *
 * `marks` is `real`, not `integer` -- GS papers used a uniform 12.5-mark
 * format (250/20 questions) through 2016 before switching to the current
 * 10/15 split; storing that as a rounded integer would misrepresent a real
 * historical paper to anyone using this for exam prep.
 */
export const pyqs = pgTable("pyqs", {
  id: text("id").primaryKey(), // e.g. "Y25-P1-Q1a"
  subjectId: text("subject_id")
    .notNull()
    .references(() => subjects.id),
  paper: integer("paper").notNull(),
  year: integer("year").notNull(),
  slot: integer("slot").notNull(), // matches the real question number on the paper
  sec: text("sec").notNull(), // "A" | "B"
  sub: text("sub").notNull(), // "a".."e"; a single, non-compound question uses "a"
  marks: real("marks").notNull(),
  topics: text("topics").array().notNull(),
  questionText: text("question_text").notNull(),
});

/**
 * One row per news article pulled into the daily current-affairs digest
 * (app/api/cron/fetch-current-affairs, opt-in behind NEWSDATA_API_KEY --
 * see lib/notifications and .env.example). summary/relatedSubtopicIds are
 * AI-produced from the real article title/description (never invented
 * content) -- relatedSubtopicIds is a best-effort tag against real syllabus
 * subtopics, empty when nothing clearly relates. sourceUrl is unique so a
 * re-fetched article across days is never duplicated.
 */
export const currentAffairsItems = pgTable(
  "current_affairs_items",
  {
    id: serial("id").primaryKey(),
    publishedDate: text("published_date").notNull(), // 'YYYY-MM-DD', the digest day this was fetched into
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    sourceUrl: text("source_url").notNull(),
    sourceName: text("source_name"),
    relatedSubtopicIds: text("related_subtopic_ids").array().notNull().default([]),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    sourceUrlUnique: unique("current_affairs_items_source_url_unique").on(table.sourceUrl),
  })
);

/**
 * A cached, AI-generated model answer for one question (PYQ or
 * AI-generated), keyed by (questionSource, questionRefId) rather than by
 * user -- both `pyqs` and `model_questions` rows are already shared/global
 * entities, so a model answer generated for one student's practice session
 * is reused by every student who later meets the exact same question, same
 * "generate once, cache forever" principle as `lessons`/`essay_guides`.
 * This is what makes /api/model-answer a real quota-saving lever, not just
 * a UX feature: it converts a per-student cost (full AI grading on every
 * submission) into a per-question one for the self-check path.
 */
export const questionModelAnswers = pgTable(
  "question_model_answers",
  {
    questionSource: text("question_source").notNull(), // 'pyq' | 'model'
    questionRefId: text("question_ref_id").notNull(),
    modelAnswer: text("model_answer").notNull(),
    keyPoints: jsonb("key_points").notNull().default([]),
    generatedAt: timestamp("generated_at").notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.questionSource, table.questionRefId] }),
  })
);

/**
 * The Essay paper's topic bank -- deliberately its own table, not shoehorned
 * into `subtopics`. An essay topic isn't a syllabus concept to Teach/Grasp/
 * Remember/Test through; it's a single prompt a student writes one full
 * 1000-1200 word essay on, graded holistically (see essayAttempts below).
 * `source` distinguishes a REAL past-year UPSC essay topic ('pyq', with
 * `year` set) from a coaching-guidance/practice-suggested topic ('guidance',
 * `year` null) -- the two are NEVER conflated (see
 * db/seed/essay-topics.js's header comment on how each was actually
 * sourced). `category` is a thematic label (Philosophy, Economy,
 * Environment, ...) for browsing, independent of `source`.
 */
export const essayTopics = pgTable("essay_topics", {
  id: text("id").primaryKey(),
  topicText: text("topic_text").notNull(),
  category: text("category").notNull(),
  source: text("source").notNull(), // 'pyq' | 'guidance'
  year: integer("year"), // set only for source:'pyq'
});

/**
 * Lazily AI-generated planning guidance for one essay topic -- populated on
 * first view (same "generate once, reuse for every student" pattern as
 * `lessons`), never a ready-made essay to copy. This is the "master
 * content" a student plans their own essay from, generated on demand
 * rather than pre-authored for all 500+ topics up front.
 */
export const essayGuides = pgTable("essay_guides", {
  essayTopicId: text("essay_topic_id")
    .primaryKey()
    .references(() => essayTopics.id),
  approachNotes: text("approach_notes").notNull(),
  keyDimensions: jsonb("key_dimensions").notNull().default([]), // [{dimension, points}]
  quotesAndReferences: jsonb("quotes_and_references").notNull().default([]), // string[]
  sampleOutline: jsonb("sample_outline").notNull().default({}), // {intro, body: string[], conclusion}
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
});

/**
 * One row per full essay submitted and graded -- holistically, not
 * per-provision like descriptive practice (see lib/ai/gradeEssay.js):
 * content/relevance, multi-dimensionality, structure, balance, and
 * language, since that's what the real Essay paper is actually judged on.
 */
export const essayAttempts = pgTable("essay_attempts", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => authUsers.id),
  essayTopicId: text("essay_topic_id")
    .notNull()
    .references(() => essayTopics.id),
  essayText: text("essay_text").notNull(),
  score: integer("score"),
  feedback: jsonb("feedback"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * AI-generated questions, written once and reused. Kept separate from pyqs so we
 * never confuse a model-authored question with a real past-paper question — the
 * distinction matters for anyone later auditing what was actually asked in an exam.
 */
export const modelQuestions = pgTable("model_questions", {
  id: serial("id").primaryKey(),
  subtopicId: text("subtopic_id")
    .notNull()
    .references(() => subtopics.id),
  difficultyTier: integer("difficulty_tier").notNull(), // 1 (PYQ-level) .. 3 (tougher/analytical/cross-topic)
  marks: integer("marks").notNull().default(15),
  questionText: text("question_text").notNull(),
  groundedSourceIds: integer("grounded_source_ids").array(), // sources.id[] used to ground generation, if any
  // Nullable: set only for a question generated with a moduleScope hint (see
  // lib/ai/generateQuestion.js) -- lets app/api/attempt's module-Test flow
  // find/reuse its one cached question via WHERE moduleId = X, without
  // disturbing the subtopic-wide pool this column defaults to (null) for.
  moduleId: integer("module_id").references(() => lessonModules.id),
  // Prelims MCQ practice mode (app/api/mcq/route.js) reuses this same table
  // rather than a parallel one -- it's still "one cached AI-generated
  // question per subtopic," just a different shape and a deterministic
  // grading path instead of an AI grading call. format/difficultyTier/marks
  // above stay meaningful for 'descriptive' rows exactly as before;
  // options/correctIndex/explanation are null for those and only set for
  // format:'mcq'.
  format: text("format").notNull().default("descriptive"), // 'descriptive' | 'mcq'
  options: jsonb("options"), // ["...", "...", "...", "..."], set only for format:'mcq'
  correctIndex: integer("correct_index"), // 0-3, set only for format:'mcq'
  explanation: text("explanation"), // set only for format:'mcq'
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * One row per question actually answered — never batched. This is the record
 * the adaptive engine reads to decide what to serve next. Every row belongs
 * to exactly one user (see app/api/setup/phase1-reset/route.js for how the
 * pre-multi-user rows were cleared before this became NOT NULL).
 */
export const attempts = pgTable("attempts", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => authUsers.id),
  subtopicId: text("subtopic_id")
    .notNull()
    .references(() => subtopics.id),
  questionSource: text("question_source").notNull(), // 'pyq' | 'model' | 'mcq' (see app/api/mcq/route.js)
  questionRefId: text("question_ref_id").notNull(), // pyqs.id or model_questions.id (as text)
  questionTextSnapshot: text("question_text_snapshot").notNull(), // self-contained even if the question later changes
  difficultyTier: integer("difficulty_tier").notNull(),
  marks: integer("marks").notNull(),
  answerText: text("answer_text").notNull(),
  score: integer("score"), // 0-100 from AI grading; null while grading is in flight
  feedback: jsonb("feedback"), // { strengths: [], weaknesses: [], missedProvisions: [], verdict: "" }
  // Nullable: set only when this attempt came from a module-scoped Test
  // (ModuleTestPanel), for traceability/UI labeling only -- no adaptive-engine
  // logic branches on it, mastery/tier updates read/write the same
  // (userId, subtopicId) mastery row regardless of whether this is set.
  moduleId: integer("module_id").references(() => lessonModules.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * One row per timed, multi-question mock test (see app/api/mock-tests/*) --
 * a bundle of several questions completed together as one sitting and
 * graded as a whole, unlike `attempts` above (always exactly one question).
 * Answers aren't persisted until grading time (see mockTestQuestions below)
 * -- the client holds them locally while the student works through the
 * paper, so an abandoned test just never gets its questions graded rather
 * than needing separate draft-save plumbing.
 */
export const mockTests = pgTable("mock_tests", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => authUsers.id),
  subjectId: text("subject_id")
    .notNull()
    .references(() => subjects.id),
  size: text("size").notNull(), // 'sectional' | 'full'
  totalMarks: integer("total_marks").notNull(), // sum of the selected questions' marks
  durationMinutes: integer("duration_minutes").notNull(),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  submittedAt: timestamp("submitted_at"), // null while still in progress
  totalScore: integer("total_score"), // sum of round(score/100 * marks) per question; null until finished
});

/**
 * One row per question within a mock test, in paper order. Mirrors
 * `attempts`' per-question shape (questionSource/questionRefId/marks/
 * answerText/score/feedback) but scoped to one mockTestId instead of being
 * a standalone practice attempt -- deliberately NOT also written into
 * `attempts` or read by the adaptive engine, same "separate signal"
 * principle as MCQ practice (see app/api/mcq/route.js): a mock test is a
 * self-check simulation, not a mastery-gating input.
 */
export const mockTestQuestions = pgTable("mock_test_questions", {
  id: serial("id").primaryKey(),
  mockTestId: integer("mock_test_id")
    .notNull()
    .references(() => mockTests.id),
  orderIndex: integer("order_index").notNull(),
  subtopicId: text("subtopic_id")
    .notNull()
    .references(() => subtopics.id),
  questionSource: text("question_source").notNull(), // 'pyq' | 'model'
  questionRefId: text("question_ref_id").notNull(),
  questionText: text("question_text").notNull(),
  marks: integer("marks").notNull(),
  answerText: text("answer_text"), // null until the student's grade-question call saves it
  // 0-100; null until app/api/cron/grade-daily-answers/route.js's nightly
  // run grades it (an unanswered question, answerText still null, is never
  // sent for grading and is treated as 0 marks earned when that same cron
  // sums mockTests.totalScore).
  score: integer("score"),
  feedback: jsonb("feedback"),
});

/**
 * Spaced-repetition review state for flashcards (see lib/adaptive/srs.js,
 * lib/adaptive/flashcards.js). A "card" isn't stored anywhere -- it's
 * derived fresh on every fetch from content a real Teach/Grasp visit
 * already generated (lessons.keyProvisions/caseLaw/mnemonics,
 * lessonModules.keyPoints/mnemonic), so cardId is a deterministic string
 * (e.g. "lesson:CA2:kp:0") this table's PK anchors review state to, not a
 * foreign key to a cards table. Simplified SM-2, same algorithm Anki's
 * predecessor SuperMemo used: easeFactor/intervalDays/repetitions evolve
 * per review, dueAt is when it should be shown again. No row here at all
 * means "never reviewed" -- treated as immediately due, same as any other
 * new card.
 */
export const flashcardReviews = pgTable(
  "flashcard_reviews",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id),
    cardId: text("card_id").notNull(),
    subtopicId: text("subtopic_id")
      .notNull()
      .references(() => subtopics.id),
    easeFactor: real("ease_factor").notNull().default(2.5),
    intervalDays: integer("interval_days").notNull().default(0),
    repetitions: integer("repetitions").notNull().default(0),
    dueAt: timestamp("due_at").notNull().defaultNow(),
    lastReviewedAt: timestamp("last_reviewed_at"),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.cardId] }),
  })
);

/**
 * One row per user -- their own DAF-style background, used to ground
 * generated interview questions (see interviewSessions below). Entirely
 * self-declared, same spirit as mastery.notes: nothing here is verified or
 * cross-checked, it's just context fed into the question generator.
 */
export const interviewProfiles = pgTable("interview_profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => authUsers.id),
  hometown: text("hometown").notNull().default(""),
  education: text("education").notNull().default(""),
  workExperience: text("work_experience").notNull().default(""),
  hobbies: text("hobbies").notNull().default(""),
  servicePreference: text("service_preference").notNull().default(""),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * One row per generated mock interview (Personality Test) question set --
 * lightweight by design: a real interview is evaluated on demeanor and
 * spoken delivery, not just content, so this deliberately does NOT attempt
 * AI grading of a typed answer the way descriptive practice does. `notes`
 * is the candidate's own post-hoc self-reflection per question (keyed by
 * array index as a string), not an AI-graded score.
 */
export const interviewSessions = pgTable("interview_sessions", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => authUsers.id),
  questions: jsonb("questions").notNull(), // [{category, question}]
  notes: jsonb("notes").notNull().default({}), // { [questionIndex]: "self-reflection text" }
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * One row per (user, subtopic): the running mastery estimate the adaptive
 * engine both reads and updates. See lib/adaptive/engine.js for the update
 * rule.
 *
 * PK is composite (userId, subtopicId) -- each user has their own mastery
 * state per subtopic. Pre-multi-user rows were cleared (not backfilled to
 * an owner) via app/api/setup/phase1-reset/route.js before this landed.
 */
export const mastery = pgTable(
  "mastery",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id),
    subtopicId: text("subtopic_id")
      .notNull()
      .references(() => subtopics.id),
    masteryScore: real("mastery_score").notNull().default(0),
    attemptsCount: integer("attempts_count").notNull().default(0),
    currentTier: integer("current_tier").notNull().default(1),
    recentScores: jsonb("recent_scores").notNull().default([]),
    lastAttemptAt: timestamp("last_attempt_at"),
    stage: text("stage").notNull().default("teach"), // which of teach/grasp/remember/test within the CURRENT module (or, for a legacy subtopic, within the whole subtopic)
    // Nullable: which lesson_modules.orderIndex the student is currently on
    // for this subtopic, so re-entering resumes where they left off. Null
    // for a subtopic still on the legacy (pre-module) lessons flow.
    currentModuleIndex: integer("current_module_index"),
    // Per-module mastery-gating state, keyed by lessonModules.id (jsonb
    // object keys are always strings): { [moduleId]: { highestStage:
    // "teach"|"grasp"|"remember"|"test", testAttempts: number, bestScore01:
    // number } }. highestStage is a sequential-completion high-water mark --
    // distinct from `stage` above (just "where the student is currently
    // looking," which moves backward freely via tab clicks). testAttempts
    // is what the next module's unlock check (lib/adaptive/unlocks.js)
    // requires be >=1, closing the loophole where unrelated prior attempts
    // elsewhere in the subtopic could already satisfy a pure mastery-score
    // check before this specific module was ever attempted.
    moduleProgress: jsonb("module_progress").notNull().default({}),
    // Personal, self-declared tracking -- deliberately separate from the
    // AI-graded masteryScore/stage/moduleProgress above, never read by the
    // adaptive engine or the mastery-gating logic (lib/adaptive/unlocks.js)
    // and never auto-updated by anything in this app. A student who read a
    // topic from their own outside sources, or just wants a personal
    // checklist independent of AI-graded practice, can mark it here without
    // that affecting what unlocks next -- keeps "I consider this covered"
    // and "the AI has verified I've mastered this" as two honestly distinct
    // signals instead of conflating them.
    notes: text("notes").notNull().default(""),
    selfStatus: text("self_status").notNull().default("not-started"), // 'not-started' | 'in-progress' | 'done'
    // Set only by redeeming an 'unlock_pass' item (see playerItems below) on
    // this subtopic -- while in the future, lib/adaptive/lockState.js's
    // loadPaperLockMap treats this subtopic as unlocked regardless of the
    // real subtopic-chain mastery check, i.e. "early access to a locked
    // topic." Null for every subtopic no pass was ever spent on. Deliberately
    // subtopic-chain-only, not module-chain -- redeeming a pass to skip
    // straight to a module deep inside an unstudied subtopic wouldn't be
    // "early access to a topic," it'd be skipping the topic entirely.
    unlockOverrideUntil: timestamp("unlock_override_until"),
    // Bloom Knowledge Forest, Phase G1 (see lib/forest/growth.js) -- a
    // ratcheted high-water mark over masteryScore, one of
    // lib/forest/growth.js's GROWTH_STAGES ids. Cached/derived, not
    // authoritative: always the max of its previous value and
    // growthStageForScore(masteryScore) as of the last write, never
    // decreases on its own. Default 'seed' matches a never-attempted row.
    growthStage: text("growth_stage").notNull().default("seed"),
    // SM-2-style ease factor (see lib/adaptive/srs.js's DEFAULT_EASE_FACTOR,
    // reused not reinvented) driving lib/forest/decay.js's retention curve
    // -- distinct from currentTier above (that's question difficulty;
    // this is memory-decay speed). Bumped by lib/forest/decay.js's
    // applyRevision() on each successful review, same growth direction as
    // flashcards' own ease factor.
    retentionEaseFactor: real("retention_ease_factor").notNull().default(2.5),
    // { score: number (0-1), at: ISO timestamp } -- the point
    // lib/forest/decay.js's retention() decays forward from. Snapshotted
    // whenever masteryScore is freshly updated from a graded attempt.
    // Empty object for a never-attempted row (decay.js treats a missing
    // checkpoint as "nothing to decay yet," not zero retention).
    lastRetentionCheckpoint: jsonb("last_retention_checkpoint").notNull().default({}),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.subtopicId] }),
  })
);

/**
 * One row per user -- the account-wide gamification state layered on top of
 * per-subtopic mastery (that stays the real learning signal; this is the
 * game-feel layer on top of it).
 *
 * `seeds` is the spendable in-app currency (Bloom Knowledge Forest) --
 * earned from daily missions (see dailyMissionLog below) and from a
 * subtopic newly reaching the "mastered_tree" growth stage (bearing
 * fruit -- see lib/adaptive/masteryUpdate.js), never decreases on its own.
 * This is what TRACK_SWITCH_SEEDS_THRESHOLD and any future "spend to
 * unlock" mechanic gate on.
 *
 * `xp` is now READ-ONLY / vestigial -- it used to be this same
 * effort-earned currency (renamed to `seeds` above) but is no longer
 * written to. "XP" as a user-facing label has been repointed at account
 * age instead (lib/gamification/missions.js's accountAgeXp(), computed
 * from authUsers.createdAt at read time, not stored here) -- kept as a
 * real column rather than dropped, since there's no live data worth losing
 * by leaving it in place unused.
 *
 * streak fields track consecutive calendar days with at least one
 * completed mission -- lastActivityDate ('YYYY-MM-DD', UTC) is the cheap
 * way to tell "already counted today" from "a new day, extend or reset the
 * streak" without a second query. lockdownGraceUntil is redeemed from a
 * 'lockdown_grace' item (see playerItems) -- while in the future,
 * lib/adaptive/subjectUnlockState.js's checkLockdown treats the student as
 * not locked down regardless of the real missed-checkpoint state.
 */
export const playerState = pgTable("player_state", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => authUsers.id),
  xp: integer("xp").notNull().default(0), // vestigial -- see comment above, no longer written to
  seeds: integer("seeds").notNull().default(0),
  currentStreakDays: integer("current_streak_days").notNull().default(0),
  longestStreakDays: integer("longest_streak_days").notNull().default(0),
  lastActivityDate: text("last_activity_date"), // 'YYYY-MM-DD', null before the first mission is ever completed
  lockdownGraceUntil: timestamp("lockdown_grace_until"),
  // 'starting_out' | 'beginner' | 'advanced' | 'fastforward' -- assigned by
  // the mandatory placement quiz at onboarding (see
  // db/seed/placementQuiz.js, app/api/onboarding/route.js), null before the
  // quiz is completed. Drives which fixed 7-day curriculum
  // (db/seed/onboardingWeekPlans.js) a new student sees for days 0-6. Can
  // change later via self-select once seeds clears
  // TRACK_SWITCH_SEEDS_THRESHOLD (app/api/onboarding/route.js) --
  // trackSetAt records when it was last set.
  track: text("track"),
  trackSetAt: timestamp("track_set_at"),
  // PvP arena (lib/gamification/pvp.js) -- a "defense" is a fixed MCQ set
  // this user answered, standing as their benchmark until they refresh it.
  // An attacker later takes the SAME question set (defenseQuestions,
  // correctIndex included -- never sent to an attacker pre-submission) and
  // compares their score against defenseScore; no synchronization between
  // two live players needed. defenseScore is null while a fresh set has
  // been issued but not yet answered (see app/api/pvp/defense/start) -- a
  // brief "defense is down" window is an accepted, deliberate tradeoff of
  // this design, not a bug.
  defenseScore: integer("defense_score"),
  defenseQuestions: jsonb("defense_questions"), // [{ questionText, options, correctIndex }], null before a defense is ever set
  defenseSetAt: timestamp("defense_set_at"),
  // Set after this user is successfully attacked (loses) -- while in the
  // future, excluded from other players' opponent search
  // (lib/gamification/pvp.js's findOpponents). Deliberate anti-griefing
  // guardrail so a stronger player can't repeatedly farm the same weaker
  // one.
  shieldedUntil: timestamp("shielded_until"),
});

/**
 * One row per resolved PvP arena attack (lib/gamification/pvp.js) --
 * always resolves immediately (the attacker's score is compared against
 * the defender's already-standing benchmark the moment the attacker
 * submits), never a "waiting on the other player" state. attackerScore/
 * defenderScore are both out of the same question count
 * (DEFENSE_QUIZ_SIZE), so they're directly comparable without a percentage
 * conversion. seedsLooted is 0 on a loss/tie -- only a clear attacker win
 * transfers anything, and only ever from a bounded, fixed wager
 * (SEEDS_WAGER), never a fraction of the defender's whole balance.
 */
export const pvpAttacks = pgTable("pvp_attacks", {
  id: serial("id").primaryKey(),
  attackerUserId: uuid("attacker_user_id")
    .notNull()
    .references(() => authUsers.id),
  defenderUserId: uuid("defender_user_id")
    .notNull()
    .references(() => authUsers.id),
  attackerScore: integer("attacker_score").notNull(),
  defenderScore: integer("defender_score").notNull(),
  outcome: text("outcome").notNull(), // 'win' | 'loss' | 'tie' (from the attacker's perspective)
  seedsLooted: integer("seeds_looted").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * Dragon's Challenge (lib/ai/generateDragonChallenge.js) -- a one-time RPG
 * intro per (student, subtopic): before Module 1's Teach, a wise old dragon
 * poses a real Mains-level question on the subtopic's fundamentals and
 * sends the student to attempt it BEFORE any teaching happens (a diagnostic
 * hook, not a gate on it -- see app/api/dragon-challenge/route.js). Grading
 * follows this app's standing 2026-07-24 overnight-batch-grading
 * convention (see app/api/cron/grade-daily-answers/route.js) -- score/
 * feedback stay null until that runs, same as attempts/essayAttempts, and
 * the student is never blocked on the wait: submitting is what unlocks the
 * module sequence, not being graded.
 */
export const dragonChallenges = pgTable(
  "dragon_challenges",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id),
    subtopicId: text("subtopic_id")
      .notNull()
      .references(() => subtopics.id),
    questionText: text("question_text").notNull(),
    marks: integer("marks").notNull(),
    // Set when grounded in a real Mains PYQ for this subtopic (preferred,
    // same precedent as lesson_modules.pyqId); null when AI-generated
    // because no suitable real PYQ existed.
    pyqId: text("pyq_id").references(() => pyqs.id),
    answerText: text("answer_text"),
    submittedAt: timestamp("submitted_at"),
    score: integer("score"), // 0-100 from AI grading; null while grading is pending/in flight
    feedback: jsonb("feedback"), // { strengths: [], weaknesses: [], verdict: "" } -- same shape as attempts.feedback
    gradedAt: timestamp("graded_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.subtopicId] }),
  })
);

/**
 * Daily Bounty (lib/gamification/bounties.js) -- one row per (student,
 * date, subtopic) the student's actual day-plan assigned as a "learn" day
 * topic. Four steps, each a nullable timestamp (null = not done yet):
 * teachDoneAt, currentAffairsDoneAt, notesDoneAt, prelimsDoneAt. Once all
 * four are set, bloomedAt is set exactly once and a seed bonus is granted
 * -- the "topic blooms today" moment the map surfaces as a bounty. Scoped
 * to the student's REAL plan for that day (lib/adaptive/planEngine.js),
 * not just "any topic" -- this is deliberately about today's actual
 * assigned content, not a generic daily checklist.
 */
export const dailyBounties = pgTable(
  "daily_bounties",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id),
    bountyDate: text("bounty_date").notNull(), // 'YYYY-MM-DD', UTC -- same convention as dailyMissionLog.missionDate
    subtopicId: text("subtopic_id")
      .notNull()
      .references(() => subtopics.id),
    teachDoneAt: timestamp("teach_done_at"),
    // Auto-satisfied alongside teachDoneAt, whether or not the module
    // actually had real current-affairs correlation to show -- a topic
    // with no genuine current-affairs angle can't be blocked from
    // blooming on something that doesn't exist for it. See
    // lib/gamification/bounties.js's markTeachDone.
    currentAffairsDoneAt: timestamp("current_affairs_done_at"),
    notesDoneAt: timestamp("notes_done_at"),
    prelimsDoneAt: timestamp("prelims_done_at"),
    bloomedAt: timestamp("bloomed_at"),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.bountyDate, table.subtopicId] }),
  })
);

/**
 * Alliances (lib/gamification/alliances.js) -- Kingshot-style guilds.
 * `tag` is a short (2-5 char), unique, uppercase handle shown next to a
 * member's label on the World Map and Arena, same convention as a real
 * guild tag. A student belongs to at most one alliance at a time
 * (allianceMembers.userId is the primary key, not composite) -- simpler
 * than multi-alliance membership, and matches how Kingshot/most guild
 * games actually work.
 */
export const alliances = pgTable("alliances", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  tag: text("tag").notNull().unique(),
  description: text("description").notNull().default(""),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => authUsers.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const allianceMembers = pgTable("alliance_members", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => authUsers.id),
  allianceId: integer("alliance_id")
    .notNull()
    .references(() => alliances.id),
  role: text("role").notNull().default("member"), // 'leader' | 'member' -- only the leader can rename/disband
  joinedAt: timestamp("joined_at").notNull().defaultNow(),
});

/**
 * Inventory of special-access items earned from completed daily missions
 * (see dailyMissionLog) -- one row per item, never merged into a stacked
 * count, so earnedAt/usedAt stay individually meaningful (e.g. "which of my
 * 3 unlock passes is this, and when did I get it"). itemType decides what
 * redeeming it actually does (see mastery.unlockOverrideUntil and
 * playerState.lockdownGraceUntil above for the two functional types);
 * 'cosmetic_badge' has no redemption step -- earning it IS the reward, it
 * just sits in the trophy case permanently (usedAt stays null forever for
 * this type; lib/gamification/items.js's listUsableItems filters by
 * itemType, not usedAt alone, so a badge never shows up as "actionable").
 */
export const playerItems = pgTable("player_items", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => authUsers.id),
  itemType: text("item_type").notNull(), // 'unlock_pass' | 'lockdown_grace' | 'cosmetic_badge'
  label: text("label").notNull(), // display name, e.g. "48h Early Access Pass", "Streak Saver — Day 7"
  earnedFromMissionKey: text("earned_from_mission_key"), // 'learn' | 'practice' | 'pass', which daily mission granted this
  earnedAt: timestamp("earned_at").notNull().defaultNow(),
  usedAt: timestamp("used_at"), // null = still in inventory, unused
});

/**
 * One row per (user, calendar day, mission) completed -- the composite PK
 * is what makes "only reward the first completion per day" a plain
 * onConflictDoNothing insert rather than a read-then-write race. The three
 * missionKeys are fixed, not configurable content: 'learn' (viewed/generated
 * Teach content for at least one subtopic/module today), 'practice'
 * (submitted at least one graded attempt today, any format), 'pass' (scored
 * at or above lib/adaptive/scoring.js's PASSING_SCORE_PCT on an attempt
 * today). rewardItemId is nullable only because it's set in a second write
 * right after the reward is rolled (see lib/gamification/missions.js) --
 * every real completion ends up with one.
 */
export const dailyMissionLog = pgTable(
  "daily_mission_log",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id),
    missionDate: text("mission_date").notNull(), // 'YYYY-MM-DD', UTC
    missionKey: text("mission_key").notNull(), // 'learn' | 'practice' | 'pass'
    completedAt: timestamp("completed_at").notNull().defaultNow(),
    rewardItemId: integer("reward_item_id").references(() => playerItems.id),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.missionDate, table.missionKey] }),
  })
);

/**
 * A THIRD, higher-level gate above subtopic/module gating (lib/adaptive/
 * unlocks.js): which whole GS papers and which single optional subject a
 * student can even see subtopics for at all. Row presence = unlocked, for a
 * (userId, subjectId) pair -- only ever written to for a "gated" subject
 * (category 'gs' or 'optional', see lib/adaptive/subjectUnlocks.js), never
 * for prelims/essay/qualifying, which stay accessible per the existing
 * subtopic-level gating alone. A student picks 2 GS subjects + 1 optional at
 * onboarding (3 rows inserted at once); more GS subjects unlock over time --
 * see maybeUnlockNextGsSubject in lib/adaptive/subjectUnlockState.js. The
 * optional choice is NOT grown the same way: a real UPSC candidate only ever
 * sits one optional paper, so exactly one optional row ever exists per user
 * (changeable later, but that's a deliberate settings action, not part of
 * the automatic unlock progression).
 */
export const subjectUnlocks = pgTable(
  "subject_unlocks",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id),
    subjectId: text("subject_id")
      .notNull()
      .references(() => subjects.id),
    unlockedAt: timestamp("unlocked_at").notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.subjectId] }),
  })
);

/**
 * Populated in three lazy phases, not all at once -- see lib/ai/generateLesson.js
 * and app/api/lesson/route.js. "core" (teachContent/keyProvisions/caseLaw) is
 * generated on first Teach visit and always present once a row exists.
 * "practice" (perspectives/answerFramework/examples/exercises/mnemonics/
 * visualOutline) only runs once the student reaches Grasp -- practiceGeneratedAt
 * is how the route knows whether that's happened yet (not an array-length
 * check: normalizePracticeResult can legitimately return an empty array,
 * which would look identical to "never generated" under a length check).
 * "image" (visualImageDataUri) only runs once the student reaches Remember.
 * The four columns below default so a core-only insert doesn't violate
 * NOT NULL before the later phases have run.
 */
export const lessons = pgTable("lessons", {
  subtopicId: text("subtopic_id")
    .primaryKey()
    .references(() => subtopics.id),
  teachContent: text("teach_content").notNull(),
  keyProvisions: jsonb("key_provisions").notNull().default([]),
  caseLaw: jsonb("case_law").notNull().default([]),
  perspectives: jsonb("perspectives").notNull().default([]),
  answerFramework: text("answer_framework"),
  examples: jsonb("examples").notNull().default([]),
  exercises: jsonb("exercises").notNull().default([]),
  mnemonics: jsonb("mnemonics").notNull().default([]),
  visualOutline: jsonb("visual_outline").notNull().default({ label: "Overview", children: [] }),
  practiceGeneratedAt: timestamp("practice_generated_at"),
  visualImageDataUri: text("visual_image_data_uri"),
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
});

/**
 * A subtopic decomposed into independently teachable/practiceable/testable
 * sub-concepts (see lib/ai/generateModules.js's generateModulePlan) -- each
 * row gets its OWN full Teach -> Grasp -> Remember -> Test cycle via
 * app/api/module-lesson/route.js, rather than one cycle covering the whole
 * subtopic (that's what `lessons` above still does, kept alive as the
 * legacy flow for subtopics that already have a complete row there).
 *
 * Rows are bulk-inserted as skeletons (title/scopeNote only) the moment a
 * subtopic's module plan is generated, THEN filled in lazily -- unlike
 * `lessons` (only ever inserted once its core phase is ready), so
 * `generatedAt`/`practiceGeneratedAt` are both nullable here with no
 * default, not "row exists" proxies.
 *
 * Deliberately lighter than `lessons`: no keyProvisions/caseLaw split (flat
 * keyPoints bullets instead), no perspectives/answerFramework (exam-answer
 * structuring belongs at the whole-subtopic/PYQ level, not a module slice),
 * no image/visualOutline phase at all, one mnemonic instead of an array --
 * this keeps the AI-call multiplier from a subtopic's module count sane
 * (see the plan doc / PR description for the concrete math).
 */
export const lessonModules = pgTable(
  "lesson_modules",
  {
    id: serial("id").primaryKey(),
    subtopicId: text("subtopic_id")
      .notNull()
      .references(() => subtopics.id),
    orderIndex: integer("order_index").notNull(), // 0-based sequence within the subtopic
    title: text("title").notNull(),
    // Planning output (buildPlanSystem/buildPyqAnchoredPlanSystem) -- a
    // short legal/structural reference like "Part III: Articles 12-35" or
    // "Article 368", used as part of the displayed title spine wherever a
    // module's title renders (module list, Book view, ModuleTestPanel),
    // matching how real coaching material titles its own chapters. Empty
    // string (never null) for subjects/modules with no article/part
    // numbering to speak of (most non-Polity/non-legal subtopics).
    articleRef: text("article_ref").notNull().default(""),
    scopeNote: text("scope_note").notNull().default(""), // planning output, fed back into every module-scoped prompt as narrowing context
    // Null = AI-invented fallback module (the subtopic had fewer than 2 real
    // PYQs to anchor to). Set = this module is built around answering this
    // exact real exam question -- its Teach/Grasp content is grounded in the
    // question's real text, and its Test serves this PYQ directly (zero AI
    // calls) instead of generating one. See app/api/module-lesson/route.js's
    // plan phase for the selection/threshold logic and
    // lib/ai/generateModules.js's generateModulePlanFromPyqs.
    pyqId: text("pyq_id").references(() => pyqs.id),
    // Teach phase, null until first Teach visit to this module
    teachContent: text("teach_content"),
    keyPoints: jsonb("key_points").notNull().default([]), // flat bullet strings, not structured keyProvisions/caseLaw objects
    // Distinct from keyPoints -- current-affairs correlation points,
    // explicitly framed for citing in an answer (see lib/ai/generateModules.js's
    // buildModuleTeachSystem, 2026-07-26 "teach base concept fully first,
    // correlate current affairs last" change). Empty when no current-affairs
    // item genuinely connects to this module -- never forced.
    currentAffairsLink: jsonb("current_affairs_link").notNull().default([]),
    generatedAt: timestamp("generated_at"),
    // Practice phase -- covers Grasp (examples/exercises/mnemonic), null
    // until first Grasp visit to this module
    examples: jsonb("examples").notNull().default([]),
    exercises: jsonb("exercises").notNull().default([]),
    mnemonic: jsonb("mnemonic"), // single {device, explanation} object, or null
    practiceGeneratedAt: timestamp("practice_generated_at"),
    // Image phase -- separate from practice again (reintroduced after
    // initially being cut for cost): null until first Remember visit,
    // non-fatal on generation failure (see generateModuleImage). Built from
    // this module's title/keyPoints, not a nested visualOutline tree like
    // lessons.visualImageDataUri -- a module is already a narrow single
    // concept, so a flat prompt is enough.
    visualImageDataUri: text("visual_image_data_uri"),
    // Story Mode -- an OPTIONAL enrichment on top of Remember (see
    // lib/ai/generateModules.js's generateModuleStory), not part of the
    // teach/practice/image progression chain and not required to reach
    // Test. Null until a student first opens it for this module; generated
    // once and cached forever after, same convention as every other phase.
    // Array of { sceneText, choices: [{ label, reaction }] }.
    storyScenes: jsonb("story_scenes"),
    // Time-Scene Challenge -- another OPTIONAL Remember-stage enrichment
    // (see lib/ai/generateModules.js's generateModuleScene): an immersive
    // scene description dropping the student into a real historical/
    // geographic moment tied to this module, plus one identification
    // question (era/revolution/region/society) with a known correct
    // answer -- multiple-choice, so it's graded client-side instantly,
    // never touching the overnight batch-grading pipeline. Same
    // generate-once-cache-forever convention as storyScenes. Shape:
    // { sceneText, question, options: string[4], correctIndex, explanation }.
    sceneChallenge: jsonb("scene_challenge"),
    // Generated in the SAME Teach-phase AI call as teachContent/keyPoints
    // (see buildModuleTeachSystem) -- a short { date, label } sequence
    // extracted from this module's real content, ONLY when it's a genuine
    // ordered sequence: real historical chronology, a staged/phased
    // process (e.g. India's three-stage nuclear programme, a policy
    // transmission mechanism), or an ordered achievement list -- `date` is
    // a real year/period for the first case, a stage/step label for the
    // other two. Empty array for everything else, never forced onto
    // content that isn't a real sequence. Rendered as a timeline ABOVE the
    // prose in Teach, matching the "visual sequence before the bullets"
    // pattern observed in real coaching material (2026-08-03 analysis,
    // broadened 2026-08-03 beyond pure history per explicit request).
    timelineEvents: jsonb("timeline_events").notNull().default([]),
    // Same "generated in the Teach call, only when genuinely applicable"
    // convention as timelineEvents -- a real two-sided comparison (e.g.
    // "India vs World"), rendered as the Comparison Duel minigame
    // (components/ComparisonDuel.jsx). Null when this module has no real
    // comparison to draw. Shape: { leftLabel, rightLabel, rows: [{
    // attribute, left, right }] }.
    comparisonData: jsonb("comparison_data"),
    // Same convention -- a hub of genuinely related items (e.g. Mesolithic
    // sites sharing a culture), rendered as the Network Explorer minigame
    // (components/NetworkExplorer.jsx). Null when this module has nothing
    // network-shaped. Shape: { hubLabel, nodes: [{ label, detail,
    // connectionReason }] } -- a hub-and-spoke model (every node connects
    // to the one hub), not a general multi-hub graph; matches every real
    // example given for this feature and is far simpler to lay out than a
    // general graph would be.
    networkData: jsonb("network_data"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    subtopicOrderUnique: unique("lesson_modules_subtopic_order_unique").on(table.subtopicId, table.orderIndex),
  })
);

/**
 * One row per (subjectId, paper, section) -- the AI-authored, SUBJECT-WIDE
 * (subtopics.section, e.g. "Polity") chapter plan that REPLACES per-chapter-
 * isolated generateModulePlan/generateModulePlanFromPyqs calls as the
 * source of what a chapter's (subtopics row) lesson_modules actually are --
 * see lib/ai/generateSubjectBookPlan.js and app/api/module-lesson/route.js's
 * plan-creation branch. Scoped to one Subject rather than a whole paper
 * (which can run 20-40+ chapters) so a single AI call stays reliably sized;
 * a Subject is already the real syllabus's own coherent 3-9-chapter
 * cluster (see the comment on subtopics.section).
 *
 * Generated once, lazily, the first time any chapter in this
 * (subjectId, paper, section) is opened with no existing plan row -- same
 * "generate once, cache forever" convention as every other AI phase in this
 * app; not per-user, since a syllabus plan is the same for everyone.
 *
 * planData is keyed by subtopicId so the route's per-chapter insert step can
 * look up exactly its own chapter's module list without re-parsing the
 * whole plan: `{ [subtopicId]: { modules: [{ title, scopeNote, articleRef,
 * pyqId }], prerequisiteSubtopicIds: string[] } }`. `modules` entries are
 * already in the exact shape lesson_modules expects (pyqId set only for
 * PYQ-anchored chapters, same as today). `prerequisiteSubtopicIds` is a
 * byproduct of this same call -- captured here, not yet acted on until a
 * later part wires it into subtopics.prerequisiteSubtopicIds/scheduling.
 */
export const subjectBookPlans = pgTable(
  "subject_book_plans",
  {
    subjectId: text("subject_id")
      .notNull()
      .references(() => subjects.id),
    paper: integer("paper").notNull(),
    section: text("section").notNull(),
    planData: jsonb("plan_data").notNull().default({}),
    generatedAt: timestamp("generated_at").notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.subjectId, table.paper, table.section] }),
  })
);

/**
 * One row per (user, 30-day window since plan start) -- the "anchor"
 * mastery percentage a window's trajectory target is computed from (see
 * lib/adaptive/pacing.js). Written once, lazily, the first time
 * lib/adaptive/paceState.js's getPaceStatus is asked about a window that
 * doesn't have a row yet; never updated after that -- a window's target is
 * fixed once set, which is what makes "re-anchor every 30 days" a real,
 * discrete recalibration event rather than a continuously-drifting number.
 * windowIndex 0's anchor is always the fixed PACE_START_MASTERY floor, not
 * measured; every later window's anchor is whatever mastery was actually
 * observed at that point, which is the "based on user usage" adjustment.
 */
/**
 * One row per calendar month ('YYYY-MM') -- an AI-synthesized, theme-
 * grouped overview of that month's already-stored current_affairs_items
 * (see lib/ai/monthlyDigest.js). Generated once, lazily, on first request
 * for a month that doesn't have a row yet, and reused for every student who
 * views it after -- same "generate once, cache forever" pattern as
 * essay_guides/question_model_answers, not a per-student cost.
 */
export const monthlyDigests = pgTable("monthly_digests", {
  month: text("month").primaryKey(), // 'YYYY-MM'
  overview: text("overview").notNull(),
  themes: jsonb("themes").notNull().default([]), // [{theme, points: string[]}]
  itemCount: integer("item_count").notNull(), // how many daily items fed this digest, for display ("built from N articles")
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
});

export const paceCheckpoints = pgTable(
  "pace_checkpoints",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id),
    windowIndex: integer("window_index").notNull(), // 0-based, floor(dayNumber / 30)
    windowStartDay: integer("window_start_day").notNull(), // windowIndex * 30, denormalized for cheap reads
    anchorMasteryPct: real("anchor_mastery_pct").notNull(), // 0-100
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.windowIndex] }),
  })
);

/**
 * One row per (user, calendar day the answers were SAVED) -- a plain
 * arithmetic summary (no AI call, unlike monthlyDigests above) written once
 * by app/api/cron/grade-daily-answers/route.js after it finishes grading
 * that user's backlog for the night, over the attempts/essayAttempts/
 * mockTestQuestions rows it just graded. This is the "marks archived
 * daywise" record a student checks the next morning instead of getting
 * per-answer feedback in real time -- see the overnight-batch-grading
 * change (2026-07-24).
 */
export const dailyResultsDigests = pgTable(
  "daily_results_digests",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id),
    date: text("date").notNull(), // 'YYYY-MM-DD'
    itemCount: integer("item_count").notNull(),
    avgScore: real("avg_score").notNull(), // 0-100
    bySubtopic: jsonb("by_subtopic").notNull().default([]), // [{subtopicId, topicText, itemCount, avgScore}]
    generatedAt: timestamp("generated_at").notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.date] }),
  })
);

/**
 * One row per CSAT quant subtopic -- a short "explanation + shortcuts"
 * refresher shown above each question in the Quant Puzzle Chain (see
 * components/QuantPuzzleChain.jsx and app/api/quant-lesson/route.js).
 * Deliberately NOT lessonModules: that table's module-locking/stage
 * machinery is exactly the heavy Teach->Grasp->Remember->Test system CSAT
 * quant was built to bypass, and its shape (examples/exercises/mnemonic/
 * image/pyqId) doesn't fit "short refresher" well. Generated once, lazily,
 * on first request for a subtopic that doesn't have a row yet, and reused by
 * every student who reaches it after -- same "generate once, cache forever"
 * pattern as monthly_digests/essay_guides.
 */
export const quantLessons = pgTable("quant_lessons", {
  subtopicId: text("subtopic_id")
    .primaryKey()
    .references(() => subtopics.id),
  explanation: text("explanation").notNull(), // bullet-per-line, same style as lessonModules.teachContent
  shortcuts: jsonb("shortcuts").notNull().default([]), // flat array of short trick/shortcut strings
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
});

/**
 * One row per (user, week the nudge APPLIES to) -- Part E4's weekly AI
 * adjustment layer. Written by app/api/cron/weekly-replan/route.js once a
 * user has crossed a new 7-day boundary (weekIndex = floor(dayNumber / 7),
 * same "day 0 is onboarding day" numbering as lib/adaptive/planEngine.js),
 * reading the JUST-COMPLETED week's real attempts + weekly test score. This
 * AUGMENTS the existing deterministic lib/adaptive/planEngine.js schedule,
 * it does not replace it -- buildDayPlan reads it as a soft bias (focus
 * subtopics sort earlier when otherwise tied, extra-revision subtopics are
 * prioritized on revise days), never as a full alternate schedule. Mirrors
 * pace_checkpoints' composite-PK, "written once per window" shape.
 */
// ============================================================================
// Legal Case Manager (2026-07-27) -- a second, self-contained product living
// in the same app: document ingestion (image/PDF, OCR'd via Gemini vision --
// see lib/legal/extractDocument.js) that helps a user set up and run a real
// legal/administrative case -- parties, forum selection, hearing/deadline
// tracking, and AI-assisted drafting. Deliberately separate tables from the
// exam-prep schema above (nothing here is exam content), all prefixed
// `legal` so they group together and never collide with the unprefixed
// exam-prep table names. Every table is scoped to the owning user (directly
// via userId, or transitively via caseId -> legalCases.userId) -- there is
// no shared/global data in this feature, unlike subtopics/sources/pyqs above.
// ============================================================================

/**
 * One row per case a user is tracking -- the hub every other legal_* table
 * (except legalDocuments, which can exist standalone before being attached)
 * hangs off of via caseId. `status` is the case's own lifecycle, independent
 * of any single hearing's status (see legalCaseEvents below). `forumId`
 * points at the catalog (legalForums) once a forum is actually chosen;
 * `courtName` is free text for the specific bench/branch (e.g. "Delhi
 * District Consumer Commission, Saket") since the catalog models forum
 * TYPES, not every physical registry. `subjectMatter` is a short free-text
 * tag (e.g. "consumer dispute", "cheque bounce") -- the main signal
 * lib/legal/forumRecommend.js matches against legalForums.subjectTags.
 */
export const legalCases = pgTable("legal_cases", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => authUsers.id),
  title: text("title").notNull(),
  caseNumber: text("case_number"), // filled in once actually filed/allotted; null for a case still being prepared
  caseType: text("case_type").notNull().default("other"), // 'civil' | 'criminal' | 'writ' | 'consumer' | 'administrative' | 'family' | 'labour' | 'tax' | 'arbitration' | 'other'
  status: text("status").notNull().default("draft"), // 'draft' | 'active' | 'stayed' | 'disposed' | 'closed'
  forumId: integer("forum_id").references(() => legalForums.id),
  courtName: text("court_name"), // specific bench/branch, free text -- distinct from forumId's catalog TYPE
  jurisdictionState: text("jurisdiction_state"),
  causeOfAction: text("cause_of_action"), // the underlying wrong/dispute, in the user's own words
  subjectMatter: text("subject_matter"), // short tag used for forum matching, e.g. "consumer dispute"
  claimAmount: real("claim_amount"), // pecuniary value in dispute, null if not applicable/known
  filingDate: timestamp("filing_date"),
  description: text("description").notNull().default(""),
  // Set only when this case was created via "Create case from this document"
  // on the upload/review screen -- traceability back to the source filing,
  // never required (a manually-created case leaves this null).
  sourceDocumentId: integer("source_document_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * One row per party (or advocate) attached to a case -- the "party
 * selection" surface: who's on which side, and who represents them.
 * `role` is deliberately broad enough to cover both civil (plaintiff/
 * defendant) and writ/criminal (petitioner/respondent, appellant) naming --
 * the UI picks the relevant subset based on legalCases.caseType, but the
 * column itself doesn't enforce that (a party record long outlives any one
 * case-type-driven label choice, and cases sometimes get re-typed).
 */
export const legalParties = pgTable("legal_parties", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id")
    .notNull()
    .references(() => legalCases.id),
  role: text("role").notNull(), // 'petitioner' | 'respondent' | 'plaintiff' | 'defendant' | 'appellant' | 'applicant' | 'opposite_party' | 'witness' | 'advocate' | 'third_party'
  name: text("name").notNull(),
  partyType: text("party_type").notNull().default("individual"), // 'individual' | 'organization' | 'government'
  contactInfo: jsonb("contact_info").notNull().default({}), // { address, phone, email }
  advocateName: text("advocate_name"), // this party's own representing advocate, if any -- distinct from a standalone role:'advocate' row (this app's own user acting as/with counsel)
  notes: text("notes").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * Catalog of forum/court TYPES a case can be recommended into -- reference
 * data (seeded, see db/seed/legal-forums.js), not per-user. Deliberately
 * models common Indian forums generically (by type and jurisdiction level),
 * not a directory of every physical court/bench -- pecuniary limits are
 * indicative (several vary by state amendment; see `notes`) and meant to
 * narrow a user's options, not substitute for verifying the current local
 * limit before filing. lib/legal/forumRecommend.js is the only reader that
 * scores against this table; legalCases.forumId just points at whichever
 * row the user ultimately picked.
 */
export const legalForums = pgTable(
  "legal_forums",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    forumType: text("forum_type").notNull(), // 'civil_court' | 'criminal_court' | 'high_court' | 'supreme_court' | 'consumer_forum' | 'family_court' | 'labour_court' | 'tribunal' | 'revenue_court' | 'arbitration' | 'police' | 'other'
    level: text("level").notNull(), // 'local' | 'district' | 'state' | 'national'
    description: text("description").notNull().default(""),
    pecuniaryMin: real("pecuniary_min"), // null = no floor
    pecuniaryMax: real("pecuniary_max"), // null = no ceiling
    subjectTags: text("subject_tags").array().notNull().default([]), // e.g. ['consumer','goods','service'] -- matched against legalCases.subjectMatter
    caseTypeTags: text("case_type_tags").array().notNull().default([]), // subset of legalCases.caseType values this forum actually handles
    appealsTo: text("appeals_to"), // free text, e.g. "State Consumer Disputes Redressal Commission"
    notes: text("notes").notNull().default(""), // caveats, e.g. "pecuniary limits vary by state notification -- verify current limit before filing"
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    // Lets db/seed/legal-forums.js (and app/api/setup) upsert-by-name safely
    // on every re-run, same "safe to revisit" pattern as the exam-prep seed
    // routes -- a forum's own catalog identity is its name, there's no other
    // natural key.
    nameUnique: unique("legal_forums_name_unique").on(table.name),
  })
);

/**
 * One row per uploaded document -- image or PDF, OCR'd and structured in a
 * single Gemini vision call (lib/legal/extractDocument.js) rather than the
 * exam-prep pipeline's separate text-extract-then-structure phases, since a
 * scanned legal document (the common case) has no text layer for pdf-parse
 * to find anyway. `caseId` is nullable: a document can be uploaded and
 * reviewed BEFORE a case exists (the normal flow -- see app/legal/upload),
 * then either attached to an existing case or used to create a new one via
 * legalCases.sourceDocumentId.
 */
export const legalDocuments = pgTable("legal_documents", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => authUsers.id),
  caseId: integer("case_id").references(() => legalCases.id),
  docType: text("doc_type").notNull().default("other"), // 'pleading' | 'evidence' | 'notice' | 'judgment' | 'order' | 'id_proof' | 'contract' | 'correspondence' | 'other'
  storagePath: text("storage_path").notNull(), // object key within the 'legal-documents' bucket
  originalFilename: text("original_filename").notNull(),
  fileMimeType: text("file_mime_type").notNull(), // 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp'
  fileSizeBytes: integer("file_size_bytes").notNull(),
  contentHash: text("content_hash").notNull(), // sha256 of the raw bytes -- exact-duplicate detection, same pattern as ingestUploads
  status: text("status").notNull().default("uploaded"), // 'uploaded' -> 'extracted' | 'error'
  // Best-effort OCR transcript, stored gzip-compressed (see
  // lib/db/compressedText.js) -- kept for the user to read/search, distinct
  // from extractedData's structured fields below.
  extractedText: compressedText("extracted_text"),
  // Structured extraction result, shaped per lib/legal/extractDocument.js:
  // { documentTitle, documentDate, caseNumberFound, courtFound, docTypeGuess,
  //   parties: [{name, role}], keyDates: [{label, date}],
  //   amounts: [{label, amount}], summary }. Empty object until extraction
  // succeeds; every field inside is AI-suggested and shown to the user to
  // review/edit before it feeds a new case, never written into legalCases
  // directly.
  extractedData: jsonb("extracted_data").notNull().default({}),
  errorMsg: text("error_msg"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  extractedAt: timestamp("extracted_at"),
});

/**
 * Hearing dates, filing/limitation deadlines, and other case-date tracking
 * -- the "tracking case dates" surface. `status` starts 'upcoming' and is
 * moved on by the user (completed/adjourned) or by a future reminder cron;
 * nothing here auto-computes limitation periods (that would need per-Act
 * rules well beyond this feature's scope) -- dates are user- or
 * draft-entered, this table just tracks and surfaces them.
 */
export const legalCaseEvents = pgTable("legal_case_events", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id")
    .notNull()
    .references(() => legalCases.id),
  eventType: text("event_type").notNull(), // 'hearing' | 'filing_deadline' | 'limitation_deadline' | 'order_pronounced' | 'reminder' | 'other'
  title: text("title").notNull(),
  eventDate: timestamp("event_date").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("upcoming"), // 'upcoming' | 'completed' | 'missed' | 'adjourned'
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * One row per drafted document (petition, notice, application, ...) for a
 * case -- `content` always holds the CURRENT text; every save that changes
 * it also appends a legalDraftVersions row first (see
 * app/api/legal/drafts/[id]/route.js), so `currentVersion` here is always
 * reproducible from that history. `generatedByAi` marks a draft whose
 * current content was last written by lib/legal/generateDraft.js rather
 * than hand-edited -- purely informational (e.g. a "review before filing"
 * banner), nothing branches on it.
 */
export const legalDrafts = pgTable("legal_drafts", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id")
    .notNull()
    .references(() => legalCases.id),
  draftType: text("draft_type").notNull(), // 'petition' | 'plaint' | 'written_statement' | 'affidavit' | 'legal_notice' | 'application' | 'reply' | 'appeal' | 'rejoinder' | 'other'
  title: text("title").notNull(),
  content: text("content").notNull().default(""),
  currentVersion: integer("current_version").notNull().default(1),
  status: text("status").notNull().default("draft"), // 'draft' | 'final'
  generatedByAi: boolean("generated_by_ai").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

/**
 * Append-only version history for legalDrafts -- one row per SAVED revision
 * (not every keystroke), written just before legalDrafts.content is
 * overwritten so version N's content is always what was live immediately
 * before version N+1 replaced it. `editSummary` is optional, user- or
 * AI-provided ("regenerated per court's format", "fixed respondent's
 * address").
 */
export const legalDraftVersions = pgTable("legal_draft_versions", {
  id: serial("id").primaryKey(),
  draftId: integer("draft_id")
    .notNull()
    .references(() => legalDrafts.id),
  versionNumber: integer("version_number").notNull(),
  content: text("content").notNull(),
  editSummary: text("edit_summary").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const weeklyPlanAdjustments = pgTable(
  "weekly_plan_adjustments",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id),
    weekIndex: integer("week_index").notNull(), // 0-based, floor(dayNumber / 7) -- the week this nudge applies to
    focusSubtopicIds: jsonb("focus_subtopic_ids").notNull().default([]), // string[], subset of subtopics.id
    extraRevisionSubtopicIds: jsonb("extra_revision_subtopic_ids").notNull().default([]), // string[], subset of subtopics.id
    note: text("note").notNull().default(""), // 1-2 sentence human-readable rationale, shown on /plan
    generatedAt: timestamp("generated_at").notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.weekIndex] }),
  })
);
