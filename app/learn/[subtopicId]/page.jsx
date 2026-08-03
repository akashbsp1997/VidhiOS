"use client";

import { useEffect, useState, use } from "react";
import { useSearchParams } from "next/navigation";
import LegacyLearnFlow from "../../../components/LegacyLearnFlow.jsx";
import ModuleLearnFlow from "../../../components/ModuleLearnFlow.jsx";
import SubtopicNotes from "../../../components/SubtopicNotes.jsx";
import LockdownNotice from "../../../components/LockdownNotice.jsx";
import DragonChallenge from "../../../components/DragonChallenge.jsx";

async function safeFetchJson(url, options) {
  const res = await fetch(url, options);
  const raw = await res.text();
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Server returned a non-JSON response (HTTP ${res.status}): ${raw.slice(0, 300) || "(empty body)"}`);
  }
}

// Thin dispatcher: one /api/module-lesson fetch decides whether this
// subtopic is still on the pre-module-system flow (LegacyLearnFlow, backed
// by app/api/lesson + the `lessons` table) or the new per-module flow
// (ModuleLearnFlow, backed by app/api/module-lesson + `lesson_modules`).
// That first fetch's response is passed to ModuleLearnFlow as `initialData`
// rather than re-fetched, so its AI-call-triggering work (module planning,
// or module 1's Teach phase) only ever runs once.
export default function LearnPage({ params }) {
  const { subtopicId } = use(params);
  // Set when arriving via a "Study this as a module" link from
  // components/PracticeSession.jsx -- jumps straight to that module instead
  // of always starting at module 1. Read once at mount; a later change to
  // the URL bar won't re-trigger this (matches this page's existing
  // subtopicId-keyed remount model, not a live-reactive query param).
  const searchParams = useSearchParams();
  const initialModuleIndexParam = Number(searchParams.get("module"));
  const initialModuleIndex = Number.isInteger(initialModuleIndexParam) && initialModuleIndexParam >= 0 ? initialModuleIndexParam : 0;

  const [dispatch, setDispatch] = useState(null); // "legacy" | "module" | null (deciding)
  const [initialData, setInitialData] = useState(null);
  const [error, setError] = useState(null);
  const [lockdown, setLockdown] = useState(null);
  const [upgrading, setUpgrading] = useState(false);
  // The Dragon's Challenge (module flow only -- see components/
  // DragonChallenge.jsx) gates entry into ModuleLearnFlow until this
  // subtopic's one-time RPG intro question is submitted (not graded --
  // grading is overnight, see app/api/dragon-challenge). Reset alongside
  // everything else `decide()` resets, since this page instance persists
  // across a subtopicId change rather than remounting (see the existing
  // key={subtopicId} sub-components below).
  const [dragonAcknowledged, setDragonAcknowledged] = useState(false);

  function decide(upgrade = false) {
    setDragonAcknowledged(false);
    setError(null);
    setLockdown(null);
    if (!upgrade) setDispatch(null);
    const url = `/api/module-lesson?subtopicId=${encodeURIComponent(subtopicId)}&moduleIndex=${initialModuleIndex}&stage=teach${upgrade ? "&upgrade=true" : ""}`;
    safeFetchJson(url)
      .then((data) => {
        if (data.error === "locked_down") {
          setLockdown(data);
          return;
        }
        if (data.error === "locked") {
          setError(`This subtopic is locked — reach ${data.requiredMasteryPct}% mastery on ${data.requiredSubtopicText} first (currently ${data.currentMasteryPct}%).`);
          return;
        }
        if (data.error === "module_locked") {
          setError(`This module is locked — reach ${data.requiredMasteryPct}% mastery on this subtopic first (currently ${data.currentMasteryPct}%).`);
          return;
        }
        if (data.error === "stage_locked") {
          setError("That stage isn't unlocked yet — finish the earlier stages of this module first.");
          return;
        }
        if (data.error) {
          setError(data.error);
          return;
        }
        setInitialData(data);
        setDispatch(data.legacyAvailable ? "legacy" : "module");
      })
      .catch((e) => setError(e.message))
      .finally(() => setUpgrading(false));
  }

  useEffect(() => {
    decide();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtopicId]);

  function handleUpgrade() {
    setUpgrading(true);
    decide(true);
  }

  if (lockdown) return <LockdownNotice lockdown={lockdown} />;
  if (error) return <div className="error-box">{error}</div>;
  if (dispatch === null) return <div className="loading">{"Preparing this lesson… (first visit generates it, a few seconds)"}</div>;

  if (dispatch === "legacy") {
    return (
      <>
        <LegacyLearnFlow key={subtopicId} subtopicId={subtopicId} onUpgrade={handleUpgrade} upgrading={upgrading} />
        <SubtopicNotes key={`notes-${subtopicId}`} subtopicId={subtopicId} />
      </>
    );
  }

  if (!dragonAcknowledged) {
    return <DragonChallenge key={subtopicId} subtopicId={subtopicId} onDone={() => setDragonAcknowledged(true)} />;
  }

  return (
    <>
      <ModuleLearnFlow
        key={subtopicId}
        subtopicId={subtopicId}
        subjectDisplayName={initialData.subjectDisplayName}
        subtopicText={initialData.subtopicText}
        initialData={initialData}
        initialModuleIndex={initialModuleIndex}
      />
      <SubtopicNotes key={`notes-${subtopicId}`} subtopicId={subtopicId} />
    </>
  );
}
