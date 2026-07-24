"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import LockdownNotice from "./LockdownNotice.jsx";
import { offlineFetch } from "../lib/offline/offlineFetch.js";

const SIZE_LABEL = { sectional: "Sectional (5 questions, 45 min)", full: "Full paper (20 questions, 3 hours)" };

function formatClock(totalSeconds) {
  const s = Math.max(0, totalSeconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

// Timed, multi-question mock test -- a bundle of several questions
// completed as one sitting, in the tradition of an exam simulation (no
// feedback shown until the whole paper is submitted), then graded and
// reported as a whole. See app/api/mock-tests/* for why grading happens one
// question at a time even though the UI presents it as a single "Submit
// test" action -- spreads AI calls across separate requests so a
// 20-question full mock can't blow past a serverless function's time limit.
export default function MockTestFlow({ viewTestId }) {
  const [mode, setMode] = useState(viewTestId ? "report" : "start");
  const [subjects, setSubjects] = useState(null);
  const [history, setHistory] = useState(null);
  const [chosenSubject, setChosenSubject] = useState("");
  const [chosenSize, setChosenSize] = useState("sectional");
  const [startError, setStartError] = useState(null);
  const [startLockdown, setStartLockdown] = useState(null);
  const [starting, setStarting] = useState(false);

  const [test, setTest] = useState(null); // { mockTestId, subjectId, size, totalMarks, durationMinutes, questions }
  const [answers, setAnswers] = useState({}); // { [questionId]: text }
  const [current, setCurrent] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const timerRef = useRef(null);

  const [gradingProgress, setGradingProgress] = useState(null); // { done, total }
  const [report, setReport] = useState(null);
  const [reportError, setReportError] = useState(null);
  const [pendingTotalMarks, setPendingTotalMarks] = useState(null);
  // Saved to IndexedDB instead of reaching the server yet -- see
  // lib/offline/offlineFetch.js. Only ever true with offline mode on.
  const [finishQueued, setFinishQueued] = useState(false);

  useEffect(() => {
    if (mode !== "start") return;
    fetch("/api/papers")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) return;
        const bySubject = {};
        for (const t of data.tiles) {
          const cur = bySubject[t.subjectId] ?? { subjectId: t.subjectId, subtopicCount: 0, subjectLocked: t.subjectLocked };
          cur.subtopicCount += t.subtopicCount;
          cur.subjectLocked = cur.subjectLocked || t.subjectLocked;
          cur.label = t.group.replace(/^CSE Mains — (Merit — )?/, "").replace(/^Optional: /, "");
          bySubject[t.subjectId] = cur;
        }
        const available = Object.values(bySubject).filter((s) => s.subtopicCount > 0 && !s.subjectLocked);
        setSubjects(available);
        if (available.length && !chosenSubject) setChosenSubject(available[0].subjectId);
      });
    fetch("/api/mock-tests")
      .then((r) => r.json())
      .then((data) => {
        if (!data.error) setHistory(data.tests);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  function startTest() {
    setStarting(true);
    setStartError(null);
    setStartLockdown(null);
    fetch("/api/mock-tests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subjectId: chosenSubject, size: chosenSize }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error === "locked_down") {
          setStartLockdown(data);
          return;
        }
        if (data.error) {
          setStartError(data.error);
          return;
        }
        setTest(data);
        setAnswers({});
        setCurrent(0);
        setSecondsLeft(data.durationMinutes * 60);
        setMode("taking");
      })
      .catch((e) => setStartError(e.message))
      .finally(() => setStarting(false));
  }

  const submitTest = useCallback(() => {
    setMode("grading");
  }, []);

  useEffect(() => {
    if (mode !== "taking") return;
    timerRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(timerRef.current);
          submitTest();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [mode, submitTest]);

  // Grading phase: sequential, one question per request (see file header).
  useEffect(() => {
    if (mode !== "grading" || !test) return;
    let cancelled = false;
    async function run() {
      const toGrade = test.questions.filter((q) => (answers[q.id] || "").trim());
      for (let i = 0; i < toGrade.length; i++) {
        if (cancelled) return;
        setGradingProgress({ done: i, total: toGrade.length });
        await offlineFetch("/api/mock-tests/grade-question", {
          mockTestId: test.mockTestId,
          mockTestQuestionId: toGrade[i].id,
          answerText: answers[toGrade[i].id],
        }).catch(() => {});
      }
      if (cancelled) return;
      setGradingProgress({ done: toGrade.length, total: toGrade.length });
      // Answers were just SAVED above (grade-question no longer grades
      // inline -- see the 2026-07-24 overnight-batch-grading change), so
      // finish only closes the test out; totalScore isn't known yet, there's
      // nothing to fetch a report for until tonight's grading cron runs.
      const finishData = await offlineFetch("/api/mock-tests/finish", { mockTestId: test.mockTestId }).catch(() => ({}));
      if (cancelled) return;
      setPendingTotalMarks(finishData.totalMarks ?? null);
      setFinishQueued(!!finishData.queued);
      setMode("pending");
    }
    run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, test]);

  useEffect(() => {
    if (!viewTestId) return;
    fetch(`/api/mock-tests?id=${viewTestId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          setReportError(data.error);
          return;
        }
        // A submitted test whose grading cron hasn't run yet has
        // totalScore:null -- same "pending" treatment as a just-finished
        // test, not a broken report.
        if (data.totalScore == null) {
          setPendingTotalMarks(data.totalMarks);
          setMode("pending");
        } else {
          setReport(data);
        }
      });
  }, [viewTestId]);

  if (mode === "start") {
    return (
      <>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Start a mock test</h2>
          {subjects === null ? (
            <div className="loading">Loading…</div>
          ) : subjects.length === 0 ? (
            <p className="lede" style={{ marginBottom: 0 }}>
              No unlocked subject has content yet — check back once a paper has subtopics loaded.
            </p>
          ) : (
            <>
              <div className="segmented" style={{ marginBottom: 10 }}>
                {subjects.map((s) => (
                  <button key={s.subjectId} className={`seg${chosenSubject === s.subjectId ? " active" : ""}`} onClick={() => setChosenSubject(s.subjectId)}>
                    {s.label}
                  </button>
                ))}
              </div>
              <div className="segmented" style={{ marginBottom: 12 }}>
                {Object.entries(SIZE_LABEL).map(([key, label]) => (
                  <button key={key} className={`seg${chosenSize === key ? " active" : ""}`} onClick={() => setChosenSize(key)}>
                    {label}
                  </button>
                ))}
              </div>
              {startLockdown && (
                <div style={{ marginBottom: 10 }}>
                  <LockdownNotice lockdown={startLockdown} />
                </div>
              )}
              {startError && <div className="error-box" style={{ marginBottom: 10 }}>{startError}</div>}
              <button className="btn btn-primary" onClick={startTest} disabled={starting || !chosenSubject}>
                {starting ? "Building your paper…" : "Start test →"}
              </button>
              <p style={{ fontSize: 12, color: "var(--ink-soft)", marginTop: 10, marginBottom: 0 }}>
                Real PYQs where available, AI-generated where the paper needs more than your PYQ bank has. No
                feedback is shown until you submit the whole paper, same as the real exam.
              </p>
            </>
          )}
        </div>

        {history && history.length > 0 && (
          <div className="card">
            <h2>Your past mock tests</h2>
            {history.map((t) => (
              <div className="subtopic-row" key={t.id} style={{ gridTemplateColumns: "1fr auto auto" }}>
                <span className="subtopic-text">
                  {t.submittedAt ? (
                    <a href={`/mock-tests?view=${t.id}`}>
                      {t.subjectDisplayName} — {t.size}
                    </a>
                  ) : (
                    <>
                      {t.subjectDisplayName} — {t.size} (not submitted)
                    </>
                  )}
                </span>
                <span style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>{new Date(t.startedAt).toLocaleDateString()}</span>
                <span className="tier-pill">
                  {t.submittedAt ? (t.totalScore != null ? `${t.totalScore}/${t.totalMarks}` : "grading…") : "—"}
                </span>
              </div>
            ))}
          </div>
        )}
      </>
    );
  }

  if (mode === "taking" && test) {
    const q = test.questions[current];
    const answered = Object.values(answers).filter((a) => (a || "").trim()).length;
    return (
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div className="meta-line" style={{ marginBottom: 0 }}>
            Question {current + 1} of {test.questions.length} · {q.marks} marks · {answered} answered
          </div>
          <div style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: secondsLeft < 300 ? "var(--maroon)" : "var(--brass)" }}>
            {formatClock(secondsLeft)}
          </div>
        </div>

        <div className="question-text">{q.questionText}</div>

        <textarea
          className="answer-box"
          placeholder="Write your answer here…"
          value={answers[q.id] || ""}
          onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
        />

        <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
          <button className="btn" onClick={() => setCurrent((c) => Math.max(0, c - 1))} disabled={current === 0}>
            ← Previous
          </button>
          {current < test.questions.length - 1 ? (
            <button className="btn" onClick={() => setCurrent((c) => c + 1)}>
              Next →
            </button>
          ) : null}
          <button className="btn btn-primary" style={{ marginLeft: "auto" }} onClick={submitTest}>
            Submit test
          </button>
        </div>
      </div>
    );
  }

  if (mode === "grading") {
    return (
      <div className="card">
        <div className="loading">
          {gradingProgress ? `Grading ${gradingProgress.done}/${gradingProgress.total}…` : "Submitting…"}
        </div>
      </div>
    );
  }

  if (mode === "pending") {
    return (
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Test submitted</h2>
        <p className="lede" style={{ marginBottom: 0 }}>
          {finishQueued
            ? "✓ Saved on this device — you're offline, so your answers will sync automatically next time you have a connection, then get graded that night."
            : `✓ Saved${pendingTotalMarks != null ? ` — ${pendingTotalMarks} marks total` : ""}. Results are ready after tonight's grading run — check back tomorrow morning, or revisit this test from "Your past mock tests" below.`}
        </p>
        <a className="btn btn-primary" href="/mock-tests" style={{ marginTop: 12 }}>
          Back to mock tests →
        </a>
      </div>
    );
  }

  if (mode === "report") {
    if (reportError) return <div className="error-box">{reportError}</div>;
    if (!report) return <div className="loading">Loading report…</div>;
    return (
      <>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>
            {report.totalScore}/{report.totalMarks}
          </h2>
          <p className="lede" style={{ marginBottom: 0 }}>
            {report.size === "full" ? "Full paper" : "Sectional"} · {report.questions.length} questions
          </p>
        </div>
        {report.questions.map((q, i) => (
          <div className="card" key={q.id}>
            <div className="meta-line">
              Q{i + 1} · {q.subtopicText} · {q.marks} marks · {q.score ?? 0}/100
            </div>
            <div className="question-text">{q.questionText}</div>
            {q.answerText ? (
              <p style={{ fontSize: 13.5, whiteSpace: "pre-wrap" }}>{q.answerText}</p>
            ) : (
              <p style={{ fontSize: 13, color: "var(--ink-soft)" }}>Not answered.</p>
            )}
            {q.feedback?.verdict && <p style={{ fontSize: 13 }}>{q.feedback.verdict}</p>}
            {q.feedback?.weaknesses?.length > 0 && (
              <ul className="feedback-list weak">
                {q.feedback.weaknesses.map((w, wi) => (
                  <li key={wi}>{w}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
        <a className="btn btn-primary" href="/mock-tests">
          Start another test →
        </a>
      </>
    );
  }

  return null;
}
