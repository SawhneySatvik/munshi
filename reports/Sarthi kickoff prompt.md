# Kickoff: a new AI life-reset product, from ideation to a locked plan

You are my product and engineering partner on a new consumer AI product. This repo is empty on purpose. **We start at the ideation stage.** In this session, run a rigorous planning process with me, phase by phase, and lock the concept, features, decisions and scope **before any product code is written**. Nothing below is locked unless I say so. My earlier choices are starting positions to confirm or overturn.

## Me and my constraints

- **Situation:** solo founder, bootstrapped, building alongside a full-time job. Normally 10–15 hours a week, with occasional long build nights.
- **Market:** based in India. I want an Indian and a global audience.
- **Skills:** strong full-stack TypeScript engineer (Next.js, Postgres/Supabase, Drizzle, Vercel AI SDK, PWAs). I build fast with coding agents.
- **My known failure mode:** I over-build and under-validate. My last two projects had zero real users. Hold me to users and revenue, not lines of code.
- **Starting positions (re-decide in Phase 4):**
  - closed source, hosted product;
  - no lock-in to any AI provider, model, database or host;
  - users can bring their own brain (their API key, OpenRouter, their ChatGPT plan, or use the product from inside ChatGPT and Claude) or pay for a hosted brain;
  - working name "Sarthi", real name to be chosen.

## The idea space and the previous attempt

The previous attempt is **Sarthi v0** (public: github.com/SawhneySatvik/Sarthi). I built it in five days for OpenAI Build Week in July 2026. It is a voice-and-photo AI life coach inspired by the **Life Reset** app:
- You say one sentence, like "spent ₹340 on lunch, 2 rotis and dal, 90 min of system design, woke at 5:10".
- It files entries into Health, Money, Habits and Skills.
- Anything estimated waits on a confirm card.
- A coach adapts your plan and is meant to remember you.

Treat v0 as reference material and a parts bin, not as the spec. We may land somewhere different.

An audit of v0 found these problems. **None may be repeated:**
- voice input was faked: it always returned the demo sentence;
- the coach could read memories, but nothing in production ever wrote one;
- photo storage failed in production;
- there was no billing and no real users;
- about 41% of the lines were process documents.

## Research inputs

Before Phase 1, read these:
- **Research reports.** If `docs/research/` is empty, copy them in from github.com/SawhneySatvik/munshi, branch `claude/ecstatic-fermi-lgmad8`: `reports/Solo founders with million dollar apps.md`, `reports/Sarthi vs Munshi as solo bets.md` and `reports/Sarthi v1 build plan.md`.
- **Sources behind them:** the `research_notes/` folders on the same branch.
- **Treat the v1 build plan as earlier thinking, not decisions.**

Key facts from that research are below, as of November 2026. Re-check anything you rely on, because platform rules change fast.

