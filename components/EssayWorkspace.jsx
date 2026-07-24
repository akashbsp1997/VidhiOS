"use client";

import { useEffect, useState } from "react";
import LockdownNotice from "./LockdownNotice.jsx";
import { offlineFetch } from "../lib/offline/offlineFetch.js";

function wordCount(text) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

// The Essay paper's own workspace -- browse/pick a topic (real past-year
// UPSC topics and coaching-guidance practice topics, always visibly
// distinguished, never conflated), optionally view an AI planning guide
// (generated once per topic, never a ready-made essay), write a full essay,
// and get it graded holistically. See app/api/essay-* for why this is
// entirely separate from the subtopic-based Teach/Practice/Test pipeline.
export default function EssayWorkspace() {
  const [mode, setMode] = useState("browse"); // 'browse' | 'write' | 'pending' | 'result'
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [lockdown, setLockdown] = useState(null);

  const [topic, setTopic] = useState(null);
  const [guide, setGuide] = useState(null);
  const [guideLoading, setGuideLoading] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  const [essayText, setEssayText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  // Saved to IndexedDB instead of reaching the server yet -- see
  // lib/offline/offlineFetch.js. Only ever true with offline mode on.
  const [queued, setQueued] = useState(false);

  useEffect(() => {
    if (mode !== "browse") return;
    fetch("/api/essay-topics")
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setData(d)))
      .catch((e) => setError(e.message));
  }, [mode]);

  function pickTopic(t) {
    setTopic(t);
    setGuide(null);
    setShowGuide(false);
    setEssayText("");
    setResult(null);
    setQueued(false);
    setMode("write");
  }

  function pickRandom() {
    fetch("/api/essay-topics?random=true")
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : pickTopic(d.topic)))
      .catch((e) => setError(e.message));
  }

  function loadGuide() {
    if (guide) {
      setShowGuide((s) => !s);
      return;
    }
    setGuideLoading(true);
    fetch(`/api/essay-guide?topicId=${encodeURIComponent(topic.id)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error === "locked_down") setLockdown(d);
        else if (!d.error) {
          setGuide(d);
          setShowGuide(true);
        }
      })
      .finally(() => setGuideLoading(false));
  }

  function submitEssay() {
    setSubmitting(true);
    offlineFetch("/api/essay-attempt", { topicId: topic.id, essayText })
      .then((d) => {
        if (d.error === "locked_down") setLockdown(d);
        else if (d.error) setError(d.error);
        // Grading is deferred to the nightly batch by default (see the
        // 2026-07-24 overnight-batch-grading change) -- d.feedback only
        // comes back if this ever sends gradeNow:true, which it doesn't
        // today (that's reserved for components/EssayTournament.jsx).
        else if (d.pending || d.queued) {
          setQueued(!!d.queued);
          setMode("pending");
        } else {
          setResult(d.feedback);
          setMode("result");
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setSubmitting(false));
  }

  if (lockdown) return <LockdownNotice lockdown={lockdown} />;
  if (error) return <div className="error-box">{error}</div>;

  if (mode === "browse") {
    if (!data) return <div className="loading">Loading…</div>;
    return (
      <>
        <div className="card">
          <p className="lede" style={{ marginBottom: 10 }}>
            {data.totalTopics} topics — real past-year UPSC essay topics (1993–2025) and coaching-guidance
            practice topics, always labeled which is which.
          </p>
          <button className="btn btn-primary" onClick={pickRandom}>
            Pick a random topic →
          </button>
        </div>
        {data.categories.map((cat) => (
          <div className="card" key={cat.category}>
            <h2>{cat.category}</h2>
            {cat.topics.map((t) => (
              <div className="subtopic-row" key={t.id} style={{ gridTemplateColumns: "1fr auto" }}>
                <span className="subtopic-text">
                  <a href="#" onClick={(e) => { e.preventDefault(); pickTopic(t); }}>
                    {t.topicText}
                  </a>
                </span>
                <span className="qualifying-pill">{t.source === "pyq" ? `PYQ ${t.year}` : "Practice"}</span>
              </div>
            ))}
          </div>
        ))}
      </>
    );
  }

  if (mode === "write" && topic) {
    const words = wordCount(essayText);
    return (
      <>
        <p style={{ fontSize: 12.5, marginBottom: 12 }}>
          <a href="#" onClick={(e) => { e.preventDefault(); setMode("browse"); }}>
            ← Choose a different topic
          </a>
        </p>
        <div className="card">
          <div className="meta-line">
            {topic.category} · {topic.source === "pyq" ? `Real UPSC topic, ${topic.year}` : "Practice topic (not a real past paper)"}
          </div>
          <div className="question-text">{topic.topicText}</div>

          <button className="btn" onClick={loadGuide} disabled={guideLoading} style={{ marginTop: 10 }}>
            {guideLoading ? "Loading guide…" : showGuide ? "Hide planning guide" : "View planning guide"}
          </button>

          {showGuide && guide && (
            <div style={{ marginTop: 12, padding: "10px 14px", background: "var(--ivory-2)", borderRadius: 8, fontSize: 13.5 }}>
              <p>{guide.approachNotes}</p>
              {guide.keyDimensions.length > 0 && (
                <>
                  <strong>Angles to consider</strong>
                  <ul>
                    {guide.keyDimensions.map((d, i) => (
                      <li key={i}>
                        <b>{d.dimension}:</b> {d.points}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {guide.sampleOutline?.body?.length > 0 && (
                <>
                  <strong>Sample outline</strong>
                  <ul>
                    {guide.sampleOutline.intro && <li>Intro: {guide.sampleOutline.intro}</li>}
                    {guide.sampleOutline.body.map((b, i) => (
                      <li key={i}>Body: {b}</li>
                    ))}
                    {guide.sampleOutline.conclusion && <li>Conclusion: {guide.sampleOutline.conclusion}</li>}
                  </ul>
                </>
              )}
            </div>
          )}

          <textarea
            className="answer-box"
            placeholder="Write your full essay here — aim for 1000-1200 words…"
            value={essayText}
            onChange={(e) => setEssayText(e.target.value)}
            style={{ minHeight: 320, marginTop: 14 }}
          />
          <p style={{ fontSize: 12, color: "var(--ink-soft)" }}>{words} words</p>

          <button className="btn btn-primary" onClick={submitEssay} disabled={submitting || !essayText.trim()}>
            {submitting ? "Saving…" : "Submit essay"}
          </button>
        </div>
      </>
    );
  }

  if (mode === "pending") {
    return (
      <div className="card">
        <p className="lede" style={{ marginBottom: 12 }}>
          {queued
            ? "✓ Saved on this device — you're offline, so it'll sync automatically next time you have a connection, then get graded that night."
            : "✓ Saved — you'll get your score and feedback after tonight's grading run."}
        </p>
        <button className="btn btn-primary" onClick={() => setMode("browse")}>
          Choose another topic →
        </button>
      </div>
    );
  }

  if (mode === "result" && result) {
    return (
      <div className="card">
        <div className="feedback-score">{result.score}/100</div>
        <p>{result.verdict}</p>

        {result.strengths?.length > 0 && (
          <>
            <strong>Strengths</strong>
            <ul className="feedback-list strong">
              {result.strengths.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </>
        )}
        {result.weaknesses?.length > 0 && (
          <>
            <strong>Weaknesses</strong>
            <ul className="feedback-list weak">
              {result.weaknesses.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </>
        )}
        {result.missingDimensions?.length > 0 && (
          <>
            <strong>Angles you could have covered</strong>
            <ul className="feedback-list">
              {result.missingDimensions.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </>
        )}

        <button className="btn btn-primary" onClick={() => setMode("browse")} style={{ marginTop: 10 }}>
          Choose another topic →
        </button>

        <div className="disclaimer">
          AI-graded feedback can be wrong, especially on multi-dimensionality judgment calls — treat it as a
          practice aid, not an authoritative UPSC score.
        </div>
      </div>
    );
  }

  return null;
}
