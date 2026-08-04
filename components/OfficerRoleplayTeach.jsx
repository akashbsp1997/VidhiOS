"use client";

// Officer Roleplay Teach -- the MANDATORY, sole Teach-stage presentation
// (per explicit request: "the whole app should be this roleplaying game,"
// full replacement of the old bulleted/beat-panel view, no fallback).
// Builds panels for the SAME panel-stepper components/ModuleLearnFlow.jsx
// already uses for Grasp/Remember (StageModules) -- a "Your Post" briefing
// panel (the officer's rank + the real issue they're handling + this
// module's one shared illustration), then one panel per scene (see
// lib/ai/generateModules.js's generateModuleOfficerRoleplay -- one per
// already-generated teachBeat, each tagged with a real phase of an
// officer's actual workflow). Reuses app/globals.css's character-bob/
// speech-bubble/bubble-pop conventions (already shipped for
// CharacterScene/RoleplayScene) rather than inventing new motion, so the
// "comic" feel comes from the same visual language already established.

const OFFICER_PHASE_LABELS = {
  formalize_sources: "📋 Formalize Sources",
  extract_information: "🔍 Extract Information",
  analyze_solution: "🧠 Analyze the Solution",
  strategize_implementation: "🗺️ Strategize Implementation",
  verify_compliance: "✅ Verify Compliance",
};

export function buildOfficerTeachPanels({ officerScenes, visualImageDataUri, moduleTitle }) {
  if (!officerScenes?.scenes?.length) return [];

  const briefingPanel = {
    key: "officer-briefing",
    label: "Your Post",
    node: (
      <div style={{ textAlign: "center" }}>
        {visualImageDataUri && (
          <img
            src={visualImageDataUri}
            alt={moduleTitle}
            style={{ maxWidth: "100%", borderRadius: "var(--radius)", marginBottom: 12, animation: "bubble-pop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)" }}
          />
        )}
        <p style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>🧑‍💼 {officerScenes.officerRank}</p>
        <p style={{ fontSize: 13.5, color: "var(--ink-soft)", margin: 0 }}>{officerScenes.issueBrief}</p>
      </div>
    ),
  };

  const scenePanels = officerScenes.scenes.map((s) => ({
    key: `officer-scene-${s.beat}`,
    label: OFFICER_PHASE_LABELS[s.officerPhase] ?? s.officerPhase,
    node: (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <span className="character-bob" style={{ fontSize: 30 }}>
            🧑‍💼
          </span>
          <span className="tier-pill" style={{ fontSize: 11 }}>
            {OFFICER_PHASE_LABELS[s.officerPhase] ?? s.officerPhase}
          </span>
        </div>
        <div key={s.beat} className="speech-bubble" style={{ fontSize: 14.5, lineHeight: 1.7 }}>
          {s.narration}
        </div>
      </div>
    ),
  }));

  return [briefingPanel, ...scenePanels];
}
