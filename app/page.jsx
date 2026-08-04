"use client";

import { useEffect, useState } from "react";
import { isOptionalTile, isCompulsoryLanguageTile } from "../lib/subjects/papers.js";
import { dateForDayNumber } from "../lib/adaptive/planEngine.js";
import CollapsibleSection from "../components/CollapsibleSection.jsx";

// Home is deliberately minimal (explicit request: "show only this day's
// plan, this week's timeline, [and a] dashboard showing percentage of
// subtopic/topic/chapter/paper/prelims/mains/optional readiness -- and
// everything else intertwined with gaming interface"). It used to also
// carry the full syllabus-browsing tile grid and MissionsPanel; browsing a
// paper's actual subtopics now happens through app/papers/[subjectId]/
// [paper]'s Forest view (which this change also makes the default there),
// and MissionsPanel moved to /arena -- both are "the gaming interface" this
// page hands off to rather than duplicating. Subtopic-level readiness isn't
// flattened onto this page for the same reason: it's what the Forest canopy
// itself already shows (growth stage per subtopic), one click into any row
// below. Chapter/topic-level detail (the existing per-section heatmap)
// lives at /readiness rather than being re-fetched and duplicated here.
const DAY_TYPE_ICON = { learn: "📖", test: "📝", revise: "🔁" };
const DAY_TYPE_LABEL = { learn: "Learn", test: "Test", revise: "Revise" };

function groupTiles(tiles) {
  const groups = {};
  for (const t of tiles) {
    groups[t.group] = groups[t.group] || [];
    groups[t.group].push(t);
  }
  return groups;
}

/** subtopicCount-weighted average mastery across a set of tiles, or null if none have any content yet. */
function weightedAvgMastery(tiles) {
  const withContent = tiles.filter((t) => t.subtopicCount > 0);
  const totalCount = withContent.reduce((sum, t) => sum + t.subtopicCount, 0);
  if (!totalCount) return null;
  return withContent.reduce((sum, t) => sum + t.subtopicCount * (t.avgMasteryScore ?? 0), 0) / totalCount;
}

function RollupStat({ label, pct }) {
  return (
    <div>
      <div style={{ fontSize: 26, fontWeight: 700 }}>{pct == null ? "—" : `${Math.round(pct * 100)}%`}</div>
      <div style={{ fontSize: 12, color: "var(--ink-soft)" }}>{label}</div>
    </div>
  );
}

// One slim clickable percentage row -- the replacement for the old big
// descriptive paper-tile cards. `href` null renders a non-clickable row
// (locked/no destination yet).
function ReadinessRow({ href, label, badge, meta, pct }) {
  const inner = (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 2px", borderBottom: "1px solid var(--rule)" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {label}
          {badge}
        </div>
        {meta && <div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>{meta}</div>}
      </div>
      {pct != null && (
        <span className="bar" style={{ width: 64, flexShrink: 0 }}>
          <span style={{ width: `${Math.round(pct * 100)}%` }} />
        </span>
      )}
      <span style={{ fontSize: 12.5, fontWeight: 700, width: 34, textAlign: "right", flexShrink: 0, color: "var(--ink-soft)" }}>
        {pct == null ? "—" : `${Math.round(pct * 100)}%`}
      </span>
    </div>
  );
  return href ? <a href={href}>{inner}</a> : <div style={{ opacity: 0.6 }}>{inner}</div>;
}

