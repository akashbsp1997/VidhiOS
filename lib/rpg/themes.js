// lib/rpg/themes.js
//
// Theme variety for the Dragon's Challenge intro (components/
// DragonChallenge.jsx) and the Monster Battle Test reskin (components/
// ModuleTestPanel.jsx) -- explicit request: "not just dragons... sometimes
// scifi sometimes unicorns sometimes hobbits sometimes ironman sometimes
// wizards sometimes leprechauns... themes can be fixed." Each subtopic gets
// exactly ONE theme, chosen deterministically from its own id (same
// hash-to-unit trick as lib/gamification/worldMap.js's map positions) --
// stable across visits/sessions for that subtopic, never re-rolled, while
// different subtopics land on different themes across the app.
//
// Original characters/creatures in each genre's spirit, not any specific
// copyrighted character (no literal "Iron Man," "hobbit," etc.) -- an
// armored-inventor-hero and a small sharp-eyed wayfarer capture the same
// feeling without reusing trademarked names/likenesses.

const THEMES = [
  {
    id: "dragons",
    name: "Dragon's Peak",
    guide: { emoji: "🐉", intro: "An old dragon blocks your path, guarding this subtopic. \"Before I teach you anything,\" it rumbles, \"let's see what you already know.\"" },
    creatures: [
      { name: "Sphinx", emoji: "🗿", verb: "answer its riddle" },
      { name: "Lion", emoji: "🦁", verb: "stand your ground" },
      { name: "Centaur", emoji: "🐎", verb: "match its challenge" },
      { name: "Gorgon", emoji: "🐍", verb: "hold your nerve" },
      { name: "Griffin", emoji: "🦅", verb: "prove your worth" },
      { name: "Minotaur", emoji: "🐂", verb: "navigate the maze" },
    ],
  },
  {
    id: "scifi",
    name: "Signal from the Deep",
    guide: { emoji: "🤖", intro: "A dormant AI core flickers awake and seals the corridor ahead. \"Unverified user detected,\" it hums. \"State your knowledge.\"" },
    creatures: [
      { name: "Cyber-Sentinel", emoji: "🦾", verb: "outsmart its logic" },
      { name: "Rogue Drone", emoji: "🛸", verb: "dodge its scan" },
      { name: "Void Kraken", emoji: "🐙", verb: "hold the line" },
      { name: "Glitch Wraith", emoji: "👾", verb: "debug the anomaly" },
      { name: "Nano Swarm", emoji: "🧫", verb: "contain the swarm" },
      { name: "Star Golem", emoji: "☄️", verb: "crack its core" },
    ],
  },
  {
    id: "unicorns",
    name: "Moonlit Glade",
    guide: { emoji: "🦄", intro: "A silver unicorn steps out of the moonlit trees and lowers its horn. It won't move until you've proven your heart is ready." },
    creatures: [
      { name: "Shadow Wolf", emoji: "🐺", verb: "outwit the pack" },
      { name: "Bog Troll", emoji: "🧌", verb: "solve its riddle" },
      { name: "Thorn Ent", emoji: "🌳", verb: "earn its respect" },
      { name: "Moon Serpent", emoji: "🐍", verb: "break its spell" },
      { name: "Frost Pixie", emoji: "❄️", verb: "outshine its trick" },
      { name: "Storm Owl", emoji: "🦉", verb: "answer truthfully" },
    ],
  },
  {
    id: "wayfarer",
    name: "The Wandering Shire",
    guide: { emoji: "🥾", intro: "A small, sharp-eyed traveler steps out from the hedgerow, pipe in hand, and looks you up and down before letting you pass." },
    creatures: [
      { name: "Cave Goblin", emoji: "👺", verb: "talk your way past" },
      { name: "Barrow Wight", emoji: "🪦", verb: "break its grip" },
      { name: "Marsh Wraith", emoji: "🌫️", verb: "keep your nerve" },
      { name: "Mountain Troll", emoji: "🗻", verb: "outlast it" },
      { name: "Giant Spider", emoji: "🕷️", verb: "cut yourself free" },
      { name: "Shadow Rider", emoji: "🐴", verb: "stand and don't flee" },
    ],
  },
  {
    id: "armored-hero",
    name: "Ironclad City",
    guide: { emoji: "🦾", intro: "A visor lights up in the dark -- a genius in powered armor drops in front of you. \"New recruit? Prove it.\"" },
    creatures: [
      { name: "Rogue Bot", emoji: "🤖", verb: "outmaneuver it" },
      { name: "Sky Sentinel", emoji: "🛩️", verb: "out-think its targeting" },
      { name: "Plasma Beast", emoji: "🔥", verb: "cool its core" },
      { name: "Stealth Drone", emoji: "🥷", verb: "expose it" },
      { name: "Iron Golem", emoji: "⚙️", verb: "find its weak point" },
      { name: "Storm Mech", emoji: "⛈️", verb: "ground it" },
    ],
  },
  {
    id: "wizards",
    name: "The Arcane Academy",
    guide: { emoji: "🧙", intro: "A robed archmage taps a staff twice and the air crackles. \"Every apprentice proves themselves before the first lesson.\"" },
    creatures: [
      { name: "Stone Golem", emoji: "🗿", verb: "find the crack in it" },
      { name: "Basilisk", emoji: "🐍", verb: "avoid its gaze" },
      { name: "Fire Troll", emoji: "🔥", verb: "outlast the heat" },
      { name: "Shade Wraith", emoji: "👻", verb: "banish it" },
      { name: "Arcane Sentinel", emoji: "🔮", verb: "counter its spell" },
      { name: "Frost Giant", emoji: "🧊", verb: "melt its resolve" },
    ],
  },
  {
    id: "leprechauns",
    name: "The Emerald Hollow",
    guide: { emoji: "🍀", intro: "A sly little figure in green hops onto a mushroom and grins. \"No gold for free, mind -- answer me this first.\"" },
    creatures: [
      { name: "Banshee", emoji: "👻", verb: "steady your nerve" },
      { name: "Kelpie", emoji: "🐴", verb: "resist its lure" },
      { name: "Pooka", emoji: "🐐", verb: "outsmart its tricks" },
      { name: "Bog Sprite", emoji: "🌫️", verb: "find the true path" },
      { name: "Selkie", emoji: "🦭", verb: "answer its riddle" },
      { name: "Fae Trickster", emoji: "🧚", verb: "spot the trick" },
    ],
  },
  {
    id: "space",
    name: "The Outer Reaches",
    guide: { emoji: "🚀", intro: "A retired star-captain's hologram flickers to life and blocks the airlock. \"Nobody boards without proving their training.\"" },
    creatures: [
      { name: "Asteroid Beast", emoji: "☄️", verb: "chart around it" },
      { name: "Alien Sentinel", emoji: "👽", verb: "pass its scan" },
      { name: "Comet Wraith", emoji: "🌠", verb: "outrun it" },
      { name: "Void Leviathan", emoji: "🐋", verb: "hold steady" },
      { name: "Star Pirate", emoji: "🏴‍☠️", verb: "outwit it" },
      { name: "Nebula Ghost", emoji: "🌌", verb: "see through it" },
    ],
  },
];

function hashToUnit(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(h, 31) + str.charCodeAt(i)) >>> 0;
  return (h % 10_000) / 10_000;
}

/** Deterministic theme for a subtopic -- stable across visits/sessions, varied across subtopics. Never randomized per-render. */
export function themeForSubtopic(subtopicId) {
  const idx = Math.floor(hashToUnit(String(subtopicId)) * THEMES.length) % THEMES.length;
  return THEMES[idx];
}

/** This module's themed "boss" for the Monster Battle reskin -- same theme as the subtopic's Dragon's Challenge, a different creature per module. */
export function creatureForModule(subtopicId, moduleId) {
  const theme = themeForSubtopic(subtopicId);
  const idx = Math.abs(Number(moduleId) || 0) % theme.creatures.length;
  return { theme, creature: theme.creatures[idx] };
}
