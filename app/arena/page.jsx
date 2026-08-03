"use client";

import { useEffect, useRef, useState } from "react";
import MissionsPanel from "../../components/MissionsPanel.jsx";

const OPTION_LETTER = ["A", "B", "C", "D"];
const ESTATE_ICON = { garden: "🌱", orchard: "🌳", farm: "🌾", forest: "🌲" };
// Whole-round timer, not per-question -- this is one timed quiz, not a
// chain of separately-timed questions (see components/McqSession.jsx for
// that other pattern). Generous enough for 5 MCQs without feeling
// punishing, tight enough to still be "timed."
const ROUND_SECONDS = 75;

function StateHeader({ state, onRefresh }) {
  if (!state) return null;
  const tier = state.estateTier;
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <span style={{ fontSize: 15 }}>
          {ESTATE_ICON[tier.id]} <b>{tier.label}</b>
          <span style={{ fontSize: 12, color: "var(--ink-soft)", marginLeft: 6 }}>
            ({state.matureCount} mature plant{state.matureCount === 1 ? "" : "s"})
          </span>
        </span>
        <span style={{ fontSize: 13 }}>
          🌱 {state.seeds} seeds · overall mastery {Math.round(state.avgMastery * 100)}%
        </span>
      </div>
      <div style={{ marginTop: 8, fontSize: 12.5, color: "var(--ink-soft)" }}>
        {state.defenseScore == null ? (
          "No defense set yet -- set one so others can challenge you (and to unlock attacking them back)."
        ) : (
          <>
            Your defense: {state.defenseScore}/{state.defenseTotal} correct.
            {state.shielded && <span style={{ color: "var(--forest)", fontWeight: 700, marginLeft: 6 }}>🛡 Shielded until {new Date(state.shieldedUntil).toLocaleString()}</span>}
          </>
        )}
      </div>
    </div>
  );
}

