"use client";

import { useEffect, useState, use } from "react";
import { findPaperTile, isOptionalTile, isCompulsoryLanguageTile } from "../../../../lib/subjects/papers.js";
import CollapsibleSection from "../../../../components/CollapsibleSection.jsx";

const STAGE_LABEL = { teach: "Teach", grasp: "Grasp", remember: "Remember", test: "Test" };
const SELF_STATUS_LABEL = { "not-started": "Not started", "in-progress": "In progress", done: "Done" };

// Bloom Knowledge Forest (lib/forest/growth.js's HEALTH_STATES) -- labels
// for the health dot's tooltip, same ids the API already returns.
const HEALTH_LABEL = { dormant: "Dormant", bare: "Bare branches", falling: "Falling leaves", yellow: "Yellow leaves", healthy: "Healthy" };

// How many upcoming locked subtopics stay visible (fading out) beyond the
// unlocked frontier, and how opaque each one is -- position 0 (right after
// the last unlocked subtopic) is the most visible, fading toward
// near-invisible by the edge of the window. Anything past this window isn't
// rendered at all. Tunable -- not something the request specified an exact
// number for, 3 is a reasonable "coming attractions" preview without
// spoiling the whole remaining chain.
const FADE_WINDOW = 3;
const FADE_OPACITIES = [0.55, 0.35, 0.18];

// Four tiers matching the explicit basics-to-advanced chronology: material a
// student meets at a lower school class is "Basics" (NCERT class 6-10-ish,
// see lib/adaptive/unlocks.js's NCERT_LEVEL_SCORE), material needing the
// senior-secondary NCERT ceiling (class 11-12) to explain is "Beginner",
// government/official sources push a subtopic to "Advanced", and
// current-affairs/external-vendor sources -- material with no single stable
// text, requiring independent synthesis -- push it to "Advanced Pro". Even
// quartiles across the blended (source + pyq-marks) 0-1 score, same
// "rough proxy, not a calibrated measure" caveat as this always had.
function difficultyLabel(score) {
  if (score < 0.25) return "Basics";
  if (score < 0.5) return "Beginner";
  if (score < 0.75) return "Advanced";
  return "Advanced Pro";
}

// A single-paper subject's (GS papers, Essay, both qualifying papers, both
// Prelims papers) tile label already IS the full paper name. The two-paper
// optional subjects (Law, Literature) carry "Paper VI/VII: Optional Paper
// 1/2" as their label -- already says "Optional", so this just prefixes the
// optional's own name (pulled from the tile's `group`, e.g.
// "CSE Mains — Merit — Optional: Law" -> "Law") without repeating the word.
// Fully static -- doesn't need the subtopics API response, so the heading is
// correct even before/without any data loading (the "coming soon" case).
function paperHeading(tile) {
  if (!tile) return null;
  const optionalMatch = tile.group.match(/Optional: (.+)$/);
  return optionalMatch ? `${optionalMatch[1]} — ${tile.label}` : tile.label;
}

