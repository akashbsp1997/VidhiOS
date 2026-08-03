"use client";

import { useEffect, useState } from "react";
import { dateForDayNumber } from "../../lib/adaptive/planEngine.js";
import { TRACKS } from "../../db/seed/placementQuiz.js";
import { syncForOffline } from "../../lib/offline/syncForOffline.js";

const DAY_TYPE_LABEL = { learn: "Learn", test: "Test", revise: "Revise" };
const DAY_TYPE_HINT = {
  learn: "New topics to complete today.",
  test: "Attempt adaptive practice covering what you learned this week.",
  revise: "Revisit your weakest topics learned so far.",
};
const TRACK_LABEL = { starting_out: "Starting Out", beginner: "Beginner", advanced: "Advanced", fastforward: "Fast Forward" };

function formatDate(planStartDate, day) {
  return dateForDayNumber(new Date(planStartDate), day).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

// Shows the student's current onboarding track and, once enough seeds have
// been earned (lib/gamification/missions.js's TRACK_SWITCH_SEEDS_THRESHOLD),
// a picker to self-select a different one (see app/api/player/track/route.js).
// Mirrors lib/gamification/missions.js's TRACK_SWITCH_SEEDS_THRESHOLD -- that
// module isn't safe to import client-side (it touches the DB), so the
// number is duplicated here; GET /api/missions doesn't currently surface the
// threshold itself since it's a fixed constant, not per-user state.
const TRACK_SWITCH_SEEDS_THRESHOLD = 200;

function TrackCard() {
  const [playerState, setPlayerState] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const load = () => {
    fetch("/api/missions")
      .then((r) => r.json())
      .then((d) => {
        if (!d.error) setPlayerState(d.playerState);
      });
  };
  useEffect(load, []);

  if (!playerState?.track) return null; // pre-E1 accounts / quiz never completed -- nothing to show

  const canSwitch = playerState.seeds >= TRACK_SWITCH_SEEDS_THRESHOLD;

  function changeTrack(track) {
    setSaving(true);
    setError(null);
    fetch("/api/player/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ track }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else load();
      })
      .catch((e) => setError(e.message))
      .finally(() => setSaving(false));
  }

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <span style={{ fontSize: 13 }}>
          🎯 Track: <b>{TRACK_LABEL[playerState.track] ?? playerState.track}</b> · 🌱 {playerState.seeds} seeds
        </span>
        {!canSwitch && (
          <span style={{ fontSize: 12, color: "var(--ink-soft)" }}>Earn 200 seeds to unlock changing tracks</span>
        )}
      </div>
      {canSwitch && (
        <div className="segmented" style={{ marginTop: 10 }}>
          {TRACKS.map((t) => (
            <button key={t} className={`seg${playerState.track === t ? " active" : ""}`} disabled={saving} onClick={() => changeTrack(t)}>
              {TRACK_LABEL[t]}
            </button>
          ))}
        </div>
      )}
      {error && <div className="error-box" style={{ marginTop: 8 }}>{error}</div>}
    </div>
  );
}

// Part E5's "game score" card for the fixed 7-day onboarding week --
// GET /api/onboarding/week-summary assembles it entirely from existing data
// (missions, attempts, mock tests), so this just renders whatever comes
// back. Renders nothing until the student both has a fixed week (a track
// was assigned) and has actually reached day 7.
function WeekOneSummaryCard() {
  const [summary, setSummary] = useState(null);

  useEffect(() => {
    fetch("/api/onboarding/week-summary")
      .then((r) => r.json())
      .then((d) => {
        if (!d.error) setSummary(d);
      });
  }, []);

  if (!summary?.hasFixedWeek || !summary.eligible) return null;

  return (
    <div className="card">
      <p style={{ fontWeight: 600, marginBottom: 8 }}>🏁 Week 1 complete!</p>
      <p className="lede" style={{ marginBottom: 8 }}>
        {summary.daysCompleted}/{summary.totalLearnDays} days answered · {summary.missionsCompleted} missions done ·{" "}
        🌱 {summary.seedsEarnedThisWeek} seeds earned this week ({summary.totalSeeds} total) · {summary.currentStreakDays}-day streak
        {summary.weeklyTestScorePct != null ? ` · weekly test: ${summary.weeklyTestScorePct}%` : ""}
      </p>
      <p style={{ fontSize: 12.5, color: "var(--ink-soft)", marginBottom: 0 }}>
        From here, your plan adapts weekly to how your real answers and tests go.
      </p>
    </div>
  );
}

// Manual trigger for lib/offline/syncForOffline.js's prefetch walker --
// bypasses its own throttle (the automatic mount-time sync in
// components/OfflineSupport.jsx only runs at most every 6h) since this is
// an explicit "sync right now" request. Hidden entirely unless
// NEXT_PUBLIC_OFFLINE_MODE_ENABLED is on, matching every other offline-mode
// UI piece in this app.
function SyncForOfflineButton() {
  const [syncing, setSyncing] = useState(false);
  const [resultMessage, setResultMessage] = useState(null); // null while idle/never run

  if (process.env.NEXT_PUBLIC_OFFLINE_MODE_ENABLED !== "true") return null;

  function runSync() {
    setSyncing(true);
    setResultMessage(null);
    syncForOffline()
      .then((count) => setResultMessage(count > 0 ? `Synced ${count} topic${count === 1 ? "" : "s"} for offline` : "Already up to date"))
      .catch(() => setResultMessage("Couldn't sync — try again once you have a connection"))
      .finally(() => setSyncing(false));
  }

  return (
    <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
      <span style={{ fontSize: 13 }}>
        📥 {resultMessage ?? "Preload your next 7 days' lessons and practice questions so they still work with no connection."}
      </span>
      <button className="btn" onClick={runSync} disabled={syncing}>
        {syncing ? "Syncing…" : "Sync for offline"}
      </button>
    </div>
  );
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

      <TrackCard />
      <WeekOneSummaryCard />
      <SyncForOfflineButton />

      {data.weeklyAdjustmentNote && (
        <div className="card">
          <p className="lede" style={{ marginBottom: 0, fontSize: 13 }}>
            🧭 Based on last week: {data.weeklyAdjustmentNote}
          </p>
        </div>
      )}

      <div className="card">
        {data.days.map((d) => (
          <div className="subtopic-row" key={d.day} style={{ gridTemplateColumns: "90px 70px 1fr", opacity: d.day < data.todayDayNumber ? 0.6 : 1 }}>
            <span className="subtopic-code">{formatDate(data.planStartDate, d.day)}</span>
            <span className={`day-type-pill day-type-${d.type}`}>
              {DAY_TYPE_LABEL[d.type]}
              {d.dayComplete === true ? " ✓" : ""}
            </span>
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
                    {t.answered === true && (
                      <span style={{ marginLeft: 8, fontSize: 11, color: "var(--forest)" }}>✓ answered</span>
                    )}
                    {t.answered === false && (
                      <a href={`/practice/${t.id}`} style={{ marginLeft: 8, fontSize: 11.5 }}>
                        Write your answer →
                      </a>
                    )}
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
