"use client";

import { useEffect, useState } from "react";

// Candidate locked topics to show per paper -- only the ones nearest the
// student's current frontier are worth buying (further-out ones would
// just be more expensive versions of the same idea); mirrors the Papers
// page's own FADE_WINDOW concept for "how much of the locked chain to
// even show."
const CANDIDATES_PER_PAPER = 3;

function ShopItem({ item, seeds, onPurchased }) {
  const [quote, setQuote] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [bought, setBought] = useState(false);

  useEffect(() => {
    fetch(`/api/shop/quote?subtopicId=${encodeURIComponent(item.id)}`)
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setQuote(d.quote)))
      .catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  function buy() {
    setBusy(true);
    setError(null);
    fetch("/api/shop/purchase", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subtopicId: item.id }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) return setError(d.error);
        setBought(true);
        onPurchased(d.pricePaid);
      })
      .finally(() => setBusy(false));
  }

  if (bought) {
    return (
      <div className="card" style={{ marginBottom: 8, borderTop: "3px solid var(--forest)" }}>
        <b>{item.topicText}</b>
        <p style={{ fontSize: 12.5, color: "var(--forest)", margin: "4px 0 0" }}>
          Unlocked for 48h -- open it now while it's active.{" "}
          <a href={`/learn/${item.id}`}>Go →</a>
        </p>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div>
          <b>{item.topicText}</b>
          <div style={{ fontSize: 11.5, color: "var(--ink-soft)" }}>
            Locked behind: {item.requiredSubtopicText} ({item.currentMasteryPct}%/{item.requiredMasteryPct}%)
          </div>
        </div>
        {quote && (
          <button className="btn btn-primary" onClick={buy} disabled={busy || seeds < quote.price}>
            {busy ? "Buying…" : `🌱 ${quote.price} -- Unlock 48h`}
          </button>
        )}
      </div>
      {quote && seeds < quote.price && (
        <p style={{ fontSize: 11.5, color: "var(--maroon)", margin: "4px 0 0" }}>Not enough seeds.</p>
      )}
      {error && <div className="error-box" style={{ marginTop: 6, fontSize: 12 }}>{error}</div>}
    </div>
  );
}

export default function ShopPage() {
  const [subtopicsData, setSubtopicsData] = useState(null);
  const [seeds, setSeeds] = useState(0);
  const [error, setError] = useState(null);

  function load() {
    fetch("/api/subtopics")
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setSubtopicsData(d.subtopics)))
      .catch((e) => setError(e.message));
    fetch("/api/pvp/state")
      .then((r) => r.json())
      .then((d) => !d.error && setSeeds(d.seeds))
      .catch(() => {});
  }
  useEffect(load, []);

  const lockedByPaper = {};
  if (subtopicsData) {
    for (const s of subtopicsData) {
      if (!s.locked) continue;
      const key = `${s.subjectId}::${s.paper}`;
      (lockedByPaper[key] ??= []).push(s);
    }
  }
  const items = Object.values(lockedByPaper).flatMap((arr) => arr.slice(0, CANDIDATES_PER_PAPER));

  return (
    <>
      <h1>🌱 Seed Shop</h1>
      <p className="lede">
        Spend seeds to unlock a locked topic 48 hours early. Price scales with how far along you already are (a
        seed sink, not free) and how many topics the unlock skips past in that paper's real order -- the very next
        topic is cheap, a topic ten steps ahead is not.
      </p>
      <p style={{ fontWeight: 600, marginBottom: 12 }}>🌱 {seeds} seeds</p>

      {error && <div className="error-box">{error}</div>}
      {!subtopicsData && !error && <div className="loading">Loading the shop…</div>}
      {subtopicsData && items.length === 0 && <p className="lede">Nothing locked right now -- you're at the frontier of every paper.</p>}

      {items.map((item) => (
        <ShopItem key={item.id} item={item} seeds={seeds} onPurchased={(price) => setSeeds((s) => s - price)} />
      ))}
    </>
  );
}
