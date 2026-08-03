"use client";

import { useEffect, useState } from "react";
import CollapsibleSection from "../../components/CollapsibleSection.jsx";

function timeAgo(pubDate) {
  const d = new Date(pubDate);
  if (Number.isNaN(d.getTime())) return "";
  const hrs = Math.max(0, Math.round((Date.now() - d.getTime()) / 3_600_000));
  if (hrs < 1) return "just now";
  if (hrs < 24) return `${hrs}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function NewspaperPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch("/api/newspaper")
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setData(d)))
      .catch((e) => setError(e.message));
  }, []);

  return (
    <>
      <h1>📰 Daily Newspaper</h1>
      <p className="lede">
        {data ? (
          <>
            Today's headlines from <a href={data.sourceUrl} target="_blank" rel="noopener noreferrer">{data.source}</a> — a real, public daily,
            organized by section. Headline + link only; tap through to read the full story on their site.
          </>
        ) : (
          "Today's headlines from a real, public daily newspaper, organized by section."
        )}
      </p>

      {error && <div className="error-box">{error}</div>}
      {!data && !error && <div className="loading">Fetching today's headlines…</div>}

      {data?.sections.map((section, i) => (
        <CollapsibleSection title={section.label} meta={`${section.items.length} headline${section.items.length === 1 ? "" : "s"}`} defaultOpen={i === 0} key={section.id}>
          {section.error && <p className="section-hint">Couldn't load this section right now ({section.error}).</p>}
          {section.items.length === 0 && !section.error && <p className="section-hint">No headlines right now.</p>}
          {section.items.map((item, j) => (
            <div key={j} style={{ padding: "6px 0", borderBottom: "1px solid var(--rule)" }}>
              <a href={item.link} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13.5 }}>
                {item.title}
              </a>
              <div style={{ fontSize: 11, color: "var(--ink-soft)", marginTop: 2 }}>
                {item.category && <>{item.category} · </>}
                {timeAgo(item.pubDate)}
              </div>
            </div>
          ))}
        </CollapsibleSection>
      ))}
    </>
  );
}
