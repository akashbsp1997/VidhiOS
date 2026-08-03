# VidhiOS Adaptive

A subtopic-by-subtopic adaptive practice engine for UPSC CSE Law Optional. One
question at a time — never a batch — and each graded answer shapes the next
question: weak, high-yield subtopics get served most often; strong ones still
resurface occasionally, at a harder tier. Built on the same 81-topic syllabus
and 168 real 2023-25 PYQs as [VidhiOS](../vidhios), its sibling offline PWA.

**Read `docs/ARCHITECTURE.md` before you dig into the code** — it explains
the adaptive algorithm, what the AI grading can and can't be trusted for, and
why the "official source scanning" is a curated registry rather than an
autonomous crawler. That context will save you time.

## What's real vs. what needs you

This was built in a sandbox with no npm registry access and no outbound
network from code execution, so:
- ✅ **Tested and verified**: the adaptive engine (mastery/tier/selection
  logic), the AI-response parsing/normalization, the HTML/text-extraction
  helpers, the 81 syllabus topics + 168 PYQs (reused from VidhiOS, already
  cross-validated), 18 hand-verified official source URLs, every file's
  syntax and every import path across the whole repo.
- ⚠️ **Written correctly but not executable here, so smoke-test after
  deploy**: anything that touches a live Postgres connection or calls the
  real OpenRouter API (i.e., most of `app/api/*`) — these are ordinary Next.js
  + Drizzle + fetch code, not exotic, but "should work" isn't "verified
  working" until it's run against your real database and key.

## 1. Set up Supabase

1. Create a free project at [supabase.com](https://supabase.com).
2. Project Settings → Database → copy the **Connection pooling** string
   (port 6543, pgbouncer) — this is your `DATABASE_URL`.

## 2. Configure environment

```bash
cp .env.example .env.local
# fill in DATABASE_URL and GOOGLE_AI_API_KEY
```

Get a free Google AI Studio key at
[aistudio.google.com/apikey](https://aistudio.google.com/apikey) — no card
required. The app calls Google's Gemini API directly with this key (text via
`gemini-3.5-flash`, diagram images via `gemini-3.1-flash-image`), not through
OpenRouter — see "Costs to expect" below for why, and for what happens when
the free tier's quota runs out.

## 3. Create tables + seed data

**No terminal needed:** after deploying (step below), visit
`https://<your-app>.vercel.app/api/setup?key=<SETUP_SECRET>` once in any
browser. It creates every table and loads the 81 subtopics / 168 PYQs / 18
starter sources. Safe to revisit — won't duplicate data.

**If you do have a terminal:**

```bash
npm install
npm run db:push     # creates all tables from db/schema.js
npm run seed        # loads 81 subtopics, 168 PYQs, 18 starter sources
```

## 4. Run locally

```bash
npm run dev
# open http://localhost:3000
```

Try: Dashboard loads with mastery bars → click "Start adaptive practice" →
a question loads → submit a short answer → confirm you get back a score and
feedback, and mastery/tier updates on the dashboard afterward. That loop
touching DB + AI successfully is the real smoke test.

## Deploy (Vercel)

```bash
vercel deploy --prod
```

Then in the Vercel project settings, add the same environment variables
(`DATABASE_URL`, `GOOGLE_AI_API_KEY`, `CRON_SECRET`) under **Settings →
Environment Variables**. The weekly source-refresh cron (`vercel.json`) picks
up automatically on deploy — check your plan's cron limits if you change the
schedule.

## Push to GitHub

This repo is already `git init`-ed with an initial commit (see below). To
push it:

```bash
cd vidhios-adaptive
git remote add origin https://github.com/<your-username>/<repo-name>.git
git branch -M main
git push -u origin main
```

## Costs to expect

Every submitted answer triggers one text model call (grading); reaching a
new subtopic×tier combination for the first time triggers one more (question
generation); and each *module's* first Teach/Grasp visit triggers one text
call each, plus one image call on first Remember visit (see
`docs/ARCHITECTURE.md` for the per-module lazy-generation model — nothing
generates a whole subtopic or paper up front). All of this calls Google's
Gemini API directly (`gemini-3.5-flash` text, `gemini-3.1-flash-image`
images) with your own `GOOGLE_AI_API_KEY`, so cost follows Google's own free
tier, not a third-party balance.

**This app used to route through OpenRouter** (as a BYOK pass-through to the
same Google key) instead of calling Google directly. That was dropped
2026-07-22 after a live failure showed BYOK doesn't actually avoid needing a
funded account: OpenRouter pre-authorizes every request against its own
credit *balance* using the model's list price × `max_tokens`, before ever
reaching the linked key — so a $0 OpenRouter balance blocks every call
outright ("requires more credits") regardless of BYOK's fee-free allowance,
since actual near-zero billing never comes into it if the pre-flight check
never lets the request through. Calling Google directly removes that
middleman gate entirely.

Google's free tier has its own daily and per-minute quotas (they vary by
model and change without notice — check
https://ai.google.dev/gemini-api/docs/rate-limits for current numbers rather
than trusting a number here). Every call has a 25s client-side timeout —
short enough that, on a route with GROQ_API_KEY configured, a Gemini timeout
still leaves real room for the Groq fallback to run before the route's own
serverless time limit hits — and retries a transient rate limit or 5xx up
to 4 times with exponential backoff (2s/4s/8s/15s, ~29s total — see
`lib/ai/client.js`); a non-transient **daily
quota exhaustion** fails fast with a clear "today's free quota is used up,
try later or enable billing" error instead of retrying pointlessly —
surfaced to the student wherever that call happens (grading, question
generation, lesson/module content) rather than a generic failure. If you
outgrow the free tier, enable billing on the same Google Cloud project at
https://aistudio.google.com — no code change needed, the same key keeps
working.