// Shared by both "set your defense" and "attack an opponent" -- same shape
// (a timed round of MCQs), different submit target.
function QuizRound({ questions, timeLeft, answers, onAnswer }) {
  const timerPct = Math.max(0, Math.min(100, (timeLeft / ROUND_SECONDS) * 100));
  return (
    <>
      <div className="bar" style={{ marginBottom: 14 }} title={`${timeLeft}s left`}>
        <span style={{ width: `${timerPct}%`, background: timeLeft <= 15 ? "var(--maroon)" : undefined }} />
      </div>
      {questions.map((q, qi) => (
        <div className="card" key={qi} style={{ marginBottom: 10 }}>
          <div className="question-text" style={{ fontSize: 14.5 }}>
            {qi + 1}. {q.questionText}
          </div>
          <div style={{ marginTop: 8 }}>
            {q.options.map((opt, i) => (
              <button
                key={i}
                className={`seg${answers[qi] === i ? " active" : ""}`}
                style={{ display: "block", width: "100%", textAlign: "left", marginBottom: 6 }}
                onClick={() => onAnswer(qi, i)}
              >
                <b>{OPTION_LETTER[i]}.</b> {opt}
              </button>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

export default function ArenaPage() {
  const [state, setState] = useState(null);
  const [opponents, setOpponents] = useState(null);
  const [history, setHistory] = useState(null);
  const [error, setError] = useState(null);

  // 'idle' | 'defense' | 'attack'
  const [mode, setMode] = useState("idle");
  const [attackTarget, setAttackTarget] = useState(null); // { userId, label }
  const [questions, setQuestions] = useState(null);
  const [answers, setAnswers] = useState([]);
  const [timeLeft, setTimeLeft] = useState(ROUND_SECONDS);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const submitRef = useRef(null);

  function loadAll() {
    fetch("/api/pvp/state").then((r) => r.json()).then((d) => !d.error && setState(d));
    fetch("/api/pvp/opponents").then((r) => r.json()).then((d) => !d.error && setOpponents(d.opponents));
    fetch("/api/pvp/history").then((r) => r.json()).then((d) => !d.error && setHistory(d.battles));
  }
  useEffect(loadAll, []);

  useEffect(() => {
    if (mode === "idle" || result || submitting) return;
    if (timeLeft <= 0) {
      submitRef.current?.();
      return;
    }
    const t = setTimeout(() => setTimeLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [mode, result, submitting, timeLeft]);

  function startDefenseRound() {
    setError(null);
    fetch("/api/pvp/defense/start", { method: "POST" })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) return setError(d.error);
        setQuestions(d.questions);
        setAnswers(new Array(d.questions.length).fill(-1));
        setTimeLeft(ROUND_SECONDS);
        setResult(null);
        setMode("defense");
      });
  }

  function startAttackRound(opponent) {
    setError(null);
    fetch("/api/pvp/attack/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ defenderUserId: opponent.userId }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) return setError(d.error);
        setQuestions(d.questions);
        setAnswers(new Array(d.questions.length).fill(-1));
        setTimeLeft(ROUND_SECONDS);
        setResult(null);
        setAttackTarget(opponent);
        setMode("attack");
      });
  }

  function submitRound() {
    setSubmitting(true);
    const body = mode === "defense" ? { answers } : { defenderUserId: attackTarget.userId, answers };
    const url = mode === "defense" ? "/api/pvp/defense/submit" : "/api/pvp/attack/resolve";
    fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then((r) => r.json())
      .then((d) => {
        if (d.error) {
          setError(d.error);
          setMode("idle");
          return;
        }
        setResult(d);
        loadAll();
      })
      .finally(() => setSubmitting(false));
  }
  submitRef.current = submitRound;

  function backToIdle() {
    setMode("idle");
    setResult(null);
    setQuestions(null);
    setAttackTarget(null);
  }

  return (
    <>
      <h1>⚔️ Arena</h1>
      <p className="lede">
        Grow your estate by mastering topics, then test it against aspirants of comparable overall mastery. Only 🌱
        seeds are ever at stake -- your real mastery, growth, and decay are yours alone, win or lose.
      </p>

      {error && (
        <div className="error-box" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}

      <MissionsPanel />

      <StateHeader state={state} />

      {mode !== "idle" && !result && questions && (
        <div>
          <p style={{ fontWeight: 600, marginBottom: 8 }}>{mode === "defense" ? "Setting your defense…" : `Attacking ${attackTarget?.label}…`}</p>
          <QuizRound
            questions={questions}
            timeLeft={timeLeft}
            answers={answers}
            onAnswer={(qi, i) => setAnswers((prev) => prev.map((a, idx) => (idx === qi ? i : a)))}
          />
          <button className="btn btn-primary" onClick={submitRound} disabled={submitting}>
            {submitting ? "Submitting…" : "Submit round →"}
          </button>
        </div>
      )}

      {result && mode === "defense" && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>Defense set! 🛡</h2>
          <p className="lede" style={{ marginBottom: 10 }}>
            {result.score}/{result.total} correct -- this is your standing benchmark until you refresh it.
          </p>
          <button className="btn btn-primary" onClick={backToIdle}>
            Back to arena →
          </button>
        </div>
      )}

      {result && mode === "attack" && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>
            {result.outcome === "win" ? "Victory! 🏆" : result.outcome === "tie" ? "Tied 🤝" : "Defeated 💤"}
          </h2>
          <p className="lede" style={{ marginBottom: 10 }}>
            You scored {result.attackerScore}, {attackTarget?.label} defended with {result.defenderScore}.
            {result.outcome === "win" && (result.seedsLooted > 0 ? ` You looted 🌱 ${result.seedsLooted} seeds.` : " They had no seeds left to loot.")}
            {result.outcome !== "win" && " No seeds change hands on a loss or tie."}
          </p>
          <button className="btn btn-primary" onClick={backToIdle}>
            Back to arena →
          </button>
        </div>
      )}

      {mode === "idle" && (
        <>
          <div className="card" style={{ marginBottom: 16 }}>
            <h2 style={{ marginTop: 0 }}>Your defense</h2>
            <p className="lede" style={{ marginBottom: 10 }}>
              A fixed 5-question round. Whoever attacks you later takes the same questions and is compared against
              this score.
            </p>
            <button className="btn btn-primary" onClick={startDefenseRound}>
              {state?.defenseScore == null ? "Set your defense →" : "Refresh your defense →"}
            </button>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <h2 style={{ marginTop: 0 }}>Attack an opponent</h2>
            {opponents == null && <p className="loading">Finding opponents…</p>}
            {opponents?.length === 0 && (
              <p className="lede" style={{ marginBottom: 0 }}>
                No one in your comparable-mastery band has a defense up right now -- check back later.
              </p>
            )}
            {opponents?.map((o) => (
              <div key={o.userId} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--rule)" }}>
                <span style={{ fontSize: 13.5 }}>
                  {o.allianceTag && <b>[{o.allianceTag}] </b>}
                  {o.label} <span style={{ color: "var(--ink-soft)", fontSize: 12 }}>({Math.round(o.avgMastery * 100)}% mastery)</span>
                </span>
                <button className="btn" style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => startAttackRound(o)}>
                  ⚔️ Attack
                </button>
              </div>
            ))}
          </div>

          <div className="card">
            <h2 style={{ marginTop: 0 }}>Recent battles</h2>
            {history?.length === 0 && (
              <p className="lede" style={{ marginBottom: 0 }}>
                No battles yet.
              </p>
            )}
            {history?.map((b) => (
              <div key={b.id} style={{ fontSize: 13, padding: "4px 0", borderBottom: "1px solid var(--rule)" }}>
                {b.wasAttacker ? (
                  <>
                    You attacked {b.opponentLabel} -- {b.attackerScore} vs {b.defenderScore} ({b.outcome})
                    {b.seedsLooted > 0 && ` · looted 🌱 ${b.seedsLooted}`}
                  </>
                ) : (
                  <>
                    {b.opponentLabel} attacked you -- {b.attackerScore} vs {b.defenderScore} (
                    {b.outcome === "win" ? "loss" : b.outcome === "loss" ? "win" : "tie"})
                    {b.seedsLooted > 0 && ` · lost 🌱 ${b.seedsLooted}`}
                  </>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
