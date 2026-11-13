# Kickoff: a new AI life-reset product, from ideation to a locked plan

You are my product and engineering partner on a new consumer AI product. This repo is empty on purpose. **We start at the ideation stage.** In this session, run a rigorous planning process with me, phase by phase, and lock the concept, features, decisions and scope **before any product code is written**. Nothing below is locked unless I say so. My earlier choices are starting positions to confirm or overturn.

## Me and my constraints

- **Situation:** solo founder, bootstrapped, building alongside a full-time job. Normally 10–15 hours a week, with occasional long build nights.
- **Market:** global, with the **US as the primary market**. I'm based in India, which matters for company setup, payments and tax.
- **Skills:** strong full-stack TypeScript engineer (Next.js, Postgres/Supabase, Drizzle, Vercel AI SDK, PWAs). I build fast with coding agents.
- **Starting positions (re-decide in Phase 4):**
  - closed source, hosted product;
  - no lock-in to any AI provider, model, database or host;
  - users can bring their own brain (their API key, OpenRouter, their ChatGPT plan, or use the product from inside ChatGPT and Claude) or pay for a hosted brain;
  - working name "Sarthi", real name to be chosen.

## The idea space and the previous attempt

The previous attempt is **Sarthi v0**: https://github.com/SawhneySatvik/Sarthi

