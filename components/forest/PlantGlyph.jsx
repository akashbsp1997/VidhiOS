"use client";

import { GROWTH_STAGES, HEALTH_STATES } from "../../lib/forest/growth.js";

// Bloom Knowledge Forest (design doc §8) -- one small parametric SVG, not
// 35 hand-drawn assets: trunk height and canopy radius scale continuously
// with growth-stage rank (structural progress, never shrinks), canopy
// color/opacity scale with health rank (current retention, what withers
// and recovers). Two independent axes composited into one glyph, exactly
// mirroring lib/forest/growth.js's underlying two-axis model.

const HEALTH_COLOR = {
  healthy: "var(--accent-green)",
  yellow: "var(--accent-gold)",
  falling: "var(--accent-gold)",
  bare: "var(--accent-red)",
  dormant: "var(--ink-soft)",
};

function rankOf(list, id) {
  const i = list.findIndex((s) => s.id === id);
  return i === -1 ? 0 : i / (list.length - 1);
}

export default function PlantGlyph({ growthStage, health, size = 40, title }) {
  const stageRank = rankOf(GROWTH_STAGES, growthStage); // 0 (seed) .. 1 (mastered)
  const healthRank = rankOf(HEALTH_STATES, health); // 0 (dormant) .. 1 (healthy)
  const color = HEALTH_COLOR[health] ?? "var(--ink-soft)";
  const canopyOpacity = health === "dormant" ? 0.32 : 0.5 + healthRank * 0.5;

  const w = 44;
  const h = 44;
  const baseY = h - 4;
  const isSeed = stageRank < 0.12;
  const trunkH = isSeed ? 0 : 3 + stageRank * 14;
  const canopyR = isSeed ? 3.5 : 3 + stageRank * 13;
  const trunkTopY = baseY - trunkH;
  const canopyCy = isSeed ? baseY - canopyR + 1 : trunkTopY - canopyR * 0.6;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={title || `${growthStage}, ${health}`}>
      {title && <title>{title}</title>}
      {!isSeed && (
        <line x1={w / 2} y1={baseY} x2={w / 2} y2={trunkTopY} stroke="var(--ink-soft)" strokeWidth={2 + stageRank * 1.5} strokeLinecap="round" />
      )}
      <circle cx={w / 2} cy={canopyCy} r={canopyR} fill={color} opacity={canopyOpacity} />
      {health === "bare" && (
        // A shape cue in addition to color, so this state doesn't rely on
        // hue alone (design doc §20's accessibility flag) -- a couple of
        // stray marks below the canopy, reading as fallen leaves.
        <>
          <circle cx={w / 2 - 8} cy={baseY - 2} r={1.6} fill={color} opacity={0.6} />
          <circle cx={w / 2 + 6} cy={baseY} r={1.4} fill={color} opacity={0.5} />
        </>
      )}
    </svg>
  );
}
