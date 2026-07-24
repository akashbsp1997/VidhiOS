"use client";

import { useEffect, useState } from "react";
import { dateForDayNumber } from "../../lib/adaptive/planEngine.js";

const DAY_TYPE_LABEL = { learn: "Learn", test: "Test", revise: "Revise" };
const DAY_TYPE_HINT = {
  learn: "New topics to complete today.",
  test: "Attempt adaptive practice covering what you learned this week.",
  revise: "Revisit your weakest topics learned so far.",
};

function formatDate(planStartDate, day) {
  return dateForDayNumber(new Date(planStartDate), day).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

// The day-wise 1-year tracker (Piece B of the "1-year strategy" request) --
// a computed, not AI-generated, schedule (see lib/adaptive/planEngine.js).
// Starts by showing a 2-week window around today; "Load more" extends it
// further rather than fetching a full year up front, since most visits only
// care about the near term.
export default function PlanPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [extraToDay, setExtraToDay] = useState(null);

  useEffect(() => {
    const params = extraToDay != null ? `?toDay=${extraToDay}` : "";
    fetch(`/api/plan${params}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else {
          setData(d);
          setError(null);
        }
      })
      .catch((e) => setError(e.message));
  }, [extraToDay]);

  if (error === "onboarding_not_complete") {
    return (
      <>
        <h1>Your 1-year plan</h1>
        <div className="card">
          <p className="lede" style={{ marginBottom: 10 }}>
            Set up your plan first — pick your 2 starting GS papers and your optional subject.
          </p>
          <a className="btn btn-primary" href="/onboarding">
            Get started →
          </a>
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <h1>Your 1-year plan</h1>
        <div className="error-box">{error}</div>
      </>
    );
  }

  if (!data) return <div className="loading">Loading…</div>;

  const progressPct = data.totalSubtopics ? Math.round((data.learnedSoFar / data.totalSubtopics) * 100) : 0;

  return (
    <>
      <h1>Your 1-year plan</h1>
      <p className="lede">
        Day {data.todayDayNumber + 1} of your plan · {data.learnedSoFar}/{data.totalSubtopics} topics learned so far (
        {progressPct}%) · currently scheduled through day {data.scheduledThroughDay + 1}. Computed from your real
        progress and content — not AI-generated, and it re-adjusts automatically as more GS papers unlock.
      </p>

      <div className="card">
        {data.days.map((d) => (
          <div className="subtopic-row" key={d.day} style={{ gridTemplateColumns: "90px 70px 1fr", opacity: d.day < data.todayDayNumber ? 0.6 : 1 }}>
            <span className="subtopic-code">{formatDate(data.planStartDate, d.day)}</span>
            <span className={`day-type-pill day-type-${d.type}`}>{DAY_TYPE_LABEL[d.type]}</span>
            <span className="subtopic-text">
              {d.topics.length === 0 ? (
                <span style={{ color: "var(--ink-soft)", fontSize: 12.5 }}>
                  {d.type === "learn" ? "Nothing new scheduled yet" : DAY_TYPE_HINT[d.type]}
                </span>
              ) : d.type === "test" ? (
                <>
                  <div style={{ fontSize: 12.5, color: "var(--ink-soft)", marginBottom: 2 }}>{DAY_TYPE_HINT.test}</div>
                  {d.topics.map((t) => t.topicText).join(" · ")} — <a href="/practice">Start practice →</a>
                </>
              ) : (
                d.topics.map((t) => (
                  <div key={t.id}>
                    <a href={`/learn/${t.id}`}>{t.topicText}</a>{" "}
                    <span style={{ fontSize: 11, color: "var(--ink-soft)" }}>
                      ({t.subjectDisplayName}
                      {t.totalSpanDays > 1 ? ` · day ${t.dayOfSpan} of ${t.totalSpanDays}` : ""})
                    </span>
                  </div>
                ))
              )}
            </span>
          </div>
        ))}
      </div>

      <button className="btn" onClick={() => setExtraToDay((data.days.at(-1)?.day ?? 0) + 14)}>
        Load next 2 weeks →
      </button>
    </>
  );
}
