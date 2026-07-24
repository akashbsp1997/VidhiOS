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
// drizzle-kit introspects and skips it since it already exists in Supabase.
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
  docType: text("doc_type").notNull(), // 'syllabus' | 'pyq_paper' | 'ncert_chapter' | 'newspaper_clipping'
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
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.subtopicId] }),
  })
);

/**
 * One row per user -- the account-wide gamification state layered on top of
 * per-subtopic mastery (that stays the real learning signal; this is the
 * game-feel layer on top of it). xp accumulates from daily missions
 * (see dailyMissionLog below) and never decreases. streak fields track
 * consecutive calendar days with at least one completed mission --
 * lastActivityDate ('YYYY-MM-DD', UTC) is the cheap way to tell "already
 * counted today" from "a new day, extend or reset the streak" without a
 * second query. lockdownGraceUntil is redeemed from a 'lockdown_grace' item
 * (see playerItems) -- while in the future, lib/adaptive/subjectUnlockState.js's
 * checkLockdown treats the student as not locked down regardless of the
 * real missed-checkpoint state.
 */
export const playerState = pgTable("player_state", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => authUsers.id),
  xp: integer("xp").notNull().default(0),
  currentStreakDays: integer("current_streak_days").notNull().default(0),
  longestStreakDays: integer("longest_streak_days").notNull().default(0),
  lastActivityDate: text("last_activity_date"), // 'YYYY-MM-DD', null before the first mission is ever completed
  lockdownGraceUntil: timestamp("lockdown_grace_until"),
  // 'starting_out' | 'beginner' | 'advanced' | 'fastforward' -- assigned by
  // the mandatory placement quiz at onboarding (see
  // db/seed/placementQuiz.js, app/api/onboarding/route.js), null before the
  // quiz is completed. Drives which fixed 7-day curriculum
  // (db/seed/onboardingWeekPlans.js) a new student sees for days 0-6. Can
  // change later via self-select once xp clears TRACK_SWITCH_XP_THRESHOLD
  // (app/api/onboarding/route.js) -- trackSetAt records when it was last set.
  track: text("track"),
  trackSetAt: timestamp("track_set_at"),
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
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    subtopicOrderUnique: unique("lesson_modules_subtopic_order_unique").on(table.subtopicId, table.orderIndex),
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
