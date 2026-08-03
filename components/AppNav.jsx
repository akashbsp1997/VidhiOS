"use client";

import { useState } from "react";
import LogoutButton from "./LogoutButton.jsx";
import OfflineStatusChip from "./OfflineStatusChip.jsx";

// The former flat 15-link topbar, regrouped (per explicit request: "cluttered,"
// "grouped under various tabs... open like a tree") -- Dashboard stays
// standalone since it's the one link every session actually starts from.
const NAV_GROUPS = [
  {
    label: "Study",
    links: [
      { href: "/plan", label: "Plan" },
      { href: "/practice", label: "Practice" },
      { href: "/guide", label: "Guide" },
      { href: "/ncert-chapters", label: "NCERT Chapters" },
      { href: "/current-affairs", label: "Current affairs" },
      { href: "/quant", label: "Quant" },
      { href: "/prelims", label: "Prelims" },
    ],
  },
  {
    label: "Games",
    links: [
      { href: "/answer-architect", label: "Answer Architect" },
      { href: "/fill-blanks", label: "Fill the Blanks" },
      { href: "/flashcards", label: "Flashcards" },
      { href: "/arena", label: "Arena" },
      { href: "/map", label: "World Map" },
      { href: "/shop", label: "Seed Shop" },
    ],
  },
  {
    label: "Exams",
    links: [
      { href: "/mock-tests", label: "Mock tests" },
      { href: "/essay", label: "Essay" },
      { href: "/interview", label: "Interview" },
    ],
  },
  {
    label: "Progress",
    links: [
      { href: "/readiness", label: "Readiness" },
      { href: "/results", label: "Results" },
    ],
  },
  {
    // A second, self-contained product living in this app -- see
    // db/schema.js's "Legal Case Manager" section header. Kept as its own
    // top-level group rather than folded into "Study" since it's for
    // running a real case, not exam prep.
    label: "Legal Case Manager",
    links: [
      { href: "/legal", label: "Dashboard" },
      { href: "/legal/upload", label: "Upload a document" },
      { href: "/legal/cases/new", label: "New case" },
    ],
  },
];

// Each group is a native <details>/<summary> -- accessible and keyboard-
// operable with zero extra open/close state, styled as a dropdown on
// desktop (see app/globals.css's .nav-group-panel) and as a stacked
// accordion inside the mobile drawer below -- same taxonomy, same markup,
// just repositioned by CSS breakpoint so there's only one thing to maintain.
function NavGroup({ group }) {
  return (
    <details className="nav-group">
      <summary>{group.label}</summary>
      <div className="nav-group-panel">
        {group.links.map((l) => (
          <a key={l.href} href={l.href}>
            {l.label}
          </a>
        ))}
      </div>
    </details>
  );
}

export default function AppNav() {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="app-nav">
      {/* Desktop: inline dropdowns -- hidden below the 769px breakpoint via CSS. */}
      <nav className="app-nav-desktop">
        <a className="nav-link" href="/">
          Dashboard
        </a>
        {NAV_GROUPS.map((g) => (
          <NavGroup key={g.label} group={g} />
        ))}
        <OfflineStatusChip />
        <LogoutButton />
      </nav>

      {/* Mobile: hamburger + slide-in drawer -- hidden at/above 769px via CSS. */}
      <div className="app-nav-mobile">
        <OfflineStatusChip />
        <button
          className="app-nav-mobile-toggle"
          aria-label={drawerOpen ? "Close menu" : "Open menu"}
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen((o) => !o)}
        >
          {drawerOpen ? "✕" : "☰"}
        </button>
      </div>

      {drawerOpen && (
        <>
          <div className="app-nav-backdrop" onClick={() => setDrawerOpen(false)} />
          <div className="app-nav-drawer">
            <a className="nav-link" href="/" onClick={() => setDrawerOpen(false)}>
              Dashboard
            </a>
            {NAV_GROUPS.map((g) => (
              <NavGroup key={g.label} group={g} />
            ))}
            <div style={{ marginTop: 12 }}>
              <LogoutButton />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
