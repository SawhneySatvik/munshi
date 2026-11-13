# Sarthi v1: the one-night build and launch plan

Working name below is **Sarthi**. The new name lives in one brand file, so renaming is a find-and-replace, not a refactor.

## The bet in one paragraph

A life-reset app that logs your whole day from one sentence and has a coach that actually remembers you. The memory is yours: you can see it, edit it, export it and delete it. **Bring your own brain:** run it on your own AI key, your OpenRouter account, a local model, your ChatGPT plan, or from inside ChatGPT and Claude, or pay for the hosted brain. One codebase runs on any Postgres and any host. The wedge against Life Reset (estimated about $200K a month, and its reviews are 34.5% complaints about price and paywall) is three things it can't do: adapt, remember, and log a day in one sentence.

## What "bring your own brain" can and cannot be, as of November 2026

| Brain mode | How it works | Status for us | Tonight? |
|---|---|---|---|
| **Hosted** | Our API key, with per-user daily cost caps | Fully ours | Yes. This is the paid tier |
| **Your own API key** | OpenAI, Anthropic, Gemini or any OpenAI-compatible endpoint (Groq, Together, DeepSeek). The key stays in the browser by default | Fully ours | Yes |
| **OpenRouter one-click** | OAuth PKCE gives the user a key with a credit limit, in one click, no password handling ([OpenRouter docs](https://openrouter.ai/docs/use-cases/oauth-pkce)) | Self-serve | Yes. This is the smoothest BYOK |
| **Custom endpoint** | Any OpenAI-compatible base URL the server can reach (a user's own hosted Ollama, vLLM, Groq) | Self-serve | Yes, as an advanced BYOK option |
| **Sign in with ChatGPT (spend the plan)** | OIDC + PKCE. The user's Plus or Pro allowance pays for model calls ([OpenAI cookbook](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt), [loginwith.ai guide](https://loginwith.ai/developers/chatgpt)) | Self-serve only for open-source, locally run apps. A **hosted closed-source app like ours needs OpenAI's limited partner trial**; apply through the interest form ([OpenAI help](https://help.openai.com/en/articles/20001542)) | Apply tonight; adapter behind a flag until approved |
| **Inside ChatGPT** | Our server is an MCP App: tools + memory + UI widgets; ChatGPT's model is the brain and the user's plan pays | App directory open since Dec 2025 ([OpenAI](https://openai.com/blog/developers-can-now-submit-apps-to-chatgpt)). Digital-goods checkout inside ChatGPT is not available, so paid tiers link out to our site | Yes, in developer mode; submit for review this week |
| **Inside Claude** | The same MCP server as a remote connector with MCP Apps UI | MCP Apps is production-ready and Claude supports it ([The Decoder](https://the-decoder.com/mcp-apps-the-model-context-protocols-first-official-extension-turns-ai-responses-into-interactive-interfaces/)). Directory submissions open since Sep 2026 ([Claude docs](https://claude.com/docs/connectors/building/submission)) | Yes as a custom connector; submit this week |
| ~~Claude subscription login~~ | Using a Claude consumer plan's OAuth in a third-party app | **Banned** by Anthropic since Feb 2026, enforced since Apr 2026 ([WinBuzzer](https://winbuzzer.com/2026/02/19/anthropic-bans-claude-subscription-oauth-in-third-party-apps-xcxwbn/)) | Never. Claude users come in through the connector |

**What this implies for the business (decided: closed source, hosted only):**
- **"Sign in with ChatGPT" plan spending needs OpenAI's partner approval** for a hosted closed-source app. Apply on day 1 and build the adapter behind a flag. Until approval, BYOK and OpenRouter one-click cover users who want to use their own model.
- **"Your memory is yours" has to be shown, not proven by source code:** a memory screen, full export, real deletion, and a short plain-language data page.
- **BYOK users still pay for good software.** TypingMind (a BYOK interface that passed $1M in trailing-12-month revenue) is the precedent.
- **One MCP server is the cross-platform layer.** The same tools power our app, ChatGPT and Claude.
- **Staying portable across databases and hosts keeps leverage** (move off any vendor in an afternoon), even without a self-host product.

## Architecture: ports and adapters

```
apps/web  (Next.js 16, PWA, standalone output → Docker anywhere)
 ├─ UI: Today · Capture · Coach · Memory · Journey · Settings
 ├─ /api/*            app API
 ├─ /mcp              MCP server (Streamable HTTP) + MCP Apps UI resources
 └─ /api/cron/tick    one endpoint any scheduler can call

packages/core   framework-free domain logic: capture → confirm → typed writes,
                4 domains, game (XP, streaks, 66-day arcs), coach, memory
packages/brain  ModelPort: AI SDK provider registry, BYOK, OpenRouter OAuth,
                ChatGPT plan adapter (flagged), custom OpenAI-compatible, fake brain
packages/db     Drizzle, Postgres dialect only; drivers: PGlite (embedded,
                pgvector) | postgres.js (Supabase, Neon, RDS, self-hosted)
packages/mcp    tool definitions + widget resources, reused by app and MCP
```

| Port | Default adapter | Alternatives (env switch) |
|---|---|---|
| Database | PGlite (zero setup for dev and tests) | Any Postgres URL: Supabase, Neon, RDS, Docker |
| Auth | Better Auth + Drizzle (email link, Google). Also acts as the OAuth 2.1 provider ChatGPT and Claude log in through ([Better Auth OAuth provider](https://better-auth.com/docs/plugins/oauth-provider)) | "Continue with ChatGPT" OIDC once approved |
| Model | Fake brain (deterministic, keyless) | Hosted, BYOK, OpenRouter, custom endpoint, ChatGPT plan (once approved) |
| Speech to text | Browser Web Speech API (free, Hindi + English) | Provider transcription through the model port |
| Files (meal and receipt photos) | Local disk | Any S3-compatible API: R2, S3, Supabase Storage, MinIO |
| Jobs | Postgres job table + `/api/cron/tick` | Vercel cron, GitHub Actions, system cron |
| Email | Console in dev | Resend or SMTP |

Rules carried over from both codebases:
- money in paise or cents, never floats;
- nothing estimated is written without a confirm card;
- every write can be undone;
- the fake brain runs every flow, and no test calls a real model;
- provider names never appear in `core` or `db`.

## Memory v1 (the restart's point)

From the research: two planes, a confirm gate, and a nightly pass.

| Table | What it holds |
|---|---|
| `profile` | One short, user-editable "about me" block, always loaded |
| `goals`, `commitments` | First-class rows ("₹15K monthly food budget", "100 h of system design by March") |
| `memory_facts` | `slot_key`, text, `valid_from`/`valid_to`, `superseded_by`, source (`stated`, `confirmed`, `inferred`), sensitivity, `confidence_bps`, `embedding` (nullable), `tsv`, `use_count`, `last_cited_at`, `retired` |
| `memory_proposals` | Inferred or sensitive facts waiting for the user's Keep or Discard |
| `memory_ops` | Append-only audit: add, supersede, retire, cite |
| `consents` | Per-purpose consent (health, money, photos), as India's DPDP rules require |
| `coach_sessions` | Messages + a rolling summary per session |

- **Writing:**
  - after each coach turn and capture, extraction runs;
  - something explicit and not sensitive is written directly;
  - anything implied or sensitive becomes a proposal card;
  - the same `slot_key` supersedes by rule (no model decides that).
- **Reading:**
  - always load: profile, active goals, a 7-day stats card;
  - then the top facts by full-text search, plus vector search when available, plus recency, plus pins;
  - memory is fenced as untrusted data, and the model cites fact IDs;
  - `use_count` rises only when a reply cites the fact.
- **Coach tools:** `query_logs`, `search_memory`, `fact_history`, `propose_memory`, `propose_plan_change`.
- **Nightly, or on next app open for browser-key users:**
  - summarise the day;
  - deduplicate;
  - propose profile updates;
  - weekly insight proposals.
- **Memory screen:** "What I know about you", where every fact can be viewed, edited, retired and exported. This screen is the trust feature to show in the demo video.
- **Evals:** 10 personas × 6 question types (recall, update, contradiction, temporal, abstain, don't-apply), run against the fake brain in CI and against a real brain on demand.

## v1 scope tonight

**In:**
- Onboarding quiz → 66-day plan (the Life Reset funnel, without the ambush paywall).
- One capture bar (voice, text, photo) → confirm cards → Health, Money, Habits, Skills.
- Today with arcs, XP and streaks.
- Coach with memory v1 and a morning brief.
- Memory screen.
- Export and delete.
- Brain settings (all modes above).
- MCP server with 6 tools and 2 widgets (log confirm card, Today card).
- PWA install.
- Landing page + waitlist + pricing page.

**Out (week 2+):** native apps, Health Connect / HealthKit, social features, investing, Razorpay checkout (pre-orders go through a payment link tonight), push notifications beyond local reminders.

## The 10 hours

The build runs as one integrator plus parallel agents in separate worktrees after hour 1. Each block ends with a check that has to pass before the next block starts.

| Hours | Work | Done when |
|---|---|---|
| 0–1 | New repo; pnpm workspace; brand file; ports and contracts; Drizzle Postgres schema (domains + memory + auth); PGlite driver; fake brain; CI (typecheck, lint, test) | `pnpm dev` boots on PGlite with no env; CI green |
| 1–4 (parallel) | **A:** port capture, domains, game and onboarding from Sarthi `core/` onto the new schema. **B:** memory v1 + coach agent + tools + eval skeleton. **C:** brain package: AI SDK registry, BYOK, OpenRouter OAuth, local endpoint, ChatGPT-plan adapter behind a flag, per-user caps. **D:** UI shell: port tokens, components and art; Today, Capture, Coach, Memory, Settings; PWA | Each agent's tests are green on the fake brain |
| 4–5 | Integrate A–D; fix seams; end-to-end flow: speak a sentence → confirm → Today updates → coach recalls it tomorrow | A Playwright end-to-end test passes keyless |
| 5–6.5 | MCP server at `/mcp`: 6 tools, 2 MCP Apps widgets, Better Auth OAuth for ChatGPT and Claude | MCP Inspector passes; connects in ChatGPT developer mode and as a Claude custom connector |
| 6.5–7.5 | Auth on; export and delete; consents; hosted-brain caps; Dockerfile + `docker compose` (Postgres) + a Vercel config | `docker compose up` works; Vercel preview works |
| 7.5–8.5 | Deploy; live smoke test on each brain mode; fix what breaks | One real day logged by you, end to end, on the live URL |
| 8.5–10 | Launch kit: landing copy, demo video script, Show HN post, Product Hunt draft, ChatGPT and Claude directory listings, "Sign in with ChatGPT" partner application, 15 short-video hooks, pricing page | Everything drafted in `docs/launch/` |

A realistic expectation: 10 hours gets a v1 that you and 20–50 beta users can live in. Directory reviews take days to weeks, so ChatGPT and Claude listings go live later. They only work in developer mode tonight.

## Getting it to people

**Positioning.** "Reset your life in 66 days with a coach that actually remembers you. Say your day in one sentence. Your memory, your model, your data."

**Who first:**
1. **ChatGPT and Claude power users who want a coach with memory they control.** They are the fastest to reach (Hacker News, X, Reddit) and are fine with BYOK.
2. **The Life Reset audience: self-improvement, 18–30.** Reached through short video.
3. **Young Indian professionals** who will speak Hinglish, priced in rupees.

| When | Channel | What |
|---|---|---|
| Tonight | X + LinkedIn | Build in public: "Rebuilding my AI life coach in one night: bring your own brain, memory you can see." Post progress every 2 hours with screenshots |
| Day 1–2 | Show HN | "A life coach whose memory you can see and edit, running on your own key or inside ChatGPT and Claude." Must be tryable without sign-up (demo mode). Post on a weekday morning, US time |
| Day 1–3 | r/selfimprovement, r/getdisciplined, r/ChatGPT, r/ClaudeAI | A 66-day-reset story for the first two; the "your coach inside ChatGPT and Claude" angle for the last two. Follow each subreddit's self-promotion rules |
| Day 2–7 | ChatGPT app directory, Claude directory | Submit both. Listing copy and screenshots come from the launch kit |
| Daily from day 1 | Shorts, Reels, TikTok | Screen recordings: "I log my whole day in one sentence", "Day N of my 66-day reset", "My AI coach remembered my budget". English and Hinglish versions. Count what gets saved and shared, not views |
| Week 1–2 | Play Store | Wrap the PWA as a Trusted Web Activity (Bubblewrap). Store keywords: life reset, 66 day challenge, AI habit tracker |
| Week 2 | Product Hunt | After a week of beta fixes, with the waitlist as the first upvoters |

**Pricing to start with** (one-tap changes, test them):
- **Free:** bring your own brain (your key, OpenRouter, or inside ChatGPT and Claude) with every feature, on our hosted app.
- **Pro** (hosted brain, nightly memory, photo logging, sync): **$4.99/month or $34.99/year**, India **₹149/month or ₹999/year**.
- **Founding member lifetime:** first 200 people at **$59 / ₹2,999**. That brings cash in now and tests whether people pay.

BYOK users still pay for good software (TypingMind's business is exactly that), so watch whether they ask to.

**Numbers to watch from day 1:**
- **Activation:** 3 entries logged on day 1.
- **Habit:** logging on 4 of the first 7 days.
- **Memory:** proposals kept vs discarded.
- **Money:** pre-orders.
- **The checkpoints from the comparison report still apply:** strangers paying by week 6; at least 40% "very disappointed", a third of beta users still active in week 4, and 10 payers by week 12.

## Risks to manage tonight

- **This environment's network blocks model APIs.** The build and tests run on the fake brain. Live checks happen on the deployed URL, or the environment allows the four model hosts (approval prompt) with keys added through the secure form.
- **Hosted "Sign in with ChatGPT" depends on OpenAI approving us.** The product cannot depend on it; OpenRouter and BYOK cover the same need today.
- **ChatGPT apps can't sell digital subscriptions in-app.** The ChatGPT surface is for distribution; payment happens on our site.
- **Health data:** stay off Health Connect and HealthKit in v1 to avoid the Play health-app declaration until later.
- **Scope creep is the real enemy at hour 6.** Anything not in "v1 scope tonight" goes to `docs/later.md`.
