"use client";

// Reusable collapsible "tree" section for in-page content that has real
// grouping data (papers by group, subtopics by section, guide themes) --
// see app/globals.css's .tree-node/.tree-node-body for the shared open/
// close treatment components/AppNav.jsx's nav groups also build on. A
// native <details>/<summary> under the hood -- accessible and keyboard-
// operable for free, no open/close state needed here.
export default function CollapsibleSection({ title, meta, defaultOpen = false, children }) {
  return (
    <details className="tree-node" open={defaultOpen}>
      <summary>
        <span>{title}</span>
        {meta && <span style={{ fontSize: 12, fontWeight: 400, color: "var(--ink-soft)" }}>{meta}</span>}
      </summary>
      <div className="tree-node-body">{children}</div>
    </details>
  );
}