I built it in five days for OpenAI Build Week in July 2026. It is a voice-and-photo AI life coach inspired by the **Life Reset** app (https://apps.apple.com/us/app/life-reset-66-day-habit/id6478942469):
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

Before Phase 1, read these and copy them into `docs/research/`:
- Solo founders with $1M+ apps: https://github.com/SawhneySatvik/munshi/blob/claude/ecstatic-fermi-lgmad8/reports/Solo%20founders%20with%20million%20dollar%20apps.md
- Sarthi vs Munshi comparison, including the market, both codebases and the memory design: https://github.com/SawhneySatvik/munshi/blob/claude/ecstatic-fermi-lgmad8/reports/Sarthi%20vs%20Munshi%20as%20solo%20bets.md
- Earlier v1 build plan, to treat as earlier thinking, not decisions: https://github.com/SawhneySatvik/munshi/blob/claude/ecstatic-fermi-lgmad8/reports/Sarthi%20v1%20build%20plan.md
- The sources behind all three: https://github.com/SawhneySatvik/munshi/tree/claude/ecstatic-fermi-lgmad8/research_notes

The earlier research leaned toward India; this product is now **US-first and global**, so re-weight it accordingly.

Key facts from that research are below, as of November 2026. Re-check anything you rely on, because platform rules change fast.

**Life Reset, the reference competitor**
- **Who:** Savvy Tech Ltd, Hong Kong, apparently two indie developers, launched March 2024. https://buildwith.app/apps/rise
- **Revenue:** estimated about US$203K a month on about 71K downloads a month, around Oct 2026. This is one tracker's estimate. Meta ads are its confirmed channel. https://www.airbridge.io/en/app-revenue/life-reset
- **Product and pricing:** a single 66-day quest plan with XP and streaks across sleep, water, exercise, mind, screen time and cold showers. A long quiz leads into a hard paywall, about $29–60 a year with a 7-day trial. https://operatorstandardreview.com/life-reset-app-review
- **Reviews:** in one review sample, 34.5% complain about price or the paywall. Others report lost progress, billing after cancelling, and shallow game mechanics.
  - https://operatorstandardreview.com/life-reset-app-review
  - https://justuseapp.com/en/app/6478942469/rise-life-reset-in-66-days/reviews

**Category economics, and why US-first**
- **Health & Fitness trial-to-paid:** median 37.7% in 2026. https://sahha.ai/blog/health-app-monetization-first-month/
- **Revenue per install by day 60:** about $0.66, versus $0.31 across all categories. India and Southeast Asia: $0.11. https://www.revenuecat.com/state-of-subscription-apps
- **Annual value per payer:** $23 globally vs $14 in India/SEA. https://www.revenuecat.com/state-of-subscription-apps
- **What US-first means in installs** (the research's estimate at median economics): about $3K MRR needs roughly 4,600 US-weighted installs a month, versus about 27,000 India-weighted ones.
- **Hard paywall vs freemium:** 10.7% vs 2.1% of downloads paying by day 35. https://chuvak-pavel.medium.com/state-of-app-monetization-2026-key-trends-from-revenuecat-and-adapty-8bdc23a4bb6f
- **AI apps:** earn 41% more per payer, but keep 21.1% of annual subscribers at 12 months vs 30.7% for non-AI apps. https://techcrunch.com/2026/03/10/ai-powered-apps-struggle-with-long-term-retention-new-report-shows
- **How rare success is:**
  - about 5% of Health & Fitness apps reach $10K in total revenue within two years: https://www.revenuecat.com/state-of-subscription-apps-2025
  - raw day-30 retention is about 3–4%: https://fitnessrefined.co/fitness-app-retention-statistics/

**Competition**
- **Finch:** bootstrapped, about $1M a month (Sensor Tower estimate, Jun 2026).
  - https://app.sensortower.com/overview/1528595748?country=US
  - https://review-rounds.com/finch-business-model-bootstrapped-self-care-pet-app/
- **Opal:** $10M ARR with 11 people. https://www.speedinvest.com/knowledge/scaling-smart-how-opal-built-a-10m-arr-business-in-just-2-years
- **Rosebud:** AI journal with memory, about $6M raised, dropped its free plan in Sep 2026. https://aiolum.com/story/rosebud/
- **ChatGPT Health** launched in Jan 2026. https://www.fortune.com/2026/01/07/openai-launches-chatgpt-health-in-a-push-to-become-a-hub-for-personal-health-data
- **ChatGPT's improved memory** reached free users in Jun 2026. https://9to5mac.com/2026/06/04/openai-says-chatgpts-memory-feature-is-getting-smarter-and-coming-to-free-users/
- **Claude and Gemini memory** are free in 2026 (secondary sources).
  - https://lumichats.com/blog/claude-memory-2026-complete-guide-how-to-use
  - https://www.datacamp.com/blog/gemini-personal-intelligence
- **Gap:** no app found that logs health, money, habits and skills together.

**Platform rules for "bring your own brain"**
- **Sign in with ChatGPT** lets a user spend their ChatGPT plan inside third-party apps (announced Sep 29, 2026). It is self-serve only for open-source, locally run apps; hosted commercial apps need OpenAI's limited partner trial.
  - https://thenewstack.io/sign-in-with-chatgpt/
  - https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt
  - https://help.openai.com/en/articles/20001542
- **ChatGPT apps:** the directory has accepted submissions since Dec 17, 2025.
  - https://openai.com/blog/developers-can-now-submit-apps-to-chatgpt
  - Digital subscriptions can't be sold inside ChatGPT, so payment links out to our site: https://community.openai.com/t/chatgpt-app-monetization-apps-sdk/1372343
- **MCP Apps,** the standard for interactive UI inside AI chats, became official on Jan 26, 2026; ChatGPT and Claude support it. https://the-decoder.com/mcp-apps-the-model-context-protocols-first-official-extension-turns-ai-responses-into-interactive-interfaces/
- **The Claude directory** opened submissions in Sep 2026. https://claude.com/docs/connectors/building/submission
- **Anthropic** forbids using Claude consumer-subscription logins in third-party apps (Feb 2026, enforced Apr 2026). https://winbuzzer.com/2026/02/19/anthropic-bans-claude-subscription-oauth-in-third-party-apps-xcxwbn/
- **OpenRouter OAuth PKCE** gives users a one-click key with a credit limit. https://openrouter.ai/docs/use-cases/oauth-pkce

**Memory**
- **The 2026 consensus:**
  - a small profile that is always loaded;
  - new facts are extracted, then reconciled against existing ones;
  - facts are superseded with time stamps, never deleted;
  - a nightly consolidation pass;
  - the agent searches memory with simple tools.
  - Sources:
    - https://arxiv.org/abs/2504.19413
    - https://www.letta.com/blog/benchmarking-ai-agent-memory
    - https://www.letta.com/blog/sleep-time-compute/
    - https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool
- **For this stack:** build on Postgres with pgvector instead of buying a memory service. Query structured logs with SQL; never embed raw log rows. Mem0's open-source version is the only drop-in that fits TypeScript plus Postgres. https://github.com/mem0ai/mem0
- **Sycophancy:** memory profiles raised agreement-sycophancy by 33–45% in some models, so design against it.
  - https://arxiv.org/html/2509.12517
  - https://writer.com/engineering/personalized-context-degrades-ai-accuracy/
- **Benchmarks:** public ones (LoCoMo, LongMemEval) are saturated and disputed, so we need our own evaluation set.
  - https://arxiv.org/abs/2402.17753
  - https://radar.zurb.com/article/the-benchmark-answer-key-had-a-64-percent-error-rate-so-stop-trusting-the-score

**Solo-founder base rates**
- Bootstrapped companies take a median of about 3.5 years to reach $1M ARR. https://chartmogul.com/reports/saas-growth-vc-bootstrapped/
- Full-time founders grow 2.2× faster than part-time ones. https://microconf.com/founders/0-10k-arr
- The winners had distribution before or alongside the product.

## How we work: phases and gates

At every gate:
- produce the artifact;
- summarise it in 10 lines or fewer;
- ask me to approve or change it, using the question tool with 2–4 options and your recommendation first;
- record each locked decision in `docs/decisions.md` with the date, the options and the reason.

Do not pass a gate without my explicit approval.

**Phase 0: load context. No questions yet.**
- Read the research and skim v0:
  - README: https://github.com/SawhneySatvik/Sarthi/blob/main/README.md
  - PRD: https://github.com/SawhneySatvik/Sarthi/blob/main/docs/product/PRD.md
  - capture pipeline: https://github.com/SawhneySatvik/Sarthi/tree/main/core/capture
  - coach: https://github.com/SawhneySatvik/Sarthi/tree/main/core/coach
  - schema: https://github.com/SawhneySatvik/Sarthi/tree/main/data/schema
- Output `docs/00-context.md`, one page: what we know, what we don't, what in v0 is worth reusing, and the 10 most important open questions.

**Phase 1: ideate wide, then converge. (Gate 1)**
- Generate 5 genuinely different product concepts in the "AI that helps you change your life" space, aimed at US and global users. Sarthi v0 is one. The others should differ in user, wedge, surface or business model. Examples: a coach that lives inside ChatGPT and Claude; a voice-first daily logger for busy professionals; a skill-mastery tracker for self-learners; a 66-day reset for Gen Z built for TikTok distribution; something better that you find.
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
  - time to the first dollar.
- Then score the concepts, and steelman the strongest rival to my favourite.
- Output `docs/01-concepts.md`. At the gate I pick one concept or a merge.

**Phase 2: users, problem, assumptions. (Gate 2)**
- One primary persona, at most one secondary.
- Jobs to be done and switching triggers.
- Real quotes from public reviews and threads (Life Reset, Finch, Rosebud, Reddit), with full links.
- An assumption log ranked by risk × uncertainty. For the top 5, a test I can run in a week for at most US$100, with pass/fail thresholds.
- Output `docs/02-users-and-assumptions.md`.

**Phase 3: product definition and locked scope. (Gate 3)**
- The core loop, and an aha moment within the first two minutes.
- A feature brainstorm, then must/should/could/won't, then a v1 scope that fits a fixed build budget. Propose the hour budget.
- An explicit "not in v1" list.
- Onboarding and paywall design that learns from Life Reset's paywall complaints.
- Success metrics (activation, day-7 and day-30 retention, conversion) and kill criteria with dates.
- A name shortlist of 5–8 with reasons, suited to a US audience. I will do the trademark and domain checks.
- Output `docs/03-product.md`.

**Phase 4: decisions and architecture. (Gate 4)**
- A short decision record for each of these (decision, options, choice, reason, what would make us revisit it):
  - platform: PWA, iOS first, Android first, or cross-platform such as Expo (the US skews toward iPhone);
  - which brain modes ship at launch;
  - auth;
  - how to stay portable across database and host;
  - memory design;
  - real speech-to-text, English first;
  - photos;
  - payments and company setup for selling to the US from India:
    - App Store and Play billing;
    - web checkout through Stripe, or a merchant of record such as Paddle or Lemon Squeezy to handle global sales tax;
    - whether I need a US entity;
  - analytics;
  - privacy and health-data rules: GDPR, US state privacy laws, Washington's My Health My Data Act, the FTC Health Breach Notification Rule, App Store and Play health-data policies, and whether India's DPDP Act applies to me as an India-based operator;
  - AI cost controls;
  - safety boundaries for health and money advice.
- Then:
  - `docs/04-architecture.md`, with the data model;
  - `docs/04-memory.md`, with an evaluation plan;
  - a pre-mortem: "it is six months later and this failed; why?"

**Phase 5: go-to-market, before any code. (Gate 5)**
- Positioning for US users.
- A plan for the first 100 users.
- Channels I can run part-time from India's time zone.
- A content plan with 20 concrete hooks.
- The launch sequence.
- Pricing experiments, US-first, with regional pricing later.
- A one-page metrics dashboard.
- Output `docs/05-gtm.md`.

**Phase 6: implementation plan. (Gate 6, then we build)**
- Vertical slices. Each must be something a user can see, with acceptance criteria.
- **Slice 1 is the thinnest real end-to-end loop:** real speech-to-text, a real write, a real memory written and recalled, deployed. Fakes are allowed only in tests, never in the product path.
- Testing in proportion to risk.
- Output `docs/06-plan.md` and a lean `CLAUDE.md` holding the invariants and these working agreements.

## Working agreements

- Recommend, don't just list options. Be blunt. Push back on scope creep and on building before validating.
- Ask me only about decisions that are genuinely mine. Decide the rest and tell me what you decided.
- Check fast-moving facts (platform policies, pricing, APIs) on the web. Cite every source with its full URL and date, and label estimates as estimates.
- Keep every document under two pages, in plain language. No agent meshes, no ticket bureaucracy, and no process documents beyond the ones listed here.
- Every feature must name the user behaviour it changes and how we will measure that.
- Never claim in docs or a README something the product does not actually do.

Start with Phase 0 now.
