"use client";

import { useEffect, useState } from "react";
import CollapsibleSection from "../../components/CollapsibleSection.jsx";

const HEALTH_LABEL = { dormant: "Dormant", bare: "Bare branches", falling: "Falling leaves", yellow: "Yellow leaves", healthy: "Healthy" };

export default function NcertChaptersPage() {
  const [chapters, setChapters] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch("/api/ncert-chapters")
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setChapters(d.chapters)))
      .catch((e) => setError(e.message));
  }, []);

  return (
    <>
      <h1>📗 NCERT Chapters</h1>
      <p className="lede">
        The same subtopics, browsed by which NCERT chapter grounds them instead of by syllabus section -- classwise,
        6 through 12. The real syllabus stays what actually gets tested; this is just another way to walk through it,
        the way NCERT itself builds up a subject one class at a time.
      </p>

      {error && <div className="error-box">{error}</div>}
      {!chapters && !error && <div className="loading">Loading NCERT chapters…</div>}
      {chapters?.length === 0 && <p className="lede">No NCERT sources tagged with a class/chapter yet.</p>}

      {chapters?.map((c, idx) => (
        <CollapsibleSection
          key={`${c.ncertClass}-${c.ncertBook}-${c.ncertChapter}`}
          title={`Class ${c.ncertClass} — ${c.ncertBook}`}
          meta={`${c.ncertChapter} · ${c.subtopics.length} topic${c.subtopics.length === 1 ? "" : "s"}`}
          defaultOpen={idx === 0}
        >
          {c.subtopics.map((s) => (
            <div className="subtopic-row" key={s.subtopicId}>
              <span className="row-dots">
                <span
                  className={`mastery-health-dot mastery-health-${s.health}`}
                  title={`Retention: ${HEALTH_LABEL[s.health] ?? s.health}`}
                />
              </span>
              <span className="subtopic-code">{s.subtopicId}</span>
              <span className="subtopic-text">
                <a href={`/learn/${s.subtopicId}`}>{s.topicText}</a>
                <div className="subtopic-meta">{s.section}</div>
              </span>
              <span className="bar" title={`${Math.round(s.masteryScore * 100)}% mastery`}>
                <span style={{ width: `${Math.round(s.masteryScore * 100)}%` }} />
              </span>
            </div>
          ))}
        </CollapsibleSection>
      ))}
    </>
  );
}
