"use client";

import CollapsibleSection from "../CollapsibleSection.jsx";
import PlantGlyph from "./PlantGlyph.jsx";

// Forest-view renderer for a grouped subtopic list -- the SAME grouped data
// the List view already computes (see app/papers/[subjectId]/[paper]/page.jsx's
// buildSections), just rendered as a grove of plants instead of accordion
// rows (design doc §4: one data hook, two renderers, not a second app).
// Each section is still a CollapsibleSection, matching this app's existing
// tree-nav convention rather than inventing a second grouping treatment.
export default function ForestCanopy({ sectionOrder, bySection, onSelect }) {
  return (
    <>
      {sectionOrder.map((section, idx) => {
        const items = bySection.get(section);
        return (
          <CollapsibleSection
            title={section}
            meta={`${items.length} topic${items.length === 1 ? "" : "s"}`}
            defaultOpen={idx === 0}
            key={section}
          >
            <div className="forest-grove">
              {items.map((s) => {
                // A Mastered Tree has "borne fruit" -- it's what unlocked
                // the next subtopic in this chain (lib/adaptive/unlocks.js's
                // existing sequential-mastery lock, unchanged); the seed
                // badge just names that mechanic instead of leaving it
                // implicit. A locked plant's tooltip explains what it's
                // still waiting on, using the same requiredSubtopicText the
                // List view's locked-pill already shows.
                const bore = s.growthStage === "mastered_tree";
                const title = s.locked
                  ? `Locked — needs seeds from mastering "${s.requiredSubtopicText}" first (${s.currentMasteryPct}%/${s.requiredMasteryPct}%)`
                  : s.topicText;
                return (
                  <button
                    key={s.id}
                    type="button"
                    className="forest-plant-btn"
                    style={s.opacity != null ? { opacity: s.opacity } : undefined}
                    onClick={() => onSelect(s)}
                    title={title}
                  >
                    <span style={{ position: "relative" }}>
                      <PlantGlyph growthStage={s.growthStage} health={s.health} size={44} title={title} />
                      {bore && (
                        <span className="forest-seed-badge" aria-hidden="true">
                          🌱
                        </span>
                      )}
                    </span>
                    <span className="forest-plant-code">{s.id}</span>
                  </button>
                );
              })}
            </div>
          </CollapsibleSection>
        );
      })}
    </>
  );
}
