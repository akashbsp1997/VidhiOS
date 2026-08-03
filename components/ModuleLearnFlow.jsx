"use client";

import { useEffect, useState } from "react";
import ModuleTestPanel from "./ModuleTestPanel.jsx";
import LockdownNotice from "./LockdownNotice.jsx";
import StoryMode from "./StoryMode.jsx";
import LevelMap from "./LevelMap.jsx";
import LootCrates from "./LootCrates.jsx";
import EvidenceBoard from "./EvidenceBoard.jsx";
import TimeSceneChallenge from "./TimeSceneChallenge.jsx";
import { isStageUnlocked } from "../lib/adaptive/unlocks.js";
import { bulletLines } from "../lib/text/bullets.js";

const MAX_STAGE_FETCH_ITERATIONS = 5;

async function safeFetchJson(url, options) {
  const res = await fetch(url, options);
  const raw = await res.text();
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Server returned a non-JSON response (HTTP ${res.status}): ${raw.slice(0, 300) || "(empty body)"}`);
  }
}

// Reused verbatim from the pre-module design (app/api/lesson's StageModules)
// -- a stepper for whatever panels the CURRENT stage of the CURRENT module
// has. Module content is deliberately lighter than the legacy flow's
// (see lib/ai/generateModules.js), so there are fewer/smaller panels per
// stage here, but the component itself needed no changes.
function StageModules({ modules, panelIndex, setPanelIndex, onComplete, completeLabel }) {
  if (modules.length === 0) return null;
  const index = Math.min(panelIndex, modules.length - 1);
  const current = modules[index];
  const isLast = index === modules.length - 1;

  return (
    <>
      <div className="module-progress" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 12.5, color: "var(--ink-soft)" }}>
          {current.label} · {index + 1} of {modules.length}
        </span>
        <div style={{ display: "flex", gap: 4 }}>
          {modules.map((m, i) => (
            <span
              key={m.key}
              style={{ width: 6, height: 6, borderRadius: "50%", background: i === index ? "var(--ink)" : "var(--rule)" }}
            />
          ))}
        </div>
      </div>

      {current.node}

      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        {index > 0 && (
          <button className="btn" onClick={() => setPanelIndex(index - 1)}>
            ← Back
          </button>
        )}
        {!isLast ? (
          <button className="btn btn-primary" onClick={() => setPanelIndex(index + 1)}>
            Next: {modules[index + 1].label} →
          </button>
        ) : (
          <button className="btn btn-primary" onClick={onComplete}>
            {completeLabel}
          </button>
        )}
      </div>
    </>
  );
}

// Fallback for the rare case an AI phase legitimately returns no usable
// panels (e.g. a module's practice call produced neither examples nor
// exercises) -- without this, StageModules renders null and the student
// has no button to advance past that stage.
function EmptyStageFallback({ note, onComplete, completeLabel }) {
  return (
    <>
      <p className="section-hint">{note}</p>
      <button className="btn btn-primary" onClick={onComplete} style={{ marginTop: 10 }}>
        {completeLabel}
      </button>
    </>
  );
}

const MODULE_STAGES = [
  { key: "teach", label: "Teach" },
  { key: "grasp", label: "Grasp" },
  { key: "remember", label: "Remember" },
  { key: "test", label: "Test" },
];

function lockReasonLabel(reason) {
  if (reason === "previous_test_not_attempted") return "Attempt the previous module's Test first";
  // Mastery only updates once a day now (see the 2026-07-24 overnight-batch-
  // grading change) -- a student who just submitted a Test today won't see
  // this clear until after tonight's grading run, not immediately.
  if (reason === "mastery_below_threshold") return "Raise this subtopic's mastery to unlock (updates after tonight's grading)";
  return "Locked";
}

// The new per-module design: a subtopic is a SEQUENCE of modules, and each
// module runs its own independent Teach -> Grasp -> Remember -> Test cycle
// before advancing to the next one, rather than one cycle covering the
// whole subtopic (that's LegacyLearnFlow.jsx). `initialData` is the
// dispatcher's (app/learn/[subtopicId]/page.jsx) own first
// /api/module-lesson fetch -- seeded here instead of re-fetched, so the
// dispatcher's AI-call-triggering request (module planning, or module 1's
// Teach phase) isn't wastefully repeated. The dispatcher mounts this with
// key={subtopicId}, so a subtopic change always gives a fresh instance --
// the useState(initialData) seeding below only needs to handle first mount,
// never a prop change on an existing instance.
export default function ModuleLearnFlow({ subtopicId, subjectDisplayName, subtopicText, initialData, initialModuleIndex = 0 }) {
  const [modules, setModules] = useState(initialData.modules || []);
  const [moduleIndex, setModuleIndex] = useState(initialModuleIndex);
  const [moduleContent, setModuleContent] = useState(initialData);
  const [stage, setStage] = useState("teach");
  const [panelIndex, setPanelIndex] = useState(0);
  const [loadingStage, setLoadingStage] = useState(null);
  const [error, setError] = useState(null);
  const [lockdown, setLockdown] = useState(null);
  const [allModulesComplete, setAllModulesComplete] = useState(Boolean(initialData.allModulesComplete));
  // Sequential-completion high-water mark for the CURRENT module (see
  // lib/adaptive/unlocks.js's STAGE_ORDER) -- the server includes this in
  // every /api/module-lesson response; only a stage's own Continue button
  // (action:"advance") ever moves it forward, a tab click never does.
  const [unlockedStage, setUnlockedStage] = useState(initialData.unlockedStage || "teach");
  // Remember-stage minigames -- 'story' | 'crates' | 'evidence' | 'scene' | null.
  // Only one open at a time; all four are optional enrichment, none gate
  // progression (see each component's own header comment).
  const [activeMinigame, setActiveMinigame] = useState(null);

  useEffect(() => {
    setActiveMinigame(null);
  }, [moduleIndex]);

  // Picks up where the dispatcher's own fetch left off, if it wasn't
  // immediately ready (e.g. it only just ran the module-planning phase, or
  // initialModuleIndex's Teach phase, and there's still more to generate
  // before Teach can render). Runs once per mount -- see the key={subtopicId}
  // note above for why no subtopicId-change handling is needed here.
  useEffect(() => {
    if (!initialData.ready && !initialData.allModulesComplete && !initialData.error) {
      ensureModuleStageReady(initialModuleIndex, "teach");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function ensureModuleStageReady(idx, stageKey, force = false) {
    setLoadingStage(stageKey);
    try {
      for (let i = 0; i < MAX_STAGE_FETCH_ITERATIONS; i++) {
        const url = `/api/module-lesson?subtopicId=${encodeURIComponent(subtopicId)}&moduleIndex=${idx}&stage=${stageKey}${force && i === 0 ? "&force=true" : ""}`;
        const data = await safeFetchJson(url);
        if (data.error === "locked_down") {
          setLockdown(data);
          return;
        }
        if (data.error) {
          setError(data.error);
          return;
        }
        if (data.modules) setModules(data.modules);
        if (typeof data.unlockedStage === "string") setUnlockedStage(data.unlockedStage);
        if (data.allModulesComplete) {
          setAllModulesComplete(true);
          return;
        }
        setModuleContent((prev) => ({ ...prev, ...data }));
        if (data.ready) return;
      }
      setError("This module's content is taking longer than expected to prepare. Please try again in a moment.");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingStage((prev) => (prev === stageKey ? null : prev));
    }
  }

  // action:"advance" (a stage's own Continue button) is the only thing that
  // moves the highestStage high-water mark forward; action:"view" (a tab
  // click) just records where the student is currently looking, same as
  // before this feature existed.
  function postModuleStage(idx, stageKey, action = "view") {
    fetch("/api/module-lesson", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subtopicId, moduleIndex: idx, stage: stageKey, action }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (typeof data.unlockedStage === "string") setUnlockedStage(data.unlockedStage);
      })
      .catch(() => {});
  }

  function goToModuleStage(idx, stageKey, action = "view") {
    if (action !== "advance" && !isStageUnlocked(stageKey, unlockedStage)) return;
    setStage(stageKey);
    setPanelIndex(0);
    postModuleStage(idx, stageKey, action);
    if (stageKey !== "test") ensureModuleStageReady(idx, stageKey);
  }

  function goToModule(idx) {
    if (idx >= modules.length) {
      setAllModulesComplete(true);
      return;
    }
    if (modules[idx]?.locked) return;
    setModuleIndex(idx);
    setStage("teach");
    setPanelIndex(0);
    setUnlockedStage("teach");
    postModuleStage(idx, "teach");
    ensureModuleStageReady(idx, "teach");
  }

  if (lockdown) return <LockdownNotice lockdown={lockdown} />;
  if (error) return <div className="error-box">{error}</div>;

  if (allModulesComplete) {
    return (
      <div className="card">
        <h2>Subtopic complete</h2>
        <p className="lede">You've been through every module for this subtopic.</p>
        <a className="btn btn-primary" href={`/practice/${encodeURIComponent(subtopicId)}`}>
          Practice full exam-style questions on this subtopic, including real PYQs →
        </a>
      </div>
    );
  }

  if (!modules.length || !moduleContent) return <div className="loading">{"Preparing this lesson… (first visit generates it, a few seconds)"}</div>;

  const currentModule = modules[moduleIndex];
  const practiceReady = Boolean(moduleContent.practiceGeneratedAt);
  const isLastModule = moduleIndex === modules.length - 1;
  const nextModule = !isLastModule ? modules[moduleIndex + 1] : null;

  const teachPanels = moduleContent.teachContent
    ? [
        {
          key: "concept",
          label: "Concept",
          node: (
            <ul style={{ paddingLeft: 20, fontSize: 14.5, lineHeight: 1.7 }}>
              {bulletLines(moduleContent.teachContent).map((line, i) => (
                <li key={i} style={{ marginBottom: 6 }}>
                  {line}
                </li>
              ))}
            </ul>
          ),
        },
        moduleContent.keyPoints?.length > 0 && {
          key: "keypoints",
          label: "Key points",
          node: (
            <ul style={{ paddingLeft: 20, fontSize: 14, lineHeight: 1.7 }}>
              {moduleContent.keyPoints.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          ),
        },
        // Deliberately its own panel, not merged into "Concept" -- the base
        // explanation is taught first from NCERT/government/other sources,
        // this is a separate closing correlation to what's currently
        // relevant, explicitly meant for citing in an answer (see
        // lib/ai/generateModules.js's buildModuleTeachSystem).
        moduleContent.currentAffairsLink?.length > 0 && {
          key: "current-affairs-link",
          label: "Current affairs link",
          node: (
            <ul style={{ paddingLeft: 20, fontSize: 14, lineHeight: 1.7 }}>
              {moduleContent.currentAffairsLink.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          ),
        },
      ].filter(Boolean)
    : [];

  const graspPanels = practiceReady
    ? [
        moduleContent.examples?.length > 0 && {
          key: "examples",
          label: "Examples",
          node: moduleContent.examples.map((ex, i) => (
            <div className="example-card" key={i}>
              <div className="example-title">{ex.title}</div>
              <ul className="example-body" style={{ margin: 0, paddingLeft: 18 }}>
                {bulletLines(ex.body).map((line, j) => (
                  <li key={j}>{line}</li>
                ))}
              </ul>
            </div>
          )),
        },
        moduleContent.exercises?.length > 0 && {
          key: "exercises",
          label: "Exercises",
          node: moduleContent.exercises.map((ex, i) => (
            <div className="exercise-card" key={i}>
              <div className="exercise-prompt">{ex.prompt}</div>
              <ul className="exercise-answer" style={{ paddingLeft: 18, marginBottom: 0 }}>
                {bulletLines(ex.modelAnswer).map((line, j) => (
                  <li key={j}>{line}</li>
                ))}
              </ul>
            </div>
          )),
        },
      ].filter(Boolean)
    : [];

  const rememberPanels =
    practiceReady && moduleContent.mnemonic
      ? [
          {
            key: "mnemonic",
            label: "Mnemonic",
            node: (
              <>
                <div className="mnemonic-card">
                  <div className="mnemonic-device">{moduleContent.mnemonic.device}</div>
                  <div className="mnemonic-explanation">{moduleContent.mnemonic.explanation}</div>
                </div>
                {moduleContent.visualImageDataUri ? (
                  <img
                    src={moduleContent.visualImageDataUri}
                    alt={`Concept diagram for ${currentModule?.title || "this module"}`}
                    className="visual-diagram"
                  />
                ) : (
                  loadingStage === "remember" && (
                    <p className="section-hint" style={{ marginTop: 10 }}>
                      {"Generating diagram…"}
                    </p>
                  )
                )}
              </>
            ),
          },
        ]
      : [];

  return (
    <>
      <h1>{subjectDisplayName ? `${subjectDisplayName} · ${subtopicId}` : subtopicId}</h1>
      <p className="lede">{subtopicText}</p>
      <p style={{ fontSize: 12.5, marginBottom: 12 }}>
        <a href={`/sources/${encodeURIComponent(subtopicId)}`}>Browse grounding sources (NCERT, govt, current affairs) →</a>
        {" · "}
        <a href={`/book/${encodeURIComponent(subtopicId)}`}>📖 Read as a book →</a>
      </p>

      <LevelMap subtopicId={subtopicId} modules={modules} moduleIndex={moduleIndex} onSelect={goToModule} />
      <p className="section-hint" style={{ marginBottom: 12 }}>
        {currentModule?.scopeNote}
        {currentModule?.pyqId && (
          <>
            {" "}
            · <strong>Grounded in a real PYQ</strong>
            {currentModule.pyqYear ? ` (${currentModule.pyqYear}${currentModule.pyqMarks ? `, ${currentModule.pyqMarks} marks` : ""})` : ""}
          </>
        )}
      </p>

      <div className="segmented">
        {MODULE_STAGES.map((s) => {
          const locked = !isStageUnlocked(s.key, unlockedStage);
          return (
            <button
              key={s.key}
              className={`seg${stage === s.key ? " active" : ""}${locked ? " locked" : ""}`}
              onClick={() => goToModuleStage(moduleIndex, s.key)}
              disabled={locked}
              title={locked ? "Finish the previous stage first" : undefined}
            >
              {locked ? "🔒 " : ""}
              {s.label}
            </button>
          );
        })}
      </div>

      {stage === "teach" && (
        <div className="card">
          <h2>Teach</h2>
          {teachPanels.length > 0 ? (
            <StageModules
              modules={teachPanels}
              panelIndex={panelIndex}
              setPanelIndex={setPanelIndex}
              onComplete={() => goToModuleStage(moduleIndex, "grasp", "advance")}
              completeLabel="Continue to Grasp →"
            />
          ) : (
            <div className="loading">{"Preparing Teach content…"}</div>
          )}
        </div>
      )}

      {stage === "grasp" && (
        <div className="card">
          <h2>Grasp</h2>
          {!practiceReady ? (
            <div className="loading">{"Preparing Grasp content…"}</div>
          ) : graspPanels.length > 0 ? (
            <StageModules
              modules={graspPanels}
              panelIndex={panelIndex}
              setPanelIndex={setPanelIndex}
              onComplete={() => goToModuleStage(moduleIndex, "remember", "advance")}
              completeLabel="Continue to Remember →"
            />
          ) : (
            <EmptyStageFallback
              note="No practice material generated for this module."
              onComplete={() => goToModuleStage(moduleIndex, "remember", "advance")}
              completeLabel="Continue to Remember →"
            />
          )}
        </div>
      )}

      {stage === "remember" && (
        <div className="card">
          <h2>Remember</h2>
          {!practiceReady ? (
            <div className="loading">{"Preparing Remember content…"}</div>
          ) : rememberPanels.length > 0 ? (
            <StageModules
              modules={rememberPanels}
              panelIndex={panelIndex}
              setPanelIndex={setPanelIndex}
              onComplete={() => goToModuleStage(moduleIndex, "test", "advance")}
              completeLabel="Start Test →"
            />
          ) : (
            <EmptyStageFallback
              note="No mnemonic generated for this module."
              onComplete={() => goToModuleStage(moduleIndex, "test", "advance")}
              completeLabel="Start Test →"
            />
          )}

          {practiceReady && activeMinigame === null && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
              <button className="btn" onClick={() => setActiveMinigame("story")}>
                🎭 Play the story
              </button>
              <button className="btn" onClick={() => setActiveMinigame("crates")}>
                📦 Loot the facts
              </button>
              <button className="btn" onClick={() => setActiveMinigame("evidence")}>
                🧾 Investigate the evidence
              </button>
              <button className="btn" onClick={() => setActiveMinigame("scene")}>
                🌀 Step into the scene
              </button>
            </div>
          )}
          {activeMinigame === "story" && <StoryMode subtopicId={subtopicId} moduleIndex={moduleIndex} onClose={() => setActiveMinigame(null)} />}
          {activeMinigame === "crates" && (
            <div className="card" style={{ marginTop: 10 }}>
              <LootCrates keyPoints={moduleContent.keyPoints ?? []} />
              <button className="btn" style={{ marginTop: 10 }} onClick={() => setActiveMinigame(null)}>
                Close
              </button>
            </div>
          )}
          {activeMinigame === "evidence" && (
            <div className="card" style={{ marginTop: 10 }}>
              <EvidenceBoard
                moduleId={currentModule.id}
                moduleTitle={currentModule.title}
                keyPoints={moduleContent.keyPoints ?? []}
                otherModuleTitles={modules.filter((m) => m.id !== currentModule.id).map((m) => m.title)}
              />
              <button className="btn" style={{ marginTop: 10 }} onClick={() => setActiveMinigame(null)}>
                Close
              </button>
            </div>
          )}
          {activeMinigame === "scene" && <TimeSceneChallenge subtopicId={subtopicId} moduleIndex={moduleIndex} onClose={() => setActiveMinigame(null)} />}
        </div>
      )}

      {stage === "test" && (
        <div className="card">
          <h2>Test</h2>
          <ModuleTestPanel
            subtopicId={subtopicId}
            moduleId={currentModule.id}
            moduleTitle={currentModule.title}
            isLastModule={isLastModule}
            nextModuleLocked={nextModule?.locked ? nextModule : null}
            nextModuleLockReasonLabel={nextModule?.locked ? lockReasonLabel(nextModule.lockReason) : null}
            onNext={() => goToModule(moduleIndex + 1)}
            onGraded={() => ensureModuleStageReady(moduleIndex, "test")}
          />
        </div>
      )}
    </>
  );
}