**Optional automatic fallback to Groq**: set `GROQ_API_KEY` (free, no card
required — https://console.groq.com/keys) and every text call (grading,
questions, lesson/module content — not image generation, Groq doesn't serve
one) automatically retries against Groq's `openai/gpt-oss-120b` if Gemini
fails for any reason after exhausting its own retries — a fully separate
account/quota/infrastructure from Google's, so a Gemini-side demand spike or
exhausted daily quota doesn't have to mean a failed grading attempt. Leave
`GROQ_API_KEY` unset to keep the previous behavior exactly (Gemini's own
error surfaces directly, no fallback attempted).

**Other ways to stretch the free tier further without paying:**
- **Multiple keys, automatically pooled**: set `GOOGLE_AI_API_KEY_2`,
  `_3`, `_4` (and/or `GROQ_API_KEY_2`/`_3`/`_4`) — see `.env.example`. Each
  extra Gemini key should come from its own Google Cloud project, since
  Google's free quota is per-project, not per-account; one Google account
  can hold several projects, each with its own independent allocation. This
  is legitimate (each is a real project you created, not a fake account),
  and `lib/ai/client.js` automates the juggling itself: every text/image
  call tries all configured, not-currently-cooling-down keys for that
  provider in random order before falling through to the next tier (Gemini
  pool → Groq pool). Leave the numbered vars unset to use just the one key,
  exactly as before this existed. Google could still tighten free-tier
  policy for accounts it judges are gaming quota this way, so don't overdo
  it — a couple of extra keys, not dozens.
- **Not implemented, and not recommended:** scraping the consumer Gemini web
  app (gemini.google.com) instead of the real API. That's not a documented,
  stable interface, it's against Google's terms of service, and it can get
  the underlying Google account flagged — a real API key with a real quota
  is the only approach this app uses or suggests.

## Extending the source registry

`db/seed/sources.js` currently covers 14 of the ~20 highest-PYQ-frequency
subtopics. To add more:

1. Find the real, official URL (India Code for bare acts, the relevant
   ministry/court/UN site for everything else) — don't guess a URL, verify it
   loads.
2. Add a row to `db/seed/sources.js` (or insert directly via
   `npm run db:studio`'s table editor).
3. Re-run `npm run seed`, or hit "Fetch now" on that subtopic's `/sources`
   page.

## Project structure

```
db/schema.js              Drizzle schema (subtopics, sources, pyqs, model_questions, attempts, mastery)
db/seed/                  Seed data: syllabus, PYQs, starter sources
lib/adaptive/engine.js    Pure adaptive logic (mastery, tiers, selection) — unit tested
lib/ai/                   OpenRouter API client, grading, question generation
lib/sources/              Fetch + text-extraction pipeline
app/api/                  attempt (next question / grade), sources, cron
app/                      Dashboard, practice (adaptive + per-subtopic), source browser
docs/ARCHITECTURE.md      Design rationale — read this
```

