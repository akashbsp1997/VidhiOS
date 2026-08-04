"use client";

import { useEffect, useState } from "react";
import ModuleTestPanel from "./ModuleTestPanel.jsx";
import LockdownNotice from "./LockdownNotice.jsx";
import StoryMode from "./StoryMode.jsx";
import LevelMap from "./LevelMap.jsx";
import LootCrates from "./LootCrates.jsx";
import EvidenceBoard from "./EvidenceBoard.jsx";
import TimeSceneChallenge from "./TimeSceneChallenge.jsx";
import CourtroomScene from "./CourtroomScene.jsx";
import Timeline from "./Timeline.jsx";
import ComparisonDuel from "./ComparisonDuel.jsx";
import NetworkExplorer from "./NetworkExplorer.jsx";
import ModeSelector from "./ModeSelector.jsx";
import ModuleBlankdown from "./ModuleBlankdown.jsx";
import { isStageUnlocked } from "../lib/adaptive/unlocks.js";
import { bulletLines } from "../lib/text/bullets.js";
import { modeById, DEFAULT_MODE_ID, loadSavedMode, saveMode } from "../lib/rpg/modes.js";

const MAX_STAGE_FETCH_ITERATIONS = 5;

// Matches lib/ai/generateModules.js's buildModuleTeachSystem beat
// whitelist exactly -- one Teach panel per non-empty beat instead of one
// long scrollable block, when a module has them (moduleContent.teachBeats).
// Older already-generated modules have no teachBeats yet (this app has no
// automatic backfill/regeneration step), so callers must fall back to the
// legacy single "Concept" panel over the flat teachContent string when it's
// empty -- see the hasBeats branch below.
const BEAT_LABELS = {
  origin: "Where this comes from",
  essential_nature: "What kind of thing this is",
  definition: "The precise definition",
  responsibility: "Who's responsible",
  mechanics: "How it works",
  significance: "Why it matters",
};

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
  // Which learning mode drives the PRIMARY widget shown at each stage (see
  // lib/rpg/modes.js) -- a presentation choice layered over the stage
  // machine above, never a second copy of it. Starts at the shared default
  // and is corrected from localStorage after mount (not during the initial
  // render -- localStorage isn't available server-side, and reading it
  // synchronously during render would mismatch Next's server-rendered
  // HTML, same convention as app/papers/[subjectId]/[paper]'s Forest/List
  // view preference).
  const [modeId, setModeId] = useState(DEFAULT_MODE_ID);
  const mode = modeById(modeId);

  useEffect(() => {
    setModeId(loadSavedMode());
  }, []);

  function changeMode(id) {
    setModeId(id);
    saveMode(id);
  }

  useEffect(() => {
    setActiveMinigame(null);
  }, [moduleIndex]);

  // Remember-stage auto-open: each mode has one PRIMARY minigame there
  // (story/game modes) -- opened automatically on arrival so the default
  // experience is already in-game, not a click away. Advanced/rapidfire
  // deliberately open nothing here (their Remember is meant to be fast).
  useEffect(() => {
    if (stage !== "remember") return;
    if (mode.rememberPrimary === "story") setActiveMinigame("story");
    else if (mode.rememberPrimary === "evidence") setActiveMinigame("evidence");
    else if (mode.rememberPrimary === "blankdown") setActiveMinigame("blankdown");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, moduleIndex, modeId]);

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

  // "compact" (Advanced mode) skips the full read-through entirely --
  // keyPoints only, for speed. "narrative" (Story mode) renders the same
  // bulleted beat/teachContent as flowing story-like paragraphs instead of a
  // bare list -- the content is already written as a narrative arc (see
  // buildModuleTeachSystem), this just reads that way visually too.
  function renderTeachBody(text) {
    return mode.teachPrimary === "narrative" ? (
      <div style={{ fontSize: 15, lineHeight: 1.9, fontStyle: "italic" }}>
        {bulletLines(text).map((line, i) => (
          <p key={i} style={{ margin: "0 0 10px" }}>
            {line}
          </p>
        ))}
      </div>
    ) : (
      <ul style={{ paddingLeft: 20, fontSize: 14.5, lineHeight: 1.7 }}>
        {bulletLines(text).map((line, i) => (
          <li key={i} style={{ marginBottom: 6 }}>
            {line}
          </li>
        ))}
      </ul>
    );
  }

  // One panel per non-empty beat (a module taught in 6 short, labeled
  // stops instead of one 600-1200-word scroll) when this module has them;
  // older modules generated before teachBeats existed fall back to the
  // single flat "Concept" panel over teachContent, unchanged from before.
  const hasBeats = Array.isArray(moduleContent.teachBeats) && moduleContent.teachBeats.some((b) => b?.content?.trim());
  const teachPanels = moduleContent.teachContent
    ? [
        ...(mode.teachPrimary === "compact"
          ? []
          : hasBeats
          ? moduleContent.teachBeats
              .filter((b) => b?.content?.trim())
              .map((b) => ({ key: `beat-${b.beat}`, label: BEAT_LABELS[b.beat] ?? b.beat, node: renderTeachBody(b.content) }))
          : [{ key: "concept", label: "Concept", node: renderTeachBody(moduleContent.teachContent) }]),
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

      <ModeSelector modeId={modeId} onChange={changeMode} />
      <p className="section-hint" style={{ marginTop: -6, marginBottom: 10 }}>{mode.tagline}</p>

      <LevelMap subtopicId={subtopicId} modules={modules} moduleIndex={moduleIndex} onSelect={goToModule} />
      <p className="section-hint" style={{ marginBottom: 12 }}>
        {currentModule?.articleRef && (
          <>
            <strong>{currentModule.articleRef}</strong> —{" "}
          </>
        )}
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
          <Timeline events={moduleContent.timelineEvents} />
          {teachPanels.length > 0 ? (
            <>
              {mode.teachPrimary === "crates" && moduleContent.keyPoints?.length > 0 && (
                <div className="card" style={{ marginBottom: 12, background: "var(--surface-2)" }}>
                  <LootCrates keyPoints={moduleContent.keyPoints} />
                </div>
              )}
              {mode.teachPrimary === "blankdown" && moduleContent.teachContent && (
                <div className="card" style={{ marginBottom: 12, background: "var(--surface-2)" }}>
                  <ModuleBlankdown key={currentModule.id} moduleId={currentModule.id} teachContent={moduleContent.teachContent} onDone={() => {}} />
                </div>
              )}
              <StageModules
                modules={teachPanels}
                panelIndex={panelIndex}
                setPanelIndex={setPanelIndex}
                onComplete={() => goToModuleStage(moduleIndex, "grasp", "advance")}
                completeLabel="Continue to Grasp →"
              />
            </>
          ) : (
            <div className="loading">{"Preparing Teach content…"}</div>
          )}
        </div>
      )}

      {stage === "grasp" && (
        <div className="card">
          <h2>Grasp</h2>
          {mode.graspPrimary === "skip" && practiceReady && (
            <button className="btn btn-primary" style={{ marginBottom: 12 }} onClick={() => goToModuleStage(moduleIndex, "remember", "advance")}>
              ⏩ Fast-forward to Remember →
            </button>
          )}
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

          {/* Advanced mode's Remember is meant to be fast -- no minigame
              row, straight to the Continue/Start Test button above. Every
              other mode gets the full row, with the mode's own
              rememberPrimary already auto-opened (see the useEffect
              above) rather than requiring an extra click. */}
          {practiceReady && activeMinigame === null && mode.rememberPrimary !== "compact" && (
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
              <button className="btn" onClick={() => setActiveMinigame("blankdown")}>
                🔫 Rapidfire blankdown
              </button>
              {/* Only offered when this module's subtopic has a real,
                  verified case in db/seed/cases.js -- currently Law Optional
                  only, see currentModule.hasCaseLaw (app/api/module-lesson/
                  route.js's buildModulesSummary). */}
              {currentModule.hasCaseLaw && (
                <button className="btn" onClick={() => setActiveMinigame("courtroom")}>
                  ⚖️ Enter the courtroom
                </button>
              )}
              {moduleContent.comparisonData && (
                <button className="btn" onClick={() => setActiveMinigame("comparison")}>
                  ⚔️ Comparison Duel
                </button>
              )}
              {moduleContent.networkData && (
                <button className="btn" onClick={() => setActiveMinigame("network")}>
                  🕸️ Explore the network
                </button>
              )}
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
          {activeMinigame === "courtroom" && <CourtroomScene subtopicId={subtopicId} moduleIndex={moduleIndex} onClose={() => setActiveMinigame(null)} />}
          {activeMinigame === "blankdown" && moduleContent.teachContent && (
            <div className="card" style={{ marginTop: 10 }}>
              <ModuleBlankdown key={currentModule.id} moduleId={currentModule.id} teachContent={moduleContent.teachContent} onDone={() => setActiveMinigame(null)} />
              <button className="btn" style={{ marginTop: 10 }} onClick={() => setActiveMinigame(null)}>
                Close
              </button>
            </div>
          )}
          {activeMinigame === "comparison" && moduleContent.comparisonData && (
            <div className="card" style={{ marginTop: 10 }}>
              <ComparisonDuel moduleId={currentModule.id} comparisonData={moduleContent.comparisonData} />
              <button className="btn" style={{ marginTop: 10 }} onClick={() => setActiveMinigame(null)}>
                Close
              </button>
            </div>
          )}
          {activeMinigame === "network" && moduleContent.networkData && (
            <div className="card" style={{ marginTop: 10 }}>
              <NetworkExplorer networkData={moduleContent.networkData} />
              <button className="btn" style={{ marginTop: 10 }} onClick={() => setActiveMinigame(null)}>
                Close
              </button>
            </div>
          )}
        </div>
      )}

      {stage === "test" && (
        <div className="card">
          <h2>
            Test
            {(modeId === "advanced" || modeId === "rapidfire") && (
              <span className="tier-pill" style={{ marginLeft: 8, fontSize: 11 }}>
                ⚡ Fast mode
              </span>
            )}
          </h2>
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
