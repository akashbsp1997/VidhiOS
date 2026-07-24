// lib/ingest/commit.js
//
// Commits one ingestItem's (approved) data to its live table -- the exact
// upsert idioms already used in app/api/setup/route.js, reused here rather
// than reinvented. Throws IngestCommitError on a validation problem (a
// missing field, a subtopic that doesn't exist yet); the caller
// (app/api/ingest/review/action) catches this and leaves reviewStatus
// "pending" with commitError set, so a bad commit is retryable rather than
// silently dropped.

import { eq, sql } from "drizzle-orm";
import { subtopics, pyqs, sources } from "../../db/schema.js";
import { getIngestDocTypeConfig } from "./config.js";
import { toStorageSentinel } from "./storageUrl.js";

class IngestCommitError extends Error {}

function requireFields(data, fields) {
  const missing = fields.filter((f) => data[f] === null || data[f] === undefined || data[f] === "");
  if (missing.length) {
    throw new IngestCommitError(`Missing required field(s) before this can be approved: ${missing.join(", ")}. Edit them and try again.`);
  }
}

async function commitSubtopic(db, item, upload) {
  const id = item.existingSubtopicId && !item.isNewSubtopic ? item.existingSubtopicId : item.suggestedId;
  requireFields({ id, paper: item.paper, section: item.section, topicText: item.topicText }, ["id", "paper", "section", "topicText"]);

  await db
    .insert(subtopics)
    .values({ id, subjectId: upload.subjectId, paper: item.paper, section: item.section, topicText: item.topicText })
    .onConflictDoUpdate({
      target: subtopics.id,
      set: { section: sql`excluded.section`, topicText: sql`excluded.topic_text`, paper: sql`excluded.paper` },
    });

  return { committedTable: "subtopics", committedId: id };
}

async function commitPyq(db, item, upload) {
  const topics = item.matchedTopics?.length ? item.matchedTopics : item.newTopicSuggestion ? [item.newTopicSuggestion] : null;
  requireFields(
    {
      id: item.suggestedId,
      year: item.year,
      paper: item.paper,
      slot: item.slot,
      sec: item.sec,
      sub: item.sub,
      marks: item.marks,
      questionText: item.questionText,
      topics,
    },
    ["id", "year", "paper", "slot", "sec", "sub", "marks", "questionText", "topics"]
  );

  await db
    .insert(pyqs)
    .values({
      id: item.suggestedId,
      subjectId: upload.subjectId,
      paper: item.paper,
      year: item.year,
      slot: item.slot,
      sec: item.sec,
      sub: item.sub,
      marks: item.marks,
      topics,
      questionText: item.questionText,
    })
    .onConflictDoNothing({ target: pyqs.id });

  return { committedTable: "pyqs", committedId: item.suggestedId };
}

async function commitSource(db, item, upload) {
  // Checked before requireFields, with a tailored message -- this is the
  // single most common reason a source item can't be approved: the AI
  // found no existing subtopic that fits (item.newSubtopicSuggestion is set
  // instead of matchedSubtopicId), and sources.subtopicId is a real FK that
  // can't point at a subtopic that doesn't exist. The generic "missing
  // required field: subtopicId" message this used to fall through to said
  // nothing about WHY or what to do -- found live, this was confusing.
  if (!item.matchedSubtopicId) {
    const suggestion = item.newSubtopicSuggestion ? ` The AI's suggestion for a new one: "${item.newSubtopicSuggestion}".` : "";
    throw new IngestCommitError(
      `This excerpt isn't matched to an existing subtopic, so it can't be attached to one yet.${suggestion} Either edit "Matched subtopic id" above to a real existing subtopic id, or create that subtopic first (approve a "syllabus" item for it, or add it another way) and then come back and point this item at the new id.`
    );
  }
  requireFields({ excerptText: item.excerptText }, ["excerptText"]);

  const [subtopicRow] = await db.select({ id: subtopics.id }).from(subtopics).where(eq(subtopics.id, item.matchedSubtopicId));
  if (!subtopicRow) {
    throw new IngestCommitError(
      `matchedSubtopicId "${item.matchedSubtopicId}" doesn't exist yet -- approve/create that subtopic first (e.g. via a syllabus upload), or edit this item to a real existing subtopic id.`
    );
  }

  const config = getIngestDocTypeConfig(upload.docType);
  const existing = await db.select({ id: sources.id, title: sources.title }).from(sources).where(eq(sources.subtopicId, item.matchedSubtopicId));
  const titleMatch = existing.find((s) => s.title.trim().toLowerCase() === (item.title || "").trim().toLowerCase());

  // ncertClass (6-12), when the AI found it stated in the document and the
  // operator verified it, is the precise signal lib/adaptive/unlocks.js's
  // sourceScore prefers -- ncertLevel is derived from it here so older code
  // reading only the coarser bucket still works, matching what drizzle/0011's
  // backfill already set for every pre-existing NCERT source. A class
  // outside 6-12 (bad AI output the operator didn't catch) is clamped rather
  // than trusted verbatim -- the scoring function assumes this range.
  let ncertClass = null;
  let ncertLevel = null;
  if (config.sourceTier === "ncert") {
    if (Number.isFinite(item.ncertClass)) {
      ncertClass = Math.min(12, Math.max(6, Math.round(item.ncertClass)));
      ncertLevel = ncertClass <= 8 ? "foundational" : ncertClass <= 10 ? "middle" : "senior";
    } else {
      ncertLevel = "senior";
    }
  }

  const [row] = await db
    .insert(sources)
    .values({
      subtopicId: item.matchedSubtopicId,
      title: item.title || "Untitled",
      url: toStorageSentinel(upload.storagePath),
      sourceType: item.sourceType || "other",
      sourceTier: config.sourceTier,
      ncertClass,
      ncertLevel,
      ncertBook: config.sourceTier === "ncert" && typeof item.bookName === "string" ? item.bookName : null,
      ncertChapter: config.sourceTier === "ncert" && typeof item.chapterName === "string" ? item.chapterName : null,
      ncertSubject: config.sourceTier === "ncert" && typeof item.ncertSubject === "string" ? item.ncertSubject : null,
      // Tied to sourceTier, not a hardcoded docType list, so a future
      // docType mapped to "ncert" or "official" (see lib/ingest/config.js)
      // picks this up automatically.
      official: config.sourceTier === "ncert" || config.sourceTier === "official",
      storageUploadId: upload.id,
      extractedText: item.excerptText,
      fetchedAt: new Date(),
      status: "ok",
    })
    .returning({ id: sources.id });

  return {
    committedTable: "sources",
    committedId: String(row.id),
    warning: titleMatch
      ? `A source titled "${titleMatch.title}" already exists for this subtopic (id ${titleMatch.id}) -- check this isn't a near-duplicate.`
      : undefined,
  };
}

const COMMITTERS = { subtopic: commitSubtopic, pyq: commitPyq, source: commitSource };

/**
 * `item` is an ingestItems row; `upload` is its parent ingestUploads row.
 * Commits finalData (falling back to suggestedData if never edited).
 */
export async function commitIngestItem(db, item, upload) {
  const committer = COMMITTERS[item.itemType];
  if (!committer) throw new IngestCommitError(`Unknown itemType "${item.itemType}"`);
  const data = item.finalData ?? item.suggestedData;
  return committer(db, data, upload);
}

export { IngestCommitError };
