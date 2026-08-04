"use client";

import { useState } from "react";
import LogoutButton from "./LogoutButton.jsx";
import OfflineStatusChip from "./OfflineStatusChip.jsx";

// Decluttered to exactly 6 flat links (per explicit request: "declutter the
// real estate... don't need so many icons and information," "study and
// game merge"). No more dropdown groups -- 6 items needs no grouping, and
// study/game being one thing means there's no separate "Games" category
// left to group. Everything that isn't one of these 6 (Plan, Guide, NCERT
// Chapters, Readiness, Results, Quant, Prelims Arcade, Mock tests,
// Interview, Fill the Blanks, Flashcards, Arena, Alliances, World Map,
// Seed Shop) still exists and is still reachable -- "tucked away neatly"
// under app/page.jsx's own "More" section (a single CollapsibleSection),
// not deleted, just no longer primary nav.
const NAV_LINKS = [
  { href: "/", label: "Your Estate" },
  { href: "/practice", label: "Practice" },
  { href: "/answer-architect", label: "Answer writing" },
  { href: "/essay", label: "Essay writing" },
  { href: "/newspaper", label: "Newspaper" },
  { href: "/current-affairs", label: "Current affairs" },
];

export default function AppNav() {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="app-nav">
      {/* Desktop: inline links -- hidden below the 769px breakpoint via CSS. */}
      <nav className="app-nav-desktop">
        {NAV_LINKS.map((l) => (
          <a key={l.href} className="nav-link" href={l.href}>
            {l.label}
          </a>
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
            {NAV_LINKS.map((l) => (
              <a key={l.href} className="nav-link" href={l.href} onClick={() => setDrawerOpen(false)}>
                {l.label}
              </a>
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
