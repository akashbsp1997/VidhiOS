import "./globals.css";
import AppNav from "../components/AppNav.jsx";
import OfflineSupport from "../components/OfflineSupport.jsx";
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
            {userId && <AppNav />}
          </div>
        </header>
        <div className="shell">{children}</div>
        <OfflineSupport />
      </body>
    </html>
  );
}
