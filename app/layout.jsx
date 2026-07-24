import "./globals.css";
import LogoutButton from "../components/LogoutButton.jsx";
import OfflineSupport from "../components/OfflineSupport.jsx";
import OfflineStatusChip from "../components/OfflineStatusChip.jsx";
import { getSessionUserId } from "../lib/supabase/server.js";

export const metadata = {
  title: "VidhiOS Adaptive — Law Optional Mastery Engine",
  description: "Subtopic-by-subtopic adaptive practice for UPSC CSE Law Optional, grounded in official sources and real PYQs.",
  manifest: "/manifest.json",
};

export default async function RootLayout({ children }) {
  const userId = await getSessionUserId();

  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <div className="inner">
            <a className="brand" href="/">
              <b>Vidhi</b>OS <span style={{ fontSize: 13, opacity: 0.7 }}>Adaptive</span>
            </a>
            {userId && (
              <nav className="toplinks" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16, rowGap: 8 }}>
                <a href="/">Dashboard</a>
                <a href="/plan">Plan</a>
                <a href="/guide">Guide</a>
                <a href="/readiness">Readiness</a>
                <a href="/results">Results</a>
                <a href="/current-affairs">Current affairs</a>
                <a href="/practice">Practice</a>
                <a href="/answer-architect">Answer Architect</a>
                <a href="/fill-blanks">Fill the Blanks</a>
                <a href="/essay">Essay</a>
                <a href="/prelims">Prelims</a>
                <a href="/quant">Quant</a>
                <a href="/mock-tests">Mock tests</a>
                <a href="/flashcards">Flashcards</a>
                <a href="/interview">Interview</a>
                <LogoutButton />
                <OfflineStatusChip />
              </nav>
            )}
          </div>
        </header>
        <div className="shell">{children}</div>
        <OfflineSupport />
      </body>
    </html>
  );
}