export default function Home() {
  const [tiles, setTiles] = useState(null);
  const [onboardingComplete, setOnboardingComplete] = useState(true); // assume true until the fetch says otherwise, so the banner doesn't flash for an already-onboarded student
  const [error, setError] = useState(null);
  const [planData, setPlanData] = useState(null);
  const [lockdown, setLockdown] = useState(null);

  useEffect(() => {
    fetch("/api/papers")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else {
          setTiles(data.tiles);
          setOnboardingComplete(data.onboardingComplete);
          setLockdown(data.lockdown ?? null);
        }
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!onboardingComplete) return;
    fetch("/api/plan")
      .then((r) => r.json())
      .then((data) => {
        if (!data.error) setPlanData(data);
      })
      .catch(() => {});
  }, [onboardingComplete]);

  if (error) {
    return (
      <>
        <h1>VidhiOS Adaptive</h1>
        <div className="error-box">
          {error}
          <div style={{ marginTop: 8 }}>
            If this is a fresh deploy, visit <code>/api/setup?key=YOUR_SETUP_SECRET</code> first.
          </div>
        </div>
      </>
    );
  }

  if (!tiles) return <div className="loading">Loading…</div>;

  const withContent = tiles.filter((t) => t.subtopicCount > 0);
  const overallMastery = weightedAvgMastery(withContent);
  const prelimsMastery = weightedAvgMastery(tiles.filter((t) => t.group === "CSE Prelims"));
  const mainsMastery = weightedAvgMastery(tiles.filter((t) => t.group === "CSE Mains — Merit"));
  const optionalTiles = tiles.filter(isOptionalTile);
  const chosenOptionalTiles = optionalTiles.filter((t) => !t.subjectLocked);
  const optionalMastery = weightedAvgMastery(chosenOptionalTiles);
  const optionalSubtopicCount = chosenOptionalTiles.reduce((sum, t) => sum + t.subtopicCount, 0);

  const languageTiles = tiles.filter(isCompulsoryLanguageTile);
  const languageSubtopicCount = languageTiles.reduce((sum, t) => sum + t.subtopicCount, 0);

  const groups = groupTiles(tiles.filter((t) => !isOptionalTile(t) && !isCompulsoryLanguageTile(t)));

  const today = planData?.days.find((d) => d.day === planData.todayDayNumber) ?? null;
  const weekDays = planData ? planData.days.filter((d) => d.day >= planData.todayDayNumber && d.day <= planData.todayDayNumber + 6) : [];
  const planStart = planData ? new Date(planData.planStartDate) : null;

  return (
    <>
      <h1>Dashboard</h1>
      <p className="lede">Today's plan, this week, and where you stand — everything else lives in the Games menu.</p>

      {!onboardingComplete && (
        <div className="card" style={{ borderColor: "var(--brass)" }}>
          <h2 style={{ marginTop: 0 }}>Set up your 1-year plan</h2>
          <p className="lede" style={{ marginBottom: 10 }}>
            Pick 2 GS papers and 1 optional subject to start with — more GS papers unlock automatically as you make
            progress.
          </p>
          <a className="btn btn-primary" href="/onboarding">
            Get started →
          </a>
        </div>
      )}

      {lockdown && (
        <div className="card" style={{ borderColor: "var(--maroon)" }}>
          <h2 style={{ marginTop: 0 }}>Locked down — catch up on mastery first</h2>
          <p className="lede" style={{ marginBottom: 10 }}>
            You missed a plan checkpoint (day {lockdown.checkpointDay}) without reaching the mastery needed for your
            next GS subject. Teach, MCQs, mock tests, essays, and interview prep are paused — only adaptive practice
            stays open — until your average mastery on already-unlocked GS subjects climbs from{" "}
            {lockdown.currentMasteryPct}% back to {lockdown.requiredMasteryPct}%.
          </p>
          <a className="btn btn-primary" href="/practice">
            Start adaptive practice →
          </a>
        </div>
      )}

      {today && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <h2 style={{ margin: 0 }}>Today's plan</h2>
            <a href="/plan" style={{ fontSize: 12.5 }}>
              Full plan →
            </a>
          </div>
          {today.topics.length === 0 ? (
            <p className="lede" style={{ marginBottom: 0 }}>
              Nothing scheduled for today yet.
            </p>
          ) : today.type === "test" ? (
            <p className="lede" style={{ marginBottom: 0 }}>
              Test day — attempt adaptive practice covering {today.topics.map((t) => t.topicText).join(", ")}.{" "}
              <a href="/practice">Start practice →</a>
            </p>
          ) : (
            <p className="lede" style={{ marginBottom: 0 }}>
              {today.type === "revise" ? "Revise: " : "Learn: "}
              {today.topics.map((t, i) => (
                <span key={t.id}>
                  {i > 0 && ", "}
                  <a href={`/learn/${t.id}`}>{t.topicText}</a>
                </span>
              ))}
            </p>
          )}
        </div>
      )}

      {weekDays.length > 0 && (
        <div className="card">
          <h2 style={{ marginTop: 0, marginBottom: 10 }}>This week</h2>
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2 }}>
            {weekDays.map((d) => {
              const isToday = d.day === planData.todayDayNumber;
              return (
                <div
                  key={d.day}
                  style={{
                    flex: "0 0 auto",
                    minWidth: 70,
                    textAlign: "center",
                    padding: "8px 6px",
                    borderRadius: "var(--radius)",
                    background: isToday ? "var(--surface-2)" : "var(--surface)",
                    border: isToday ? "2px solid var(--primary)" : "1px solid var(--rule)",
                  }}
                  title={`${DAY_TYPE_LABEL[d.type] ?? d.type}${d.topics.length ? " — " + d.topics.map((t) => t.topicText).join(", ") : ""}`}
                >
                  <div style={{ fontSize: 11, color: "var(--ink-soft)" }}>
                    {dateForDayNumber(planStart, d.day).toLocaleDateString(undefined, { weekday: "short" })}
                  </div>
                  <div style={{ fontSize: 20, margin: "2px 0" }}>{DAY_TYPE_ICON[d.type] ?? "•"}</div>
                  <div style={{ fontSize: 10.5, fontWeight: 600 }}>{d.dayComplete ? "✅ Done" : d.topics.length ? `${d.topics.length} topic${d.topics.length === 1 ? "" : "s"}` : "—"}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Readiness</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 14, marginBottom: 14 }}>
          <RollupStat label="Overall" pct={overallMastery} />
          <RollupStat label="Prelims" pct={prelimsMastery} />
          <RollupStat label="Mains (GS + Essay)" pct={mainsMastery} />
          <RollupStat label="Optional" pct={optionalMastery} />
        </div>
        <p style={{ fontSize: 12, color: "var(--ink-soft)", marginBottom: 10 }}>
          Tap any paper below to open it — study there happens in Forest view by default.{" "}
          <a href="/readiness">Full breakdown by chapter, streak, weak areas →</a>
        </p>

        {Object.entries(groups).map(([group, items]) => (
          <div key={group} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em", color: "var(--ink-soft)", margin: "8px 0 2px" }}>
              {group}
            </div>
            {group === "CSE Mains — Qualifying" && (
              <ReadinessRow
                href="/papers/language"
                label="Paper A: Compulsory Indian Language"
                meta={`300 marks · ${languageSubtopicCount > 0 ? `${languageSubtopicCount} subtopics · ` : ""}choose a language`}
                pct={null}
              />
            )}
            {items.map((t) => {
              const badge = t.qualifying ? (
                <span className="qualifying-pill">Qualifying</span>
              ) : t.subjectLocked ? (
                <span className="subject-locked-pill">Locked</span>
              ) : null;
              if (t.subjectId === "prelims-gs") {
                return (
                  <ReadinessRow key={`${t.subjectId}-${t.paper}`} href="/prelims" label={t.label} meta="MCQ practice from your unlocked GS + optional subjects" pct={null} />
                );
              }
              if (t.subjectLocked) {
                return (
                  <ReadinessRow
                    key={`${t.subjectId}-${t.paper}`}
                    href={null}
                    label={t.label}
                    badge={badge}
                    meta={onboardingComplete ? "Unlocks with more progress" : "Set up your plan to unlock"}
                    pct={null}
                  />
                );
              }
              return (
                <ReadinessRow
                  key={`${t.subjectId}-${t.paper}`}
                  href={`/papers/${t.subjectId}/${t.paper}`}
                  label={t.label}
                  badge={badge}
                  meta={t.subtopicCount > 0 ? `${t.subtopicCount} subtopic${t.subtopicCount === 1 ? "" : "s"}` : "Coming soon"}
                  pct={t.subtopicCount > 0 ? t.avgMasteryScore ?? 0 : null}
                />
              );
            })}
          </div>
        ))}

        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em", color: "var(--ink-soft)", margin: "8px 0 2px" }}>
            CSE Mains — Merit — Optional Subject
          </div>
          <ReadinessRow
            href="/papers/optional"
            label="Paper VI & VII: Optional Subject"
            meta={optionalSubtopicCount > 0 ? `${optionalSubtopicCount} subtopics across your optional` : "Choose your optional subject"}
            pct={optionalSubtopicCount > 0 ? optionalMastery ?? 0 : null}
          />
        </div>
      </div>

      {/* Everything that isn't one of AppNav.jsx's 6 primary tabs, tucked
          away here instead of the topbar (per explicit request: "declutter
          the real estate," "tucked away neatly") -- nothing deleted, just
          not primary nav. Collapsed by default, same CollapsibleSection
          convention as the readiness groups above. */}
      <CollapsibleSection title="More" meta="Plan, readiness, quant, games, and more">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {[
            { href: "/plan", label: "Plan" },
            { href: "/readiness", label: "Readiness" },
            { href: "/results", label: "Results" },
            { href: "/guide", label: "Guide" },
            { href: "/ncert-chapters", label: "NCERT Chapters" },
            { href: "/quant", label: "Quant" },
            { href: "/prelims", label: "Prelims Arcade" },
            { href: "/mock-tests", label: "Mock tests" },
            { href: "/interview", label: "Interview" },
            { href: "/fill-blanks", label: "Fill the Blanks" },
            { href: "/flashcards", label: "Flashcards" },
            { href: "/arena", label: "Arena" },
            { href: "/alliances", label: "Alliances" },
            { href: "/map", label: "World Map" },
            { href: "/shop", label: "Seed Shop" },
          ].map((l) => (
            <a key={l.href} className="btn" href={l.href}>
              {l.label}
            </a>
          ))}
        </div>
      </CollapsibleSection>
    </>
  );
}
