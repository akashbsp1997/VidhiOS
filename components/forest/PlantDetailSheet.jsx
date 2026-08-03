"use client";

import { GROWTH_STAGES, HEALTH_STATES } from "../../lib/forest/growth.js";
import PlantGlyph from "./PlantGlyph.jsx";

function lastAttemptedLabel(daysSince) {
  if (daysSince == null) return "not attempted yet";
  if (daysSince < 1) return "attempted today";
  const d = Math.round(daysSince);
  return `attempted ${d} day${d === 1 ? "" : "s"} ago`;
}

// The tap target from ForestCanopy's plant grid -- growth ladder, health
// strip, and a short "why" line (design doc §5's plant detail sheet), then
// the exact same "Revise now" hand-off the List view's row link already
// uses (/learn/{id}), unchanged.
export default function PlantDetailSheet({ subtopic, onClose }) {
  if (!subtopic) return null;
  const stageIdx = GROWTH_STAGES.findIndex((s) => s.id === subtopic.growthStage);
  const healthIdx = HEALTH_STATES.findIndex((s) => s.id === subtopic.health);

  return (
    <div className="forest-sheet-backdrop" onClick={onClose}>
      <div className="forest-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={subtopic.topicText}>
        <button className="forest-sheet-close" onClick={onClose} aria-label="Close">
          ×
        </button>

        <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 4 }}>
          <PlantGlyph growthStage={subtopic.growthStage} health={subtopic.health} size={56} />
          <div>
            <div className="subtopic-code">{subtopic.id}</div>
            <h3 style={{ margin: "2px 0 0", fontSize: 17 }}>{subtopic.topicText}</h3>
          </div>
        </div>

        <div className="forest-ladder-label">Growth</div>
        <div className="forest-ladder">
          {GROWTH_STAGES.map((s, i) => (
            <span key={s.id} className={`stage-chip${i === stageIdx ? " on" : ""}`}>
              {s.label}
            </span>
          ))}
        </div>

        <div className="forest-ladder-label">Health</div>
        <div className="forest-ladder">
          {HEALTH_STATES.map((s, i) => (
            <span key={s.id} className={`stage-chip health${i === healthIdx ? " on" : ""}`}>
              {s.label}
            </span>
          ))}
        </div>

        <p className="lede" style={{ margin: "14px 0" }}>
          {lastAttemptedLabel(subtopic.daysSinceCheckpoint)}
          {subtopic.retentionPct != null && subtopic.daysSinceCheckpoint != null && ` · estimated retention ${subtopic.retentionPct}%`}
          {" · "}
          {Math.round(subtopic.masteryScore * 100)}% mastery
        </p>

        {subtopic.locked ? (
          <span className="locked-pill">
            Locked — reach {subtopic.requiredMasteryPct}% mastery on {subtopic.requiredSubtopicText} first
          </span>
        ) : (
          <a className="btn btn-primary" href={`/learn/${subtopic.id}`}>
            Revise now →
          </a>
        )}
      </div>
    </div>
  );
}