export default function PaperSubtopicsPage({ params }) {
  const { subjectId, paper: paperParam } = use(params);
  const paper = Number(paperParam);
  const tile = findPaperTile(subjectId, paper);
  const heading = paperHeading(tile) ?? subjectId;

  const [subtopicsData, setSubtopicsData] = useState(null);
  const [error, setError] = useState(null);
  const [unlockPasses, setUnlockPasses] = useState([]);
  const [usingPassFor, setUsingPassFor] = useState(null);

  function loadSubtopics() {
    fetch(`/api/subtopics?subjectId=${encodeURIComponent(subjectId)}&paper=${paper}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setSubtopicsData(data.subtopics);
      })
      .catch((e) => setError(e.message));
  }

  useEffect(() => {
    setSubtopicsData(null);
    setError(null);
    loadSubtopics();
    fetch("/api/items")
      .then((r) => r.json())
      .then((data) => setUnlockPasses(data.usableItems?.filter((i) => i.itemType === "unlock_pass") ?? []))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectId, paper]);

  function useEarlyAccessPass(subtopicId) {
    if (!unlockPasses.length) return;
    setUsingPassFor(subtopicId);
    fetch("/api/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ itemId: unlockPasses[0].id, action: "use_unlock_pass", subtopicId }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (!data.error) {
          setUnlockPasses((prev) => prev.slice(1));
          loadSubtopics();
        }
      })
      .finally(() => setUsingPassFor(null));
  }

  // An optional-subject paper was reached via
  // app/papers/optional/[subjectId]/page.jsx -- back should return there
  // (both this subject's papers). A compulsory-language paper was reached
  // via app/papers/language/page.jsx -- back should return to the language
  // picker. Neither links from the top-level index directly anymore.
  const backHref = tile && isOptionalTile(tile) ? `/papers/optional/${subjectId}` : tile && isCompulsoryLanguageTile(tile) ? "/papers/language" : "/";
  const backLabel =
    tile && isOptionalTile(tile) ? "← Both papers for this optional" : tile && isCompulsoryLanguageTile(tile) ? "← Choose a different language" : "← All papers";
  const backLink = (
    <p style={{ fontSize: 12.5, marginBottom: 12 }}>
      <a href={backHref}>{backLabel}</a>
    </p>
  );

  if (error === "subject_locked") {
    return (
      <>
        {backLink}
        <h1>{heading}</h1>
        <div className="card">
          <h2>Locked</h2>
          <p className="lede" style={{ marginBottom: 10 }}>
            This subject isn't unlocked yet. GS papers unlock automatically as you make progress; your optional
            subject is fixed to the one you chose at setup.
          </p>
          <a className="btn btn-primary" href="/onboarding">
            View your plan →
          </a>
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        {backLink}
        <h1>{heading}</h1>
        <div className="error-box">{error}</div>
      </>
    );
  }

  if (!subtopicsData) return <div className="loading">Loading…</div>;

  if (subtopicsData.length === 0) {
    return (
      <>
        {backLink}
        <h1>{heading}</h1>
        <div className="card">
          <h2>Coming soon</h2>
          <p className="lede" style={{ marginBottom: 0 }}>
            This paper doesn't have subtopics loaded yet. Check back once content has been added.
          </p>
        </div>
      </>
    );
  }

  // CSAT quant is MCQ-only (db/schema.js's subjects.answerFormat) -- it has
  // no lessons/lesson_modules content and never goes through Teach/Grasp/
  // Remember/Test, so the generic subtopic list below (which links every
  // unlocked row to /learn/{id}) would send a click into a broken/
  // meaningless AI-generation flow for a topic this subject was never meant
  // to have. Point at the actual game instead of trying to force-fit the
  // generic list.
  if (subjectId === "prelims-csat") {
    return (
      <>
        {backLink}
        <h1>{heading}</h1>
        <p className="lede">
          {subtopicsData.length} topics — Number System, Percentage, Ratio, Time & Work, Data Interpretation and
          more (Class X level). Played as a puzzle-chain game rather than a Teach/Test flow: real MCQ practice,
          just no per-topic browsing here.
        </p>
        <div className="card">
          <a className="btn btn-primary" href="/quant">
            Play the Quant Puzzle Chain →
          </a>
        </div>
      </>
    );
  }

  const overallMastery = subtopicsData.reduce((sum, s) => sum + s.masteryScore, 0) / subtopicsData.length;

  // Only unlocked subtopics plus a small "preview" window of upcoming
  // locked ones are rendered at all -- everything further out stays fully
  // hidden until earlier subtopics are mastered, per explicit request
  // ("only a few of the first subtopics must be visible... locked
  // subtopics must slowly fade out"). Locking is effectively sequential
  // (each subtopic's lock depends on the immediately preceding one's
  // mastery -- see lib/adaptive/unlocks.js's computeSubtopicLocks), so the
  // first locked index is the one meaningful frontier: everything before it
  // is unlocked, everything from there on is locked in a chain. As earlier
  // subtopics get mastered, that frontier moves forward and previously
  // hidden ones enter the fade window, then become fully visible/unlocked --
  // no separate "reveal" mechanism needed, this is just re-derived from the
  // same server-computed lock state on every load.
  const firstLockedIndex = subtopicsData.findIndex((s) => s.locked);
  const visibleSubtopics = firstLockedIndex === -1 ? subtopicsData : subtopicsData.slice(0, firstLockedIndex + FADE_WINDOW);
  const hiddenCount = subtopicsData.length - visibleSubtopics.length;

  return (
    <>
      {backLink}
      <h1>{heading}</h1>
      <p className="lede">
        {subtopicsData.length} subtopics · overall mastery {Math.round(overallMastery * 100)}%. Ordered as a
        basics-to-advanced study path; weak, high-yield topics are still served most often in adaptive practice
        regardless of this order — nothing is ever fully benched.
      </p>

      {(() => {
        // Grouped by real syllabus section (already tracked per subtopic --
        // see db/schema.js's subtopics.section) into collapsible tree
        // sections, instead of one long flat list. The fade-window/locked
        // logic below is unchanged -- it's computed from `i`, this subtopic's
        // position in the FULL visibleSubtopics sequence, not its position
        // within its section, so basics-to-advanced ordering still holds
        // exactly as before, just visually bucketed.
        const sectionOrder = [];
        const bySection = new Map();
        visibleSubtopics.forEach((s, i) => {
          if (!bySection.has(s.section)) {
            bySection.set(s.section, []);
            sectionOrder.push(s.section);
          }

          const fadeStep = firstLockedIndex === -1 ? -1 : i - firstLockedIndex;
          const opacity = fadeStep >= 0 ? FADE_OPACITIES[Math.min(fadeStep, FADE_OPACITIES.length - 1)] : undefined;
          bySection.get(s.section).push(
            <div className={`subtopic-row${s.locked ? " locked" : ""}`} style={opacity != null ? { opacity } : undefined} key={s.id}>
              <span className="row-dots">
                <span
                  className={`self-status-dot self-status-${s.selfStatus}`}
                  title={`Your own status: ${SELF_STATUS_LABEL[s.selfStatus] ?? "Not started"} (separate from AI-graded mastery)`}
                />
                <span
                  className={`mastery-health-dot mastery-health-${s.health}`}
                  title={`Retention: ${HEALTH_LABEL[s.health] ?? s.health} -- fades over time since your last attempt, revisit to keep it up`}
                />
              </span>
              <span className="subtopic-code">{s.id}</span>
              <span className="subtopic-text">
                {s.locked ? <span>{s.topicText}</span> : <a href={`/learn/${s.id}`}>{s.topicText}</a>}
                <div className="subtopic-meta">
                  {s.locked ? (
                    <span className="locked-pill">
                      Locked — reach {s.requiredMasteryPct}% mastery on {s.requiredSubtopicText} first (
                      {s.currentMasteryPct}%/{s.requiredMasteryPct}%)
                      {unlockPasses.length > 0 && (
                        <button
                          className="btn"
                          style={{ marginLeft: 8, fontSize: 11, padding: "2px 8px" }}
                          disabled={usingPassFor === s.id}
                          onClick={() => useEarlyAccessPass(s.id)}
                        >
                          {usingPassFor === s.id ? "Using…" : "🎟 Use early access pass"}
                        </button>
                      )}
                    </span>
                  ) : (
                    <>
                      {s.section} · {s.pyqFrequency} PYQ appearance{s.pyqFrequency === 1 ? "" : "s"} · {s.attemptsCount}{" "}
                      attempted ·{" "}
                      <a href={`/sources/${s.id}`}>
                        {s.sourceCount} source{s.sourceCount === 1 ? "" : "s"}
                      </a>
                    </>
                  )}
                </div>
              </span>
              <span className="tier-pill" style={{ fontSize: 11 }}>
                {difficultyLabel(s.difficultyScore)}
              </span>
              <span className={`stage-pill stage-${s.stage}`}>{STAGE_LABEL[s.stage]}</span>
              <span className={`tier-pill${s.currentTier === 3 ? " t3" : ""}`}>tier {s.currentTier}</span>
              <span className="bar" title={`${Math.round(s.masteryScore * 100)}% mastery`}>
                <span style={{ width: `${Math.round(s.masteryScore * 100)}%` }} />
              </span>
            </div>
          );
        });

        return sectionOrder.map((section, idx) => (
          <CollapsibleSection title={section} meta={`${bySection.get(section).length} topic${bySection.get(section).length === 1 ? "" : "s"}`} defaultOpen={idx === 0} key={section}>
            {bySection.get(section)}
          </CollapsibleSection>
        ));
      })()}

      {hiddenCount > 0 && (
        <p className="section-hint" style={{ marginTop: 10 }}>
          +{hiddenCount} more subtopic{hiddenCount === 1 ? "" : "s"} — keep mastering the ones above to reveal them.
        </p>
      )}
    </>
  );
}
