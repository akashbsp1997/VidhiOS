// lib/forest/estate.js
//
// Account-wide progression, one tier up from lib/forest/growth.js's
// per-subtopic growth stage: garden -> orchard -> farm -> forest, driven
// by how many of a student's subtopics have matured (Healthy Tree or
// further), not any one topic's own state. Pure lookup, same style as
// growth.js -- no DB access here, callers count the mature subtopics
// themselves and pass the number in.

export const ESTATE_TIERS = [
  { id: "garden", label: "Garden", minMaturePlants: 0 },
  { id: "orchard", label: "Orchard", minMaturePlants: 5 },
  { id: "farm", label: "Farm", minMaturePlants: 15 },
  { id: "forest", label: "Forest", minMaturePlants: 30 },
];

// A subtopic counts as "mature" toward estate tier once it's reached
// Healthy Tree or beyond -- matches lib/forest/growth.js's GROWTH_STAGES
// ordering (index 4 of 7: seed, sprout, sapling, young_tree, healthy_tree,
// blooming_tree, mastered_tree).
export const MATURE_GROWTH_STAGES = ["healthy_tree", "blooming_tree", "mastered_tree"];

export function estateTierForMatureCount(matureCount) {
  let current = ESTATE_TIERS[0];
  for (const tier of ESTATE_TIERS) {
    if (matureCount >= tier.minMaturePlants) current = tier;
    else break;
  }
  return current;
}
