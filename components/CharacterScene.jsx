"use client";

// Two animated characters flanking a speech bubble -- explicit request for
// "an animated dragon and an animated human/user, information coming as
// bubbles." This app has no video/illustration generation (Gemini image
// calls here are deliberately flat-diagram-style, not character art -- see
// lib/ai/generateModules.js's buildModuleImagePrompt), so this is the real
// ceiling: CSS-animated emoji "characters" (continuous idle bob, not
// static) with dialogue delivered as a bubble that pops in per line
// instead of a paragraph block. `speaker` puts the active bubble on the
// guide's or the user's side; the other character dims slightly, same
// visual grammar a two-character comic panel uses to show who's talking.
export default function CharacterScene({ guideEmoji, guideLabel = "Guide", userEmoji = "🧑", speaker = "guide", bubbleKey, children }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 10, marginBottom: 14 }}>
      <div style={{ textAlign: "center", flexShrink: 0, opacity: speaker === "guide" ? 1 : 0.5, transition: "opacity 0.2s" }}>
        <div className="character-bob" style={{ fontSize: 46 }}>
          {guideEmoji}
        </div>
        <div style={{ fontSize: 9.5, color: "var(--ink-soft)", maxWidth: 60, lineHeight: 1.2 }}>{guideLabel}</div>
      </div>

      <div key={bubbleKey} className={`speech-bubble${speaker === "user" ? " speaker-user" : ""}`}>
        {children}
      </div>

      <div style={{ textAlign: "center", flexShrink: 0, opacity: speaker === "user" ? 1 : 0.5, transition: "opacity 0.2s" }}>
        <div className="character-bob" style={{ fontSize: 38, animationDelay: "0.4s" }}>
          {userEmoji}
        </div>
        <div style={{ fontSize: 9.5, color: "var(--ink-soft)" }}>You</div>
      </div>
    </div>
  );
}
