"use client";

import { useEffect, useState, use } from "react";
import { bulletLines } from "../../../lib/text/bullets.js";

// "The database as if contents in a book" -- static chapters (this
// subtopic's Teach content, module by module, updated only when
// regenerated) followed by a living, continuously-growing current-affairs
// annex (every digest item ever tagged to this subtopic). See
// app/api/book/route.js's header for why this is a compiled view, not a
// separate stored copy.
export default function BookPage({ params }) {
  const { subtopicId } = use(params);
  const [book, setBook] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`/api/book?subtopicId=${encodeURIComponent(subtopicId)}`)
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setBook(d)))
      .catch((e) => setError(e.message));
  }, [subtopicId]);

  if (error) {
    return (
      <>
        <h1>Book</h1>
        <div className="error-box">{error}</div>
      </>
    );
  }

  if (!book) return <div className="loading">Opening the book…</div>;

  return (
    <>
      <p style={{ fontSize: 12.5, marginBottom: 12 }}>
        <a href={`/learn/${encodeURIComponent(subtopicId)}`}>← Back to studying this subtopic</a>
      </p>
      <h1>📖 {book.topicText}</h1>
      <p className="lede">{book.subjectDisplayName}</p>

      {book.chapters.length === 0 && (
        <div className="card">
          <p className="lede" style={{ marginBottom: 0 }}>
            No chapters written yet -- open this subtopic's Teach stage first.
          </p>
        </div>
      )}

      {book.chapters.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Contents</h2>
          {book.chapters.map((c, i) => (
            <p key={c.moduleId} style={{ fontSize: 13, margin: "3px 0" }}>
              <a href={`#chapter-${c.moduleId}`}>
                {i + 1}. {c.title}
              </a>
            </p>
          ))}
        </div>
      )}

      {book.chapters.map((c, i) => (
        <div className="card" id={`chapter-${c.moduleId}`} key={c.moduleId}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 6 }}>
            <h2 style={{ margin: 0 }}>
              Chapter {i + 1}: {c.title}
            </h2>
            {c.lastUpdated && (
              <span style={{ fontSize: 11, color: "var(--ink-soft)" }}>
                Last updated {new Date(c.lastUpdated).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
              </span>
            )}
          </div>
          <ul style={{ paddingLeft: 20, fontSize: 13.5, lineHeight: 1.7 }}>
            {bulletLines(c.teachContent).map((line, j) => (
              <li key={j}>{line}</li>
            ))}
          </ul>
          {c.keyPoints?.length > 0 && (
            <>
              <h3 style={{ fontSize: 13, marginBottom: 4 }}>Key points</h3>
              <ul style={{ paddingLeft: 20, fontSize: 12.5, color: "var(--ink-soft)" }}>
                {c.keyPoints.map((p, j) => (
                  <li key={j}>{p}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      ))}

      <div className="card" style={{ borderColor: "var(--accent-gold)" }}>
        <h2 style={{ marginTop: 0 }}>📰 Current Affairs Updates</h2>
        <p className="lede" style={{ marginBottom: 10 }}>
          Grows automatically every day -- every real news item ever tagged to this subtopic, newest first. The
          chapters above only change when regenerated; this section never needs to.
        </p>
        {book.currentAffairsUpdates.length === 0 && (
          <p className="section-hint">Nothing tagged to this subtopic yet -- check back as the daily digest runs.</p>
        )}
        {book.currentAffairsUpdates.map((u) => (
          <div key={u.id} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "var(--ink-soft)" }}>
              {new Date(u.publishedDate).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
              {u.sourceName && ` · ${u.sourceName}`}
            </div>
            <a href={u.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13.5, fontWeight: 600 }}>
              {u.title}
            </a>
            <p style={{ fontSize: 13, margin: "2px 0 0" }}>{u.summary}</p>
          </div>
        ))}
      </div>
    </>
  );
}
