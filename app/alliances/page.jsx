"use client";

import { useEffect, useState } from "react";

function CreateForm({ onCreated }) {
  const [name, setName] = useState("");
  const [tag, setTag] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    fetch("/api/alliances", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, tag }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) return setError(d.error);
        onCreated();
      })
      .finally(() => setBusy(false));
  }

  return (
    <form onSubmit={submit} className="card" style={{ marginBottom: 16 }}>
      <h2 style={{ marginTop: 0 }}>Found an alliance</h2>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          placeholder="Alliance name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          style={{ flex: 2, minWidth: 160 }}
        />
        <input
          placeholder="Tag (e.g. VAJRA)"
          value={tag}
          onChange={(e) => setTag(e.target.value.toUpperCase())}
          maxLength={5}
          style={{ flex: 1, minWidth: 100 }}
        />
        <button className="btn btn-primary" disabled={busy || !name || !tag}>
          {busy ? "Founding…" : "Found →"}
        </button>
      </div>
      {error && <div className="error-box" style={{ marginTop: 8 }}>{error}</div>}
    </form>
  );
}

function MyAlliance({ alliance, onLeft }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function leave() {
    setBusy(true);
    setError(null);
    fetch("/api/alliances/leave", { method: "POST" })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) return setError(d.error);
        onLeft();
      })
      .finally(() => setBusy(false));
  }

  return (
    <div className="card" style={{ marginBottom: 16, borderTop: "3px solid var(--forest)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <h2 style={{ margin: 0 }}>
          [{alliance.tag}] {alliance.name}
        </h2>
        <button className="btn" style={{ fontSize: 12, padding: "4px 10px" }} onClick={leave} disabled={busy}>
          {busy ? "Leaving…" : "Leave"}
        </button>
      </div>
      <p style={{ fontSize: 13, color: "var(--ink-soft)", margin: "6px 0 10px" }}>
        {alliance.memberCount} member{alliance.memberCount === 1 ? "" : "s"} · 🌲 {alliance.totalMature} mature plants total · 🌱{" "}
        {alliance.totalSeeds} seeds banked
      </p>
      {error && <div className="error-box" style={{ marginBottom: 8 }}>{error}</div>}
      {alliance.members
        .slice()
        .sort((a, b) => b.matureCount - a.matureCount)
        .map((m) => (
          <div key={m.userId} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid var(--rule)", fontSize: 13 }}>
            <span>
              {m.role === "leader" && "👑 "}
              {m.label}
            </span>
            <span style={{ color: "var(--ink-soft)" }}>
              🌲 {m.matureCount} · 🌱 {m.seeds}
            </span>
          </div>
        ))}
    </div>
  );
}

function LeaderboardRow({ a, onJoin, joining }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--rule)" }}>
      <span style={{ fontSize: 13.5 }}>
        <b>
          [{a.tag}] {a.name}
        </b>
        <span style={{ color: "var(--ink-soft)", fontSize: 12, marginLeft: 6 }}>
          {a.memberCount} member{a.memberCount === 1 ? "" : "s"} · 🌲 {a.totalMature}
        </span>
      </span>
      {onJoin && (
        <button className="btn" style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => onJoin(a.id)} disabled={joining}>
          Join
        </button>
      )}
    </div>
  );
}

export default function AlliancesPage() {
  const [mine, setMine] = useState(undefined); // undefined = loading, null = not in one
  const [all, setAll] = useState(null);
  const [error, setError] = useState(null);
  const [joining, setJoining] = useState(false);

  function load() {
    fetch("/api/alliances/mine")
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setMine(d.alliance)))
      .catch((e) => setError(e.message));
    fetch("/api/alliances")
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setAll(d.alliances)))
      .catch((e) => setError(e.message));
  }
  useEffect(load, []);

  function join(allianceId) {
    setJoining(true);
    setError(null);
    fetch("/api/alliances/join", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ allianceId }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) return setError(d.error);
        load();
      })
      .finally(() => setJoining(false));
  }

  return (
    <>
      <h1>🛡️ Alliances</h1>
      <p className="lede">
        Kingshot-style guilds -- join or found one, compete on the leaderboard together, and never risk a PvP loss
        against your own alliance-mates. One alliance at a time.
      </p>

      {error && <div className="error-box">{error}</div>}
      {mine === undefined && <div className="loading">Loading…</div>}

      {mine === null && <CreateForm onCreated={load} />}
      {mine && <MyAlliance alliance={mine} onLeft={load} />}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Leaderboard</h2>
        {all == null && <p className="loading">Loading alliances…</p>}
        {all?.length === 0 && <p className="lede">No alliances yet -- found the first one above.</p>}
        {all?.map((a) => (
          <LeaderboardRow key={a.id} a={a} onJoin={mine ? null : join} joining={joining} />
        ))}
      </div>
    </>
  );
}
