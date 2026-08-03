// lib/rpg/modes.js
//
// The four learning modes, explicit request: "story mode gives deep
// learning, game mode is well paced conceptual and revision oriented,
// advanced is test focus fast paced, rapidfire is blankdown mode." A
// student picks one per session (components/ModeSelector.jsx, persisted in
// localStorage as a default, changeable anytime) -- it changes WHICH
// widget is the primary/auto-shown view at each stage, never the
// underlying Teach->Grasp->Remember->Test progression/lock mechanics
// (lib/adaptive/unlocks.js), which stay identical across all four modes.
// That's a deliberate boundary: this is a presentation-layer choice
// layered over the existing, carefully-gated content pipeline, not a
// second pipeline.
//
// Important constraint this file's callers must respect: the Remember-
// stage minigames (Story Mode, Time-Scene Challenge) are server-gated to
// require Remember already unlocked (see their API routes) -- they can
// never be the PRIMARY view during Teach, only during/after Remember.
// Teach's "story" primary is therefore a narrative READING treatment of
// the same already-narrative-arc teachContent (see buildModuleTeachSystem),
// not the scene-based Story Mode component itself.

export const MODES = [
  {
    id: "story",
    label: "Story",
    icon: "🎭",
    tagline: "Deep learning -- read it as a story, then live it as one.",
    teachPrimary: "narrative", // continuous prose read-through, not crates
    graspPrimary: "full",
    rememberPrimary: "story", // auto-opens the scene-based Story Mode
  },
  {
    id: "game",
    label: "Game",
    icon: "🎮",
    tagline: "Well-paced -- concepts and revision, delivered as play.",
    teachPrimary: "crates", // LootCrates first, full text stays one tap away
    graspPrimary: "full",
    rememberPrimary: "evidence", // EvidenceBoard first
  },
  {
    id: "advanced",
    label: "Advanced",
    icon: "⚡",
    tagline: "Fast -- straight to testing yourself.",
    teachPrimary: "compact", // keyPoints only, full text collapsed
    graspPrimary: "skip",
    rememberPrimary: "compact",
  },
  {
    id: "rapidfire",
    label: "Rapidfire",
    icon: "🔫",
    tagline: "Blankdown -- rapid-fire recall, nothing else.",
    teachPrimary: "blankdown",
    graspPrimary: "skip",
    rememberPrimary: "blankdown",
  },
];

export const DEFAULT_MODE_ID = "game";
const STORAGE_KEY = "vidhios-learn-mode";

export function modeById(id) {
  return MODES.find((m) => m.id === id) ?? MODES.find((m) => m.id === DEFAULT_MODE_ID);
}

export function loadSavedMode() {
  if (typeof localStorage === "undefined") return DEFAULT_MODE_ID;
  return localStorage.getItem(STORAGE_KEY) || DEFAULT_MODE_ID;
}

export function saveMode(id) {
  if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, id);
}
