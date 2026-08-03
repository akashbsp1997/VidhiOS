// Embedded visual sequence ahead of the prose -- historical chronology
// (real dates) OR a staged/phased process (e.g. India's three-stage
// nuclear programme, a policy transmission mechanism) OR an ordered
// achievement list, whichever this module's real content actually is (see
// lib/ai/generateModules.js's buildModuleTeachSystem -- timelineEvents is
// an empty array for the vast majority of modules that aren't any of
// these). A single horizontally-scrollable row with a connecting line,
// same visual language as components/LevelMap.jsx.
export default function Timeline({ events }) {
  if (!events?.length) return null;

  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "flex-start",
          gap: 26,
          overflowX: "auto",
          padding: "6px 8px 4px",
        }}
      >
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: 24,
            right: 24,
            top: 7,
            height: 3,
            background: "var(--rule)",
            zIndex: 0,
          }}
        />
        {events.map((e, i) => (
          <div key={i} style={{ position: "relative", zIndex: 1, flex: "0 0 auto", width: 140, textAlign: "center" }}>
            <div style={{ width: 16, height: 16, borderRadius: "50%", background: "var(--primary)", margin: "0 auto 6px" }} />
            <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--primary)" }}>{e.date}</div>
            <div style={{ fontSize: 12, marginTop: 2 }}>{e.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
