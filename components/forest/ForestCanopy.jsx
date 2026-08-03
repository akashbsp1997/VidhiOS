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
              {items.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="forest-plant-btn"
                  style={s.opacity != null ? { opacity: s.opacity } : undefined}
                  onClick={() => onSelect(s)}
                >
                  <PlantGlyph growthStage={s.growthStage} health={s.health} size={44} title={s.topicText} />
                  <span className="forest-plant-code">{s.id}</span>
                </button>
              ))}
            </div>
          </CollapsibleSection>
        );
      })}
    </>
  );
}