**Life Reset**
- **Who:** Savvy Tech Ltd, Hong Kong, apparently two indie developers, launched March 2024.
- **Revenue:** estimated about US$203K a month on about 71K downloads a month (Airbridge, around Oct 2026; one tracker's estimate).
- **Product:** a single 66-day quest plan with XP and streaks across sleep, water, exercise, mind, screen time and cold showers. A long quiz leads into a hard paywall, about $29–60 a year with a 7-day trial.
- **Reviews:** 34.5% of a review sample complain about price or the paywall. Others report lost progress, billing after cancelling, and shallow game mechanics.
- **Acquisition:** Meta ads.

**Category economics (RevenueCat 2026)**
- **Health & Fitness trial-to-paid:** median 37.7%.
- **Revenue per install by day 60:** $0.66, versus $0.31 across all categories. India and Southeast Asia: $0.11.
- **Annual value per payer:** $14 in India/SEA vs $23 globally.
- **Hard paywall vs freemium:** 10.7% vs 2.1% of downloads paying.
- **AI apps:** earn 41% more per payer, but keep 21.1% of annual subscribers at 12 months vs 30.7% for non-AI apps.
- **How rare success is:** about 5% of Health & Fitness apps reach $10K in total revenue within two years. Raw day-30 retention is about 3–4%.

**Competition**
- **Finch:** bootstrapped, about $1M a month (estimate, Jun 2026).
- **Opal:** $10M ARR with 11 people.
- **Rosebud:** AI journal with memory, about $6M raised, dropped its free plan in Sep 2026.
- **Free assistants:**
  - ChatGPT Health launched in Jan 2026.
  - ChatGPT's improved memory reached free users in Jun 2026.
  - Claude and Gemini memory are free.
- **Gap:** no app found that logs health, money, habits and skills together.

**India**
- Typical prices are ₹199–599 a year or ₹99–399 a month.
- UPI Autopay works with Play and App Store billing.
- Seekho made ₹141.5 Cr in FY25 revenue but spent ₹134 Cr on marketing.

**Platform rules for "bring your own brain"**
- **Sign in with ChatGPT** lets a user spend their ChatGPT plan inside third-party apps (announced Sep 29, 2026). It is self-serve only for open-source, locally run apps; hosted commercial apps need OpenAI's limited partner trial.
- **ChatGPT apps:** the directory has accepted submissions since Dec 17, 2025. Digital subscriptions can't be sold inside ChatGPT, so payment links out to our site.
- **MCP Apps,** the standard for interactive UI inside AI chats, became official on Jan 26, 2026; ChatGPT and Claude support it. The Claude directory opened submissions in Sep 2026.
- **Anthropic** forbids using Claude consumer-subscription logins in third-party apps (Feb 2026, enforced Apr 2026).
- **OpenRouter OAuth PKCE** gives users a one-click key with a credit limit.

**Memory**
- **The 2026 consensus:**
  - a small profile that is always loaded;
  - new facts are extracted, then reconciled against existing ones;
  - facts are superseded with time stamps, never deleted;
  - a nightly consolidation pass;
  - the agent searches memory with simple tools.
- **For this stack:** build on Postgres with pgvector instead of buying a memory service. Query structured logs with SQL; never embed raw log rows.
- **Sycophancy:** memory profiles raised agreement-sycophancy by 33–45% in some models, so design against it.
- **Benchmarks:** public ones (LoCoMo, LongMemEval) are saturated and disputed, so we need our own evaluation set.

**Solo-founder base rates**
- Bootstrapped companies take a median of about 3.5 years to reach $1M ARR.
- Full-time founders grow 2.2× faster than part-time ones.
- The winners had distribution before or alongside the product.

## How we work: phases and gates

At every gate:
- produce the artifact;
- summarise it in 10 lines or fewer;
- ask me to approve or change it, using the question tool with 2–4 options and your recommendation first;
- record each locked decision in `docs/decisions.md` with the date, the options and the reason.

Do not pass a gate without my explicit approval.

**Phase 0: load context. No questions yet.**
- Read the research and skim v0 (README, `docs/product/PRD.md`, `core/capture`, `core/coach`, `data/schema`).
- Output `docs/00-context.md`, one page: what we know, what we don't, what in v0 is worth reusing, and the 10 most important open questions.

**Phase 1: ideate wide, then converge. (Gate 1)**
- Generate 5 genuinely different product concepts in the "AI that helps you change your life" space. Sarthi v0 is one. The others should differ in user, wedge, surface or business model. Examples: a coach that lives inside ChatGPT and Claude; a Hinglish voice-first logger; a skill-mastery tracker; a money-and-habits reset for young Indian professionals; something better that you find.
- For each concept, cover:
  - exactly who it is for;
  - the painful moment;
  - what they use today and why they would switch;
  - why now;
  - the aha moment;
  - a distribution path I can run part-time;
  - how it makes money;
  - the single biggest risk.
- Agree the scoring weights with me first. The criteria:
  - reachable distribution;
  - part-time feasibility and support load;
  - evidence that people pay;
  - defensibility against free ChatGPT/Claude/Gemini memory and against Life Reset;
  - founder fit;
  - time to the first rupee or dollar.
- Then score the concepts, and steelman the strongest rival to my favourite.
- Output `docs/01-concepts.md`. At the gate I pick one concept or a merge.

**Phase 2: users, problem, assumptions. (Gate 2)**
- One primary persona, at most one secondary.
- Jobs to be done and switching triggers.
- Real quotes from public reviews and threads (Life Reset, Finch, Rosebud, Reddit), with links.
- An assumption log ranked by risk × uncertainty. For the top 5, a test I can run in a week for at most ₹5,000, with pass/fail thresholds.
- Output `docs/02-users-and-assumptions.md`.

**Phase 3: product definition and locked scope. (Gate 3)**
- The core loop, and an aha moment within the first two minutes.
- A feature brainstorm, then must/should/could/won't, then a v1 scope that fits a fixed build budget. Propose the hour budget.
- An explicit "not in v1" list.
- Onboarding and paywall design that learns from Life Reset's paywall complaints.
- Success metrics (activation, day-7 and day-30 retention, conversion) and kill criteria with dates.
- A name shortlist of 5–8 with reasons. I will do the trademark and domain checks.
- Output `docs/03-product.md`.

**Phase 4: decisions and architecture. (Gate 4)**
- A short decision record for each of these (decision, options, choice, reason, what would make us revisit it):
  - platform: PWA, Play Store wrapper, native or Expo;
  - which brain modes ship at launch;
  - auth;
  - how to stay portable across database and host;
  - memory design;
  - real speech-to-text, including Hindi and Hinglish;
  - photos;
  - payments in India (UPI Autopay, Play Billing, Razorpay) and globally;
  - analytics;
  - privacy and India's DPDP rules (consent, export, erasure);
  - AI cost controls;
  - safety boundaries for health and money advice.
- Then:
  - `docs/04-architecture.md`, with the data model;
  - `docs/04-memory.md`, with an evaluation plan;
  - a pre-mortem: "it is six months later and this failed; why?"

**Phase 5: go-to-market, before any code. (Gate 5)**
- Positioning.
- A plan for the first 100 users.
- Channels I can run part-time.
- A content plan with 20 concrete hooks.
- The launch sequence.
- Pricing experiments for India and global.
- A one-page metrics dashboard.
- Output `docs/05-gtm.md`.

**Phase 6: implementation plan. (Gate 6, then we build)**
- Vertical slices. Each must be something a user can see, with acceptance criteria.
- **Slice 1 is the thinnest real end-to-end loop:** real speech-to-text, a real write, a real memory written and recalled, deployed. Fakes are allowed only in tests, never in the product path.
- Testing in proportion to risk.
- Output `docs/06-plan.md` and a lean `CLAUDE.md` holding the invariants and these working agreements.

## Working agreements

- Recommend, don't just list options. Be blunt. Push back on scope creep and on my urge to build before validating.
- Ask me only about decisions that are genuinely mine. Decide the rest and tell me what you decided.
- Check fast-moving facts (platform policies, pricing, APIs) on the web. Cite sources with dates and label estimates as estimates.
- Keep every document under two pages, in plain language. No agent meshes, no ticket bureaucracy, and no process documents beyond the ones listed here.
- Every feature must name the user behaviour it changes and how we will measure that.
- Never claim in docs or a README something the product does not actually do.

Start with Phase 0 now.
