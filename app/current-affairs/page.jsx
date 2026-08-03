"use client";

import { useEffect, useState } from "react";

function groupByDate(items) {
  const groups = {};
  for (const it of items) (groups[it.publishedDate] ??= []).push(it);
  return Object.entries(groups).sort((a, b) => (a[0] < b[0] ? 1 : -1));
}

function monthOptions() {
  // Current month plus the 5 before it -- a digest older than that is
  // unlikely to still be exam-relevant, and keeps the picker short.
  const opts = [];
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const value = d.toISOString().slice(0, 7);
    const label = d.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });
    opts.push({ value, label });
  }
  return opts;
}

function MonthlyDigest() {
  const options = monthOptions();
  const [month, setMonth] = useState(options[0].value);
  const [digest, setDigest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setDigest(null);
    fetch(`/api/current-affairs/monthly?month=${month}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setDigest(data);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [month]);

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ margin: 0 }}>Monthly digest</h2>
        <select value={month} onChange={(e) => setMonth(e.target.value)} style={{ fontSize: 13 }}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {loading && <div className="loading">Building this month's overview…</div>}
      {error && <div className="error-box">{error}</div>}

      {digest && digest.itemCount === 0 && (
        <p className="lede" style={{ marginBottom: 0 }}>
          No daily digest items stored for this month yet — nothing to summarize.
        </p>
      )}

      {digest && digest.overview && (
        <>
          <p style={{ fontSize: 13.5, marginBottom: 12 }}>{digest.overview}</p>
          {digest.themes.map((t) => (
            <div key={t.theme} style={{ marginBottom: 12 }}>
              <h3 style={{ fontSize: 14, marginBottom: 4 }}>{t.theme}</h3>
              <ul style={{ paddingLeft: 20, fontSize: 13.5, lineHeight: 1.6, margin: 0 }}>
                {t.points.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          ))}
          <p style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 4, marginBottom: 0 }}>
            Synthesized from {digest.itemCount} daily items already tracked this month — not sourced from any
            external monthly compilation.
          </p>
        </>
      )}
    </div>
  );
}

export default function CurrentAffairsPage() {
  const [items, setItems] = useState(null);
  const [weekFocusNote, setWeekFocusNote] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch("/api/current-affairs?days=7")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else {
          setItems(data.items);
          setWeekFocusNote(data.weekFocusNote);
        }
      })
      .catch((e) => setError(e.message));
  }, []);

  if (error) {
    return (
      <>
        <h1>Current affairs</h1>
        <div className="error-box">{error}</div>
      </>
    );
  }

  if (!items) return <div className="loading">Loading…</div>;

  if (items.length === 0) {
    return (
      <>
        <h1>Current affairs</h1>
        <div className="card">
          <p className="lede" style={{ marginBottom: 0 }}>
            No digest items yet. This feature needs a free NewsData.io API key configured on the server (see
            README) — once set, a daily job fetches and summarizes India-focused news relevant to the syllabus.
          </p>
        </div>
      </>
    );
  }

  const grouped = groupByDate(items);

  return (
    <>
      <h1>Current affairs</h1>
      <p className="lede">
        Last 7 days, auto-summarized and tagged to real syllabus topics where relevant — a daily job, not something
        you need to check for updates on.
      </p>

      {weekFocusNote && (
        <div className="card" style={{ borderColor: "var(--accent-gold)" }}>
          <p style={{ fontSize: 13, margin: 0 }}>
            🎯 <b>This week's focus:</b> {weekFocusNote} Matching items below are marked and surfaced first.
          </p>
        </div>
      )}

      <MonthlyDigest />

      {grouped.map(([date, dayItems]) => (
        <div className="card" key={date}>
          <h2>{new Date(date).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</h2>
          {dayItems.map((it) => (
            <div key={it.id} style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 14.5, marginBottom: 2 }}>
                {it.relevantToThisWeek && <span title="Matches this week's focus">🎯 </span>}
                <a href={it.sourceUrl} target="_blank" rel="noreferrer">
                  {it.title}
                </a>
              </h3>
              {it.sourceName && <p style={{ fontSize: 11, color: "var(--ink-soft)", margin: "0 0 4px" }}>{it.sourceName}</p>}
              <p style={{ fontSize: 13.5, margin: "0 0 6px" }}>{it.summary}</p>
              {it.relatedTopics.length > 0 && (
                <div>
                  {it.relatedTopics.map((t) => (
                    <a key={t.id} href={`/learn/${t.id}`} className="qualifying-pill" style={{ marginRight: 6, textDecoration: "none" }}>
                      {t.topicText}
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
