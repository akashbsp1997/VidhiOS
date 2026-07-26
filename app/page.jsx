"use client";

import { useEffect, useState } from "react";
import { PAPER_TILES, isOptionalTile, isCompulsoryLanguageTile } from "../lib/subjects/papers.js";
import MissionsPanel from "../components/MissionsPanel.jsx";
import CollapsibleSection from "../components/CollapsibleSection.jsx";

// Groups PAPER_TILES' own static `group` field -- server order (this file's
// static array order) is preserved since JS objects preserve string-key
// insertion order, so the grid always renders Prelims -> Mains GS -> Essay ->
// Optionals in the same fixed sequence regardless of API response order.
function groupTiles(tiles) {
  const groups = {};
  for (const t of tiles) {
    groups[t.group] = groups[t.group] || [];
    groups[t.group].push(t);
  }
  return groups;
}

// This is now the top-level papers index -- the full real UPSC CSE exam
// structure (see lib/subjects/papers.js), not a flat subtopic list. A tile
// for a paper with no content yet is still clickable and still shows a
// "coming soon" page (app/papers/[subjectId]/[paper]/page.jsx) rather than
// being hidden or disabled -- explicit product choice, so the whole exam
// structure is visible now even though only Law Optional/GS2 have real
// content today.
export default function PapersIndex() {
  const [tiles, setTiles] = useState(null);
  const [onboardingComplete, setOnboardingComplete] = useState(true); // assume true until the fetch says otherwise, so the banner doesn't flash for an already-onboarded student
  const [error, setError] = useState(null);
  const [today, setToday] = useState(null);
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
        if (!data.error) setToday(data.days.find((d) => d.day === data.todayDayNumber) ?? null);
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

  if (!tiles) return <div className="loading">Loading papers…</div>;

  const withContent = tiles.filter((t) => t.subtopicCount > 0);
  const overallMastery = withContent.length
    ? withContent.reduce((sum, t) => sum + (t.avgMasteryScore ?? 0), 0) / withContent.length
    : 0;

  // Optional-subject paper tiles (Law/Literature Paper VI, VII) don't render
  // directly on this top-level grid -- clicking straight into "Paper VI"
  // without first knowing which optional subject it belongs to isn't
  // meaningful. Instead they're collapsed into one "Optional Subject" entry
  // point that goes to app/papers/optional/page.jsx (choose a subject), then
  // app/papers/optional/[subjectId]/page.jsx (both of that subject's papers,
  // per explicit request). The individual paper tiles from /api/papers are
  // still what those two pages render -- only this top-level grid excludes
  // them, so their real subtopicCount/mastery data isn't duplicated anywhere.
  const optionalTiles = tiles.filter(isOptionalTile);
  const optionalWithContent = optionalTiles.filter((t) => t.subtopicCount > 0);
  const optionalSubtopicCount = optionalTiles.reduce((sum, t) => sum + t.subtopicCount, 0);
  const optionalAvgMastery = optionalWithContent.length
    ? optionalWithContent.reduce((sum, t) => sum + t.subtopicCount * (t.avgMasteryScore ?? 0), 0) /
      optionalWithContent.reduce((sum, t) => sum + t.subtopicCount, 0)
    : null;

  // Same collapsing treatment as the optional-subject tiles above, for the
  // same reason: Paper A has 22 real language choices now (see
  // lib/subjects/papers.js), and clicking straight into "Paper A: Hindi"
  // without first choosing a language isn't meaningful. Collapsed into one
  // picker entry point (app/papers/language/page.jsx) instead, rendered
  // inline within the existing "CSE Mains — Qualifying" group below (Paper
  // B has no such choice, so it renders normally alongside it).
  const languageTiles = tiles.filter(isCompulsoryLanguageTile);
  const languageSubtopicCount = languageTiles.reduce((sum, t) => sum + t.subtopicCount, 0);

  const groups = groupTiles(tiles.filter((t) => !isOptionalTile(t) && !isCompulsoryLanguageTile(t)));

  return (
    <>
      <h1>Dashboard</h1>
      <p className="lede">
        Every UPSC CSE paper, in one place — {withContent.length} of {tiles.length} have content loaded so far
        (overall mastery {Math.round(overallMastery * 100)}%); the rest are marked "coming soon" until content is
        added. Click a paper to see its subtopics.
      </p>

      {!onboardingComplete && (
        <div className="card" style={{ borderColor: "var(--brass)" }}>
          <h2 style={{ marginTop: 0 }}>Set up your 1-year plan</h2>
          <p className="lede" style={{ marginBottom: 10 }}>
            Pick 2 GS papers and 1 optional subject to start with — more GS papers unlock automatically as you make
            progress. Everything else on this page stays locked until you do.
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

      {onboardingComplete && <MissionsPanel />}

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

      <div className="card">
        <a className="btn btn-primary" href="/practice">
          Start adaptive practice →
        </a>
        <span style={{ marginLeft: 12, fontSize: 13, color: "var(--ink-soft)" }}>
          one question at a time, across every paper with content, mixed by current weakness
        </span>
      </div>

      {Object.entries(groups).map(([group, items], i) => (
        <CollapsibleSection title={group} meta={`${items.length} paper${items.length === 1 ? "" : "s"}`} defaultOpen={i === 0} key={group}>
          <div className="paper-tile-grid">
            {group === "CSE Mains — Qualifying" && (
              <a className={`paper-tile${languageSubtopicCount === 0 ? " coming-soon" : ""}`} href="/papers/language">
                <div className="paper-tile-label">
                  Paper A: Compulsory Indian Language
                  <span className="qualifying-pill">Qualifying</span>
                </div>
                <div className="paper-tile-meta">
                  300 marks · {languageSubtopicCount > 0 ? `${languageSubtopicCount} subtopics · ` : ""}choose a language →
                </div>
              </a>
            )}
            {items.map((t) => {
              const tileLabel = (
                <div className="paper-tile-label">
                  {t.label}
                  {t.qualifying && <span className="qualifying-pill">Qualifying</span>}
                  {t.subjectLocked && <span className="subject-locked-pill">Locked</span>}
                </div>
              );
              // Prelims GS has no subtopic-chain content of its own to show
              // (Prelims draws on the same GS syllabus, tested objectively)
              // -- rather than a permanent "coming soon", link straight to
              // the MCQ practice mode that actually serves it.
              if (t.subjectId === "prelims-gs") {
                return (
                  <a key={`${t.subjectId}-${t.paper}`} className="paper-tile" href="/prelims">
                    {tileLabel}
                    <div className="paper-tile-meta">MCQ practice, drawn from your unlocked GS + optional subjects →</div>
                  </a>
                );
              }
              if (t.subjectLocked) {
                return (
                  <div className="paper-tile subject-locked" key={`${t.subjectId}-${t.paper}`}>
                    {tileLabel}
                    <div className="paper-tile-meta">
                      {t.marks ? `${t.marks} marks · ` : ""}
                      {onboardingComplete ? "Unlocks with more progress" : "Set up your plan to unlock"}
                    </div>
                  </div>
                );
              }
              return (
                <a
                  key={`${t.subjectId}-${t.paper}`}
                  className={`paper-tile${t.subtopicCount === 0 ? " coming-soon" : ""}`}
                  href={`/papers/${t.subjectId}/${t.paper}`}
                >
                  {tileLabel}
                  <div className="paper-tile-meta">
                    {t.marks ? `${t.marks} marks · ` : ""}
                    {t.subtopicCount > 0
                      ? `${t.subtopicCount} subtopic${t.subtopicCount === 1 ? "" : "s"} · ${Math.round((t.avgMasteryScore ?? 0) * 100)}% mastery`
                      : "Coming soon"}
                  </div>
                </a>
              );
            })}
          </div>
        </CollapsibleSection>
      ))}

      <div className="card">
        <h2>CSE Mains — Merit — Optional Subject</h2>
        <div className="paper-tile-grid">
          <a className={`paper-tile${optionalSubtopicCount === 0 ? " coming-soon" : ""}`} href="/papers/optional">
            <div className="paper-tile-label">Paper VI &amp; VII: Optional Subject</div>
            <div className="paper-tile-meta">
              {optionalSubtopicCount > 0
                ? `${optionalSubtopicCount} subtopics across your optional · ${Math.round((optionalAvgMastery ?? 0) * 100)}% mastery · choose a subject →`
                : "Choose your optional subject →"}
            </div>
          </a>
        </div>
      </div>
    </>
  );
}
