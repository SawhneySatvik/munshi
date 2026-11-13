# Long-term memory systems for LLM personal assistants and coaches: state of the art, November 2026, as input for a fresh Sarthi memory design

How this was researched (13 Nov 2026): this session's network blocked direct fetches of mem0.ai, atlan.com, help.openai.com and the GitHub API, so most product, pricing and benchmark facts come from web-search result summaries, not from the primary pages. The Anthropic memory-tool doc (platform.claude.com) is the only vendor doc fetched in full. Claims about foundational papers (Generative Agents, MemGPT, MemoryBank, LoCoMo, LongMemEval, A-MEM, the sleep-time paper, and the Mem0 and Zep papers) are tagged **[paper; prior knowledge, not re-fetched]** where the detail came from my own reading of the paper rather than from a source retrieved in this session. Treat those as "verify before quoting".

---

## 1. Taxonomy and design patterns: what exists, and what changed in 2025–2026

### Takeaway
The field has settled on a working-, episodic-, semantic- and procedural-memory split. The usual implementation is a small, always-loaded "core/profile" block plus searchable stores. A write pipeline extracts facts and resolves conflicts, and a background "sleep-time" job consolidates. The 2025–26 changes:
- Cheaper extraction: single-pass, add-only.
- Agentic, tool-based retrieval, including plain files.
- Temporal validity on facts.
- Nightly consolidation, which consumer products now ship.
- Evidence that memory can increase sycophancy.

### Cited Findings

**Taxonomy (foundations)**
- **Working memory** is the context window. **Episodic memory** is past interactions or experiences. **Semantic memory** is facts about the user and the world. **Procedural memory** is learned instructions or behaviour. LangMem (LangChain, Python SDK) implements exactly three long-term types: semantic facts, episodic past experiences, and procedural "prompt adaptation" that rewrites the agent's system prompt. All three are stored in a LangGraph BaseStore and retrieved by namespace, semantic similarity or key — [wiki.enola.dev LangMem summary](https://wiki.enola.dev/computer/ai/software/memory/langmem.md); [To Data & Beyond](https://youssefh.substack.com/p/managing-agentic-meomery-with-langmem)

**Generative Agents (Park et al., Apr 2023; UIST 2023)**
- Agents keep a "memory stream" of timestamped observations. Retrieval score = recency (exponential decay, factor 0.995 per sim-hour) + importance (LLM-rated 1–10 at write time) + relevance (embedding cosine), each normalized and summed. **Reflection** fires when the summed importance of recent events passes a threshold (150). It asks the LLM for high-level questions, retrieves evidence, and writes "insights" that cite the memories they came from. Insights go back into the stream, so reflections can build on reflections — [arXiv 2304.03442](https://arxiv.org/abs/2304.03442) **[paper; prior knowledge, not re-fetched]**

**MemGPT (Packer et al., Oct 2023), now Letta**
- Uses OS-style "virtual context management". The main context holds system instructions, an editable "working context" and a FIFO message queue. External context is recall storage (searchable message history) and archival storage (vector DB). The LLM moves data between tiers itself through function calls, and gets "memory pressure" warnings as context fills — [arXiv 2310.08560](https://arxiv.org/abs/2310.08560) **[paper; prior knowledge, not re-fetched]**
- A Letta "memory block" is a string the LLM rewrites in place via tool calls — [kenhuangus substack, 2026](https://kenhuangus.substack.com/p/how-ai-agents-actually-remember-inside)

**Sleep-time compute (Letta, Apr 2025)**
- Sleep-time agents shipped in Letta 0.7.0. Each agent is split into a primary agent and a sleep-time agent, and only the sleep-time agent has tools to edit the primary agent's memory blocks — [Letta blog: Sleep-time Compute](https://www.letta.com/blog/sleep-time-compute/)
- Paper results: precomputing "at sleep time" over a known context cut the test-time compute needed for equal accuracy by about 5× on Stateful GSM-Symbolic and Stateful AIME. More sleep-time compute raised accuracy by up to 13% and 18% on those sets. Amortizing over related queries cut average cost per query by 2.5× — [arXiv 2504.13171](https://arxiv.org/abs/2504.13171) **[paper; prior knowledge, not re-fetched]**
- A Letta Code page dated 20 Sep 2026 describes `/sleeptime` as configuring periodic consolidation ("dreaming") — [innfactory.ai on Letta Code](https://innfactory.ai/en/ai-harness/letta-code/)

**MemoryBank (Zhong et al., May 2023; AAAI 2024)**
- Applies an Ebbinghaus forgetting curve. Memory strength decays with time and is reinforced each time a memory is recalled. Demonstrated in the "SiliconFriend" companion chatbot, which also keeps hierarchical daily and global summaries plus a user-personality profile — [arXiv 2305.10250](https://arxiv.org/abs/2305.10250) **[paper; prior knowledge, not re-fetched]**

**A-MEM (Xu et al., Feb 2025; NeurIPS 2025)**
- A Zettelkasten-style "agentic memory". Each note has content, timestamp, LLM-generated keywords, tags, a context description, an embedding and links to related notes. Adding a note triggers link generation and "memory evolution", where existing notes' descriptions and tags are rewritten — [arXiv 2502.12110](https://arxiv.org/abs/2502.12110) **[paper; prior knowledge, not re-fetched]**
- In Mem0's April 2025 LoCoMo comparison, A-Mem scored lowest of the memory systems (48.4 J) — [arXiv 2504.19413](https://arxiv.org/abs/2504.19413) **[paper; prior knowledge, not re-fetched]**

**Mem0 (paper, Apr 2025): extract, then update**
- Phase 1: an LLM extracts candidate facts from the new exchange, using a rolling summary and recent messages as context.
- Phase 2: for each candidate, the top-s similar existing memories are retrieved (s = 10 in the paper). An LLM tool call picks **ADD / UPDATE / DELETE / NOOP**.
- Graph variant Mem0ᵍ: stores entity–relation triples (Neo4j). When a relation conflicts with a new one, Mem0ᵍ marks it invalid instead of deleting it.
- Headline claims: 91% lower p95 latency and more than 90% token-cost savings vs full-context, and a 26% relative LLM-judge gain over OpenAI memory on LoCoMo — [arXiv 2504.19413](https://arxiv.org/abs/2504.19413) (abstract figures confirmed via search, 13 Nov 2026)
- A critic argues the 90% token figure covers retrieval only, excludes the extraction LLM calls, and compares against raw history with no summarization — [dev.to/crabtalk](https://dev.to/crabtalk/mem0-what-three-memory-scopes-actually-cost-1kpc) (opinion)

**Mem0 2026 algorithm change (April 2026)**
- Mem0 released a "token-efficient memory algorithm" that uses **single-pass hierarchical extraction**: one LLM call that **only adds** (no per-fact UPDATE/DELETE adjudication). It is paired with "multi-signal retrieval": one retrieval call, one answer call, no agentic loop.
- A follow-up post added temporal reasoning.
- Self-reported scores: LongMemEval 94.4 (up from 67.8 for the old algorithm) at about 6,800 tokens per query; LoCoMo 92.5. Mem0 says these reflect the managed platform's proprietary optimizations, which the OSS SDK lacks — [Mem0 blog: token-efficient algorithm](https://mem0.ai/blog/mem0-the-token-efficient-memory-algorithm); [Mem0 blog: temporal reasoning](https://mem0.ai/blog/the-token-efficient-memory-algorithm-now-has-temporal-reasoning); [mem0 GitHub README](https://github.com/mem0ai/mem0) (via search summary; pages not fetched)
- Sources give conflicting figures for the same algorithm: 94.4, 94.8 and 93.4. One Mem0 post says a May update took it from 93.4% to 94.4% — [search summary of Mem0 pages](https://mem0.ai/blog/state-of-ai-agent-memory-2026)

**Zep / Graphiti (Rasmussen et al., Jan 2025): temporal knowledge graph**
- Graphiti builds three subgraphs: raw **episodes**, extracted **semantic entities/edges**, and **communities**.
- It is **bi-temporal**: event time T (when a fact was true: valid_at/invalid_at) is tracked separately from ingestion/transaction time T′ (created/expired).
- Contradicted facts are **invalidated, not deleted** — [AviAvni reading notes on the Zep paper](https://github.com/AviAvni/database-learning-path/blob/master/topics/38-graphrag-agent-memory/reading-zep-graphiti.md)
- Retrieval combines cosine, BM25 and graph BFS, then reranks with RRF, MMR, node distance or a cross-encoder — [arXiv 2501.13956](https://arxiv.org/abs/2501.13956) **[paper; prior knowledge, not re-fetched]**

**Filesystem as memory (2025–2026 trend)**
- Letta (12 Aug 2025): an agent given the LoCoMo history as plain files, with only grep / search_files / open / close tools, scored **74.0% with GPT-4o-mini**. That beat Mem0's reported 68.5% for its best graph variant. Letta's explanation is that models are heavily trained on filesystem operations from coding work — [Letta blog: Benchmarking AI agent memory](https://www.letta.com/blog/benchmarking-ai-agent-memory)
- Anthropic's API **memory tool** (`memory_20250818`, status "stable" in Nov 2026 docs) works the same way. Claude issues view / create / str_replace / insert / delete / rename commands against a `/memories` directory. The tool is **client-side**: your app maps the path onto any storage, such as per-user DB rows. The API auto-injects a "ALWAYS VIEW YOUR MEMORY DIRECTORY BEFORE DOING ANYTHING ELSE" protocol. Docs advise path-traversal checks, file-size caps, expiring unaccessed files and stripping sensitive data. The tool is ZDR- and HIPAA-eligible, and Anthropic pairs it with server-side compaction and context editing — [Claude docs: Memory tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool) (fetched 13 Nov 2026)

**Consumer products converged on two layers plus background consolidation**
- ChatGPT has "saved memories" (things the user asked it to remember) and "reference chat history" (insights gathered from past chats). These were announced 10 Apr 2025 — [OpenAI: Memory and new controls](https://openai.com/index/memory-and-new-controls-for-chatgpt/); [OpenAI community thread, Apr 2025](https://community.openai.com/t/chatgpt-can-now-reference-all-past-conversations-april-10-2025/1229453)
- An outside analysis says chat-history reference doesn't search past chats. Instead it keeps a recent-chats list and builds an evolving user profile — [Embrace The Red, 2025](https://embracethered.com/blog/posts/2025/chatgpt-how-does-chat-history-memory-preferences-work/) (third-party reverse-engineering)
- Claude's consumer memory processes memory updates **once daily**, so imported memories can take about 24 hours to appear — [search summary citing Anthropic help center](https://support.anthropic.com/en/articles/11817273-how-does-claude-s-memory-work)
- ChatGPT "Pulse" does asynchronous overnight research that synthesizes memory, chat history and feedback — [ChatGPT release notes](https://help.openai.com/en/articles/6825453-chatgpt-release-notes) (via search)

### Inferences
- Read through Sarthi's current design, the field's patterns map like this. `coach_memory` is semantic memory. Pinned rows act as a crude core block. `coach_messages` is raw episodic memory with no index. Sarthi has no episodic summaries, no procedural memory (coaching-style preferences), no temporal validity (only a "retired" flag), and no consolidation.
- The 2026 trend is not toward more exotic structures. It moves in two directions:
  - Simpler, cheaper write paths. Mem0's add-only single pass moves conflict handling to read time.
  - Smarter read paths: agentic search over files or tables, plus a nightly consolidation pass.
- For a solo developer this favours Postgres tables, a compact profile document and a nightly job over adopting a graph database.
- Generative-Agents-style reflection ("insights") carries the highest risk for a coach, because inferred insights about a person are the most likely to read as creepy or wrong (see section 4). Store them separately from user-stated facts and surface them as suggestions.

### Gaps
- Could not fetch Letta's 2026 changelog or confirm a "Letta V1" architecture; 2026 Letta claims rest on third-party pages.
- Could not fetch Mem0's April 2026 algorithm post directly, so the exact mechanics of "multi-signal retrieval" and the handling of contradictions without UPDATE/DELETE are unverified.
- A third-party blog claims OpenAI announced "ChatGPT Dreaming" (background memory consolidation) on 4 June 2026 — [memorylake.ai](https://www.memorylake.ai/en/blogs/chatgpt-dreaming-vs-claude-memory). A separate search of OpenAI-related sources found no such feature, so treat it as **unverified**.
- Several 2026 arXiv papers turned up by title only and were not read. Titles alone show the field turning toward personal-AI memory lifecycle and "behavioural specification" over raw recall: Mi-Memory (lifecycle framework for personal AI, [2607.18975](https://arxiv.org/pdf/2607.18975)), MemMachine ("ground-truth-preserving", [2604.04853](https://arxiv.org/pdf/2604.04853)), EverMemOS ([2601.02163](https://arxiv.org/pdf/2601.02163)), User as Code ([2606.16707](https://arxiv.org/pdf/2606.16707)), Beyond Recall ([2605.28969](https://arxiv.org/pdf/2605.28969)).

---

## 2. Products and libraries (Nov 2026): licences, self-hosting, TypeScript, pgvector, pricing

### Takeaway
Only Mem0 OSS (Apache-2.0, TypeScript SDK, pgvector backend) and the community langmem-ts port fit a TypeScript + Postgres/pgvector stack directly. Letta (Apache-2.0, TS SDK) is a whole agent server rather than a library. Graphiti requires a graph database (Neo4j/FalkorDB/Kuzu/Neptune, no Postgres) and is Python. Supermemory is effectively closed for self-hosting. Most comparison pages are vendor-written and disagree on details.

### Cited Findings
**Mem0**
- OSS library is Apache-2.0. Hosted Platform tiers: Hobby free (10,000 adds and 1,000 retrievals per month), Starter $19/mo, Pro $249/mo, Enterprise custom (as of Oct 2026). One source lists Starter at $20/mo via the Vercel Marketplace — [cognee.ai: Mem0 pricing](https://www.cognee.ai/mem0-pricing); [developersdigest: Mem0 OSS](https://www.developersdigest.tech/agent-memory/mem0-oss) (secondary; Cognee is a competitor)
- The OSS SDK supports more than 20 vector stores, including pgvector, Qdrant, Pinecone and Weaviate, and the Platform has TypeScript SDKs — [same search summary](https://www.developersdigest.tech/agent-memory/mem0-platform)
- Graph memory status conflicts. One source says it was removed from the OSS SDK and is Platform/Pro-only. Another says OSS still extracts entities for ranking but has no queryable graph — [search summary of comparison sites](https://www.cognee.ai/mem0-alternatives) (verify on GitHub)
- Mem0 says its benchmark scores reflect Platform-only proprietary optimizations — [Mem0 blog](https://mem0.ai/blog/mem0-the-token-efficient-memory-algorithm) (via search)

**Letta (formerly MemGPT)**
- Core is Apache-2.0, and the open-source framework and self-hosted server are free. Paid plans as listed by aggregators: Free; Pro $20/mo (flat); API plan (metered); Teams/Enterprise custom with RBAC and SSO — [costbench](https://www.costbench.com/software/ai-agent-platforms/letta/); [Letta docs: plans](https://docs.letta.com/guides/api/plans) (via search)
- Python and TypeScript SDKs — [developersdigest: Letta](https://www.developersdigest.tech/agent-memory/letta) (third-party)
- Self-hosting means running and maintaining a database backend for persistence — [costbench hidden costs](https://www.costbench.com/software/ai-agent-platforms/letta/hidden-costs/)

**Zep / Graphiti**
- Graphiti backends: Neo4j (default; ≥5.26), FalkorDB (≥1.1.2), Kuzu (≥0.11.2) and Amazon Neptune. **No source lists Postgres.** One PyPI page says Kuzu is deprecated because upstream Kuzu is unmaintained — [Graphiti docs (Mintlify)](https://www.mintlify.com/getzep/graphiti/api/drivers/overview); [PyPI graphiti-core](https://pypi.org/project/graphiti-core)
- Graphiti neared 14,000 GitHub stars when FalkorDB support was added — [Zep blog](https://blog.getzep.com/graphiti-knowledge-graphs-falkordb-support/)
- Zep Cloud bills in credits: 1 credit per 350 bytes ingested, retrieval free. Plan figures conflict: Free is 1,000 or 10,000 credits/mo; Flex is $1,250/yr or "from $125/mo" — [rywalker.com research on Zep](https://rywalker.com/research/zep); [beri.net](https://www.beri.net/tools/zep)
- One critique argues Zep Cloud's published accuracy and latency don't carry over to self-hosted Graphiti, because the hosted pipeline uses proprietary models — [Maximem comparison](https://www.maximem.ai/compare/zep-graphiti-alternatives) (competitor)
- Zep's Graphiti page claims 162 ms retrieval latency and 90.2% on LongMemEval — [getzep.com Graphiti](https://www.getzep.com/platform/graphiti/) (vendor; retrieval-only latency)

**Supermemory**
- Licence is disputed. One source says it is not open source and self-hosting is enterprise-only (the Scale plan). Another says the repo is MIT but the local server's source "is not in the public repository" — [cognee.ai: Supermemory alternatives](https://www.cognee.ai/supermemory-alternatives); [vectorize.io comparison](https://vectorize.io/articles/best-ai-agent-memory-systems)

**Cognee, MemOS, Memobase**
- Cognee: Apache-2.0 (most sources; one Membase page says MIT), installable via pip and Docker — [cognee.ai Mem0 alternatives](https://www.cognee.ai/mem0-alternatives); [membase.com](https://membase.com/blog/best-ai-agent-memory-tools-2026)
- MemOS: Apache-2.0; self-host with Neo4j + Qdrant, or MemOS Cloud — [aiagentmemory.org](https://aiagentmemory.org/articles/open-source-memory-systems-compared/)
- Memobase: Apache-2.0, Python, FastAPI + Postgres + Redis (a profile-centric "user memory" design). One source reports **no commits since January 2026** — [same search summary](https://unabyss.com/blog/mem0-alternatives)

**LangMem**
- The official SDK is Python-only. The community `langmem-ts` project is a framework-agnostic TypeScript port with **pgvector-only** storage. It implements only the semantic-memory pipeline; episodic and procedural memory are "planned" — [langmem-ts GitHub](https://github.com/ereztdev/langmem-ts)

**Consumer assistants (comparators for UX and trust)**
- **ChatGPT:**
  - Saved memories plus reference chat history (10 Apr 2025). Third-party guides say these are opt-in via Settings › Personalization; that is unverified for 2026 defaults.
  - Projects isolate memory to the project — [OpenAI announcement](https://openai.com/index/memory-and-new-controls-for-chatgpt/); [OpenAI Projects help](https://help.openai.com/en/articles/10169521-using-projects-in-chatgpt)
  - "Memory Sources", which shows which inputs shaped a reply, reportedly arrived in May 2026. OpenAI says it may not show every factor — [memorylake.ai](https://www.memorylake.ai/en/blogs/chatgpt-dreaming-vs-claude-memory) (secondary)
- **Claude (consumer):**
  - Memory launched for Team/Enterprise and incognito for all in Sep 2025 — [VentureBeat](https://venturebeat.com/ai/anthropic-adds-memory-to-claude-team-and-enterprise-incognito-for-all)
  - Later expanded to paid users, and reportedly to the free tier on 2 Mar 2026 — [lumichats](https://lumichats.com/blog/claude-memory-2026-complete-guide-how-to-use) (secondary)
  - Import/export of memories from other assistants is labelled "experimental".
  - Incognito chats aren't saved to history or used in past-chat search — [Anthropic help center](https://support.anthropic.com/en/articles/11817273-how-does-claude-s-memory-work)
  - A single blog reports a 10 Jul 2026 change to categorized individual entries, and an Aug 2026 opt-in setting for sensitive topics — [memorylake.ai](https://www.memorylake.ai/en/blogs/chatgpt-dreaming-vs-claude-memory) (unverified)
- **Gemini "Personal Intelligence":**
  - Announced 14 Jan 2026 as a US beta for AI Pro/Ultra.
  - Connects Gmail, Photos, YouTube and Search history.
  - Shows "summaries of how a response was personalized" and offers Temporary Chats.
  - Expanded globally ex-EU in Apr 2026 — [Business Today](https://www.businesstoday.in/technology/news/story/google-pushes-gemini-deeper-into-users-lives-with-new-personal-intelligence-feature-511041-2026-01-15); [Android Authority](https://www.androidauthority.com/gemini-personal-intelligence-expansion-3657523/); [DataCamp](https://www.datacamp.com/blog/gemini-personal-intelligence)
- **Anthropic API memory tool:** client-side, stable, available on all Claude 4+ models. TS helpers `betaMemoryTool` and `BetaLocalFilesystemMemoryTool` live in `@anthropic-ai/sdk` — [Claude docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool) (fetched)

### Inferences
- Sarthi has a provider-agnostic model layer, and that rules out building on the Anthropic memory tool or OpenAI's consumer memory. Copy their *interface* instead: memory exposed as model-callable tools (view/search/edit), with a handler you own.
- **Buy-vs-build for Sarthi:**
  - Mem0 Platform's Hobby tier (1k retrievals/mo) is too small for a daily coach. Pro ($249/mo) costs too much for a pre-revenue solo app.
  - Mem0 OSS with pgvector is viable, but it puts a Python-first abstraction (TS SDK parity unverified) over data that must also join with Sarthi's structured logs.
  - Graphiti adds a second database (Neo4j/FalkorDB), which is hard to justify for one user's facts.
  - Recommendation: **build on Postgres**, using Mem0's prompts and pipeline and Zep's bi-temporal edge model as reference designs.
- Owning the tables also makes DPDP erasure and export straightforward (section 4).

### Gaps
- Could not verify current GitHub star counts, latest version tags or licence files: the GitHub API and mem0.ai/atlan.com fetches were blocked in this session.
- TypeScript SDK parity for Mem0 OSS (the `mem0ai` npm "oss" mode) with pgvector was not confirmed from primary docs.
- Supermemory, Cognee and MemOS pricing were not established from primary sources.
- Letta's server database requirements (historically Postgres + pgvector) were not confirmed in this session.

---

## 3. Benchmarks, reported results, criticisms, and whether 1M-token context makes memory unnecessary

### Takeaway
LoCoMo and LongMemEval-S are close to saturated, with vendor claims of 90–95%. The numbers are dominated by the reader model, the judge and the protocol, and some are disputed. Harder 2025–26 benchmarks (BEAM, HaluMem, MemoryAgentBench, PersistBench) show the real weak spots: updating facts, selective forgetting, multi-hop over changed facts, and over-personalization. Long context does not remove the need for memory. Full-context baselines are competitive on accuracy at small scale, but cost 10–15× more latency and tokens, and they degrade as histories grow.

### Cited Findings
**Benchmark definitions**
- **LoCoMo** (Maharana et al., Feb 2024; ACL 2024): very long-term dialogues averaging 300 turns and about 9K tokens over up to 35 sessions. QA categories: single-hop, multi-hop, temporal, open-domain, adversarial — [arXiv 2402.17753](https://arxiv.org/abs/2402.17753) **[paper; prior knowledge, not re-fetched]**
  - Memory papers commonly evaluate 1,540 questions with the adversarial category excluded — [radar.zurb.com](https://radar.zurb.com/article/the-benchmark-answer-key-had-a-64-percent-error-rate-so-stop-trusting-the-score)
- **LongMemEval** (Wu et al., Oct 2024; ICLR 2025): 500 questions testing five abilities: information extraction, multi-session reasoning, temporal reasoning, **knowledge updates**, and **abstention**. Histories come in "S" (~115K tokens) and "M" (~500 sessions) variants. The paper reports a **30% accuracy drop** for commercial assistants and long-context LLMs on sustained interactions. Its proposed fixes are session decomposition, fact-augmented key expansion and time-aware query expansion — [arXiv 2410.10813](https://arxiv.org/abs/2410.10813) **[paper; prior knowledge, not re-fetched]**
- **BEAM** ("Beyond a Million Tokens", arXiv 2510.27246; ICLR 2026): 100 conversations and 2,000 validated questions, at 128K, 500K, 1M and 10M-token tiers. Tests ten abilities, including knowledge updates and contradiction resolution. Main finding: even 1M-context LLMs, with or without RAG, struggle as dialogues lengthen — [arXiv 2510.27246](https://arxiv.org/pdf/2510.27246); [perea.ai summary](https://www.perea.ai/research/beam-light-long-context-memory-bench)
- **HaluMem** (Nov 2025): operation-level hallucination evaluation across memory **extraction, updating and QA**. Reported **update accuracy below 26% on the Medium set and near zero on Long**. Systems handled boundary/conflict ("unknown or misleading premise") questions relatively well — [HaluMem (HF papers)](https://huggingface.co/papers/2511.03506); [emergentmind](https://www.emergentmind.com/topics/hallucination-in-memory-benchmark-halumem)
- **MemoryAgentBench**: four competencies: accurate retrieval, test-time learning, long-range understanding and **selective forgetting**. All methods, long-context and RAG alike, fail at multi-hop selective forgetting (as low as **7%**) — [liner.com review](https://liner.com/review/evaluating-memory-in-llm-agents-via-incremental-multiturn-interactions)
- **PersistBench** (Feb 2026): asks when long-term memories should be forgotten, i.e. when they should *not* be applied. Samples involving identity validation produced the most sycophantic responses — [arXiv 2602.01146](https://arxiv.org/html/2602.01146v2)
- **LongMemEval-V2** (web-agent and multimodal trajectory memory) is a different task, and its scores (top 72.5) aren't comparable to the original — [benchmarklist.com](https://benchmarklist.com/benchmarks/longmemeval_v2/)

**Reported results (vendor unless noted)**
- **Mem0 paper (Apr 2025, LoCoMo, GPT-4o-mini, LLM-judge J):**
  - Mem0ᵍ 68.4–68.5, Mem0 66.9 — confirmed via [Letta blog](https://www.letta.com/blog/benchmarking-ai-agent-memory) and [Memori paper](https://arxiv.org/pdf/2603.19935).
  - Zep 66.0, LangMem 58.1, OpenAI memory 52.9, A-Mem 48.4, and **full-context about 72.9 (higher than any memory system)** — [arXiv 2504.19413](https://arxiv.org/abs/2504.19413). The figures other than Mem0's are **[paper; prior knowledge, not re-fetched]**.
  - p95 latency: full-context over 17 s vs about 1.4 s for Mem0. Tokens: about 26K vs about 1.8K — [search summary of a secondary explainer](https://www.emergentmind.com/papers/2504.19413) (verify against PDF)
- **Zep paper (Jan 2025):**
  - Deep Memory Retrieval (DMR): 94.8% vs MemGPT 93.4% — [arXiv 2501.13956](https://arxiv.org/abs/2501.13956) **[paper; prior knowledge, not re-fetched]**
  - LongMemEval with gpt-4o: **71.2% vs 60.2% full-context**, average latency **2.58 s vs 28.9 s**, about 1.6K context tokens. With gpt-4o-mini: 63.8% at 3.20 s — [memorypapers.org](https://memorypapers.org/papers/zep-a-temporal-knowledge-graph-architecture-for-agent-memory); [Signals](https://signals.aktagon.com/articles/2026/07/zep-a-temporal-knowledge-graph-architecture-for-agent-memory/)
- **LoCoMo dispute (2025):**
  - Zep first claimed 84%. Mem0 said that number included the excluded adversarial category, and reran Zep at 58.44%. Zep replied that Mem0 misconfigured Zep and put the corrected figure at 75.14%.
  - A Zep GitHub issue titled "Revisiting Zep's 84% LoCoMo Claim" is dated May 2025 — [atlan.com](https://atlan.com/know/zep-vs-mem0/) (via search); [ATANT v1.1, arXiv 2604.10981](https://arxiv.org/pdf/2604.10981); [theaiengineer substack](https://theaiengineer.substack.com/p/cognee-vs-zep-vs-mem0-vs-letta)
  - Accounts disagree on who revised what.
  - The Memori paper (Mar 2026) cites Zep 79.09% and Mem0 62.47% (taken from prior work, not rerun) — [arXiv 2603.19935](https://arxiv.org/pdf/2603.19935)
- **Letta filesystem agent:** 74.0% on LoCoMo with GPT-4o-mini (Aug 2025) — [Letta blog](https://www.letta.com/blog/benchmarking-ai-agent-memory)
- **2026 claims:**
  - Mem0: LongMemEval 94.4 and LoCoMo 92.5, platform only (Apr–May 2026) — [Mem0 GitHub/blog via search](https://github.com/mem0ai/mem0)
  - Maximem Synap: 95.6% on all 500 LongMemEval questions (28 Oct 2026). Mastra 94.87% (with gpt-5-mini), Hindsight 94.6%, ByteRover 92.8% (LongMemEval-S) — [maximem.ai](https://www.maximem.ai/blog/synap-number-one-longmemeval); [mem0.ai benchmarks page](https://mem0.ai/blog/ai-memory-benchmarks-in-2026)
  - Hindsight claims 64.1% vs next-best 40.6% on the BEAM 10M tier — [Hindsight blog, 2 Apr 2026](https://hindsight.vectorize.io/blog/2026/04/02/beam-sota)
  - All of these are self-reported.
- **The reader model dominates:** OMEGA's 95.4% on LongMemEval used GPT-4.1 as the reader. The same system with GPT-4o scored 84.23% — [omegamax.co](https://omegamax.co/blog/number-one-on-longmemeval)

**Criticisms**
- **LoCoMo answer key:** an audit (Penfield Labs, reported secondhand) found 99 errors in 1,540 questions (about 6.4%). It also found the standard judge accepted **62.81% of deliberately wrong but topically related answers** — [radar.zurb.com](https://radar.zurb.com/article/the-benchmark-answer-key-had-a-64-percent-error-rate-so-stop-trusting-the-score)
  - **Contradicted** by the LazyMem re-audit. Of 294 flipped judge labels, 293 were false negatives, so the judge *under*-scores; overall noise was 7.8% — [arXiv 2607.22690](https://arxiv.org/pdf/2607.22690)
- **LoCoMo protocol:** LoCoMo, as commonly run, "forbids saying 'I don't know'" — abstention is not rewarded — [dev.to](https://dev.to/gde03/the-ai-memory-benchmark-everyone-quotes-forbids-saying-i-dont-know-o1n)
- **Reproducibility:** users report being unable to reproduce Mem0's published LoCoMo numbers with its OSS runner, and a matcher bug in that code has been flagged — [ATANT v1.1](https://arxiv.org/pdf/2604.10981)
- **BEAM's validity:** the ATANT paper argues BEAM can't distinguish a memory system from a long-context LLM, because scoring rewards within-context attention — [arXiv 2604.10981](https://arxiv.org/pdf/2604.10981)
- **Letta's view:** LoCoMo is "a retrieval benchmark", not a test of dynamic memory management. Letta promotes its own Letta Memory Benchmark instead — [Letta blog](https://www.letta.com/blog/benchmarking-ai-agent-memory)

**Long context vs memory**
- Full context was the most accurate option on LoCoMo (~9K-token dialogues) in the Mem0 paper, but at about 17 s p95 and about 26K tokens per query (see above).
- On LongMemEval-S (~115K tokens), full context *lost* to Zep (60.2% vs 71.2%) and was about 11× slower — [memorypapers.org](https://memorypapers.org/papers/zep-a-temporal-knowledge-graph-architecture-for-agent-memory)
- BEAM: 1M-context models still struggle as dialogues lengthen. A Medium post reports RAG falling from 30.7% at 1M to 24.9% at 10M — [arXiv 2510.27246](https://arxiv.org/pdf/2510.27246); [Medium](https://medium.com/@markymark/agent-memory-breaks-at-500k-tokens-not-10-million-9148883c2efc)
- Chroma's "context rot" research is cited for degradation as input length grows, even inside the supported window — [Hindsight blog citing Chroma](https://hindsight.vectorize.io/blog/2026/04/02/beam-sota) (primary not retrieved)

### Inferences
- **Back-of-envelope for Sarthi:** a daily-chat user producing about 2–4K tokens/day of conversation reaches about 0.7–1.5M tokens a year. Full-context replay is feasible only for the first weeks or months. At about 100K+ tokens it is both slower and, per LongMemEval/Zep, *less* accurate than targeted retrieval.
- Prompt caching can cut the cost of a stable prefix, but not the latency of reasoning over long input, and it doesn't fix the degradation.
- A sensible hybrid: keep the current session plus the last N sessions verbatim (working memory), and use retrieval for everything older.
- Vendor 90%+ scores don't predict performance on life-coaching data. Benchmarks are built from synthetic chit-chat. They rarely mix time-series logs, never test "user deleted this, don't resurface it", and seldom reward abstention.
- The benchmarks most predictive for Sarthi are HaluMem's update metrics, MemoryAgentBench's selective forgetting, LongMemEval's knowledge-update and abstention categories, and PersistBench. Sarthi should build its own eval (section 5).

### Gaps
- No neutral, independently maintained LongMemEval or LoCoMo leaderboard was found as of Nov 2026; all top scores are self-reported with differing readers and judges.
- MemBench (named in the brief) was not researched in this session; no findings.
- I couldn't re-verify the Mem0 paper's full-context 72.9 J figure and the competitor numbers against the PDF (arXiv not fetched).
- I found no rigorous public study of cost per user per month for memory systems at consumer scale.

---

## 4. Life-coach-specific needs: structured logs plus narrative, goals, temporal change, trust/UX, sycophancy, sensitive data, India DPDP

### Takeaway
A coach's "memory" is mostly structured data, which belongs in SQL, not embeddings. Narrative memory should hold the *why*: goals, constraints, preferences, life events and commitments, with temporal validity. Two failures make users distrust a coach: hidden or uneditable memory, and inferred "insights" about them. Two more are now documented: memory-driven sycophancy, and over-applying old memories in unrelated contexts. Under India's DPDP regime, consent, withdrawal and erasure must reach every derived artefact: facts, summaries, embeddings and the profile document.

### Cited Findings
**Temporal change**
- Zep/Graphiti's bi-temporal model separates when a fact was true from when the system learned it, and invalidates superseded facts instead of deleting them. This is the established pattern for "facts change over time" — [AviAvni Zep reading notes](https://github.com/AviAvni/database-learning-path/blob/master/topics/38-graphrag-agent-memory/reading-zep-graphiti.md)
- One competitor argues you can keep the temporal model without the graph — [Maximem](https://www.maximem.ai/compare/zep-graphiti-alternatives)
- Knowledge updates remain the hardest operation for memory systems: HaluMem update accuracy is below 26% (Medium) and near 0 (Long). MemoryAgentBench multi-hop selective forgetting is about 7% — [HaluMem](https://huggingface.co/papers/2511.03506); [MemoryAgentBench review](https://liner.com/review/evaluating-memory-in-llm-agents-via-incremental-multiturn-interactions)

**Sycophancy and over-personalization**
- User memory profiles produced the largest increases in agreement sycophancy: **+45% Gemini 2.5 Pro, +33% Claude Sonnet 4, +16% GPT-4.1 Mini**, and no significant change for GPT-5.1 — [arXiv 2509.12517 (CHI 2026)](https://arxiv.org/html/2509.12517)
- WRITER's MIST benchmark (2026): every model at least tripled its sycophancy rate under at least one memory condition. Replacing *extracted memory snippets* with raw chat history roughly **halved** sycophancy, which implicates extracted content rather than prompt format — [WRITER engineering](https://writer.com/engineering/personalized-context-degrades-ai-accuracy/)
- A 2026 paper reports structured memory does not substantially reduce memory-induced sycophancy — [arXiv 2608.08300](https://arxiv.org/pdf/2608.08300) (via search summary)
- **Counter-evidence:** in factual domains, 8 of 9 models showed no significant sycophancy difference between generic and personalized conditions — [arXiv 2603.00024](https://arxiv.org/pdf/2603.00024)

**Trust and UX patterns in shipped products**
- Gemini shows summaries of how a response was personalized, indicates when personal context was used, and offers Temporary Chats — [DataCamp](https://www.datacamp.com/blog/gemini-personal-intelligence)
- Claude offers incognito chats excluded from memory and search, plus memory import/export — [Anthropic help center](https://support.anthropic.com/en/articles/11817273-how-does-claude-s-memory-work)
- ChatGPT Projects scope memory to a project — [OpenAI help](https://help.openai.com/en/articles/10169521-using-projects-in-chatgpt)
- ChatGPT Memory Sources (reported May 2026) — [memorylake.ai](https://www.memorylake.ai/en/blogs/chatgpt-dreaming-vs-claude-memory) (secondary)
- Anthropic's memory-tool guidance: Claude "usually refuses to write sensitive information" to memory, but apps should add validation that strips sensitive data, cap file sizes, and periodically delete long-unaccessed memories — [Claude docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)
- An Aug 2026 Claude update reportedly added a setting that keeps sensitive topics out of memory unless the user opts in — [memorylake.ai](https://www.memorylake.ai/en/blogs/chatgpt-dreaming-vs-claude-memory) (single secondary source)

**India DPDP Act 2023 and DPDP Rules 2025**
- Rules notified 13/14 Nov 2025 with a phased rollout. MeitY milestones: 14 Nov 2025 (Data Protection Board provisions immediate), 14 Nov 2026 (Consent Manager registration), and full compliance about 13/14 May 2027 — [Deccan Herald](https://www.deccanherald.com/amp/story/india%2Fcentre-notifies-dpdp-rules-implementation-planned-in-phases-spread-over-12-18-months-3798465); [PIB document](https://static.pib.gov.in/WriteReadData/specificdocs/documents/2025/nov/doc20251117695301.pdf); [Legal500 / Saga Legal](https://www.legal500.com/firms/237811-saga-legal/c-india/news-and-developments/the-privacy-timer-starts-now-analysing-the-dpdp-rules-and-its-18-month-countdown)
- The main obligations largely apply from the main compliance date: notices, consent mechanics, security safeguards, breach reporting, erasure timelines, children's-data safeguards and Data Principal rights — [Mondaq](https://www.mondaq.com/india/privacy-protection/1708830/dpdp-act-compliance-mandate). Another source says the rights (erasure, withdrawal) applied from Nov 2025. **The sources conflict**, so check the gazette — [search summary](https://www.scconline.com/blog/post/2025/12/26/digital-personal-data-protection-rules-2025-key-highlights/)
- The Rules set specific retention and erasure periods only for e-commerce, online-gaming and social-media intermediaries above user thresholds — [SCC Online](https://www.scconline.com/blog/post/2025/12/26/digital-personal-data-protection-rules-2025-key-highlights/)

### Inferences
**Two memory planes for Sarthi**
- (a) **Structured plane:** the existing food, spend, habit and skill-hour logs, plus goals and commitments as first-class tables. The LLM queries these through typed SQL tools or precomputed rollups. Never embed raw log rows.
- (b) **Narrative plane:** facts, preferences, constraints, life events and episode summaries, with valid_from/valid_to.
- Derived observations ("spending on food delivery up 40% vs 4-week average") come from SQL. Store them as time-stamped `derived` memories that cite the query and window, so the coach states evidence rather than impressions.

**Goals and commitments**
- Model them as rows with status, target metric, cadence and due date, not as memory text. "Did I keep my commitment?" is then a join against logs, not a retrieval guess.

**Countering sycophancy in a coach**
- Keep memories neutral and factual ("user's goal: lose 5 kg by Mar 2027"). Don't store identity-validation statements ("user is very disciplined").
- Prompt the coach to check user claims against log data before agreeing.
- Store inferred insights separately (source = `inferred`) and inject them only when relevant. WRITER's finding suggests that injecting *extracted* snippets is riskier than showing raw evidence, so cite the source message or log aggregate next to each injected memory.

**Creepiness**
- Sarthi's existing rule (only explicit statements or user-confirmed cards become memories) matches where the industry has ended up: user-visible and editable memory, incognito modes, and sensitive topics as opt-in. Keep it.
- Add "used in this reply" chips (Gemini and ChatGPT Memory Sources pattern) and a per-domain "don't remember" switch.

**DPDP design implications for a consumer app in India (not legal advice)**
- Itemized notice and per-purpose consent for health- and finance-adjacent memory.
- Withdrawal as easy as giving consent.
- Erasure that cascades to `memory_facts`, episode summaries, embeddings, the profile document, caches, and the eval and analytics copies. Audit rows should keep IDs and operation types, not content, after erasure.
- Export, mirroring Claude's import/export.
- Keep LLM-provider calls on ZDR or no-training terms where available. The Anthropic memory tool is ZDR-eligible because storage is client-side.

### Gaps
- Not verified in-session: the DPDP Act's penalty amounts, the breach-notification window, the children's verifiable-parental-consent rules, and whether health or financial data get special-category treatment (the DPDP Act has no "sensitive personal data" class, unlike the older IT Act SPDI Rules). The interaction with the SPDI Rules' repeal was also not checked. Check against the gazette and counsel.
- I found no published study specific to *AI life coaches* comparing memory designs on user trust or retention. Evidence comes from general assistants and sycophancy papers.
- I didn't research guidance under the Reserve Bank of India or health regulators on AI handling of financial or health data for consumer (non-regulated) apps.

---

## 5. Evaluation: building an eval set for a personal memory system; LLM-as-judge pitfalls

### Takeaway
Public benchmarks test the categories Sarthi needs (extraction, multi-session aggregation, temporal reasoning, knowledge updates, abstention, selective forgetting), but on synthetic chit-chat and with noisy judges. Sarthi should build a small, owned eval suite: scripted multi-session personas with gold facts and SQL-derived gold answers. It should score the write path and the read path separately, and use deterministic checks wherever possible, keeping a calibrated LLM judge for the rest.

### Cited Findings
- **Categories to copy:**
  - LongMemEval's five abilities: information extraction, multi-session reasoning, temporal reasoning, knowledge updates, abstention — [arXiv 2410.10813](https://arxiv.org/abs/2410.10813) **[paper; prior knowledge, not re-fetched]**
  - HaluMem's per-operation scoring (extraction, updating, QA), including a memory-conflict / false-premise category — [HaluMem](https://huggingface.co/papers/2511.03506)
  - MemoryAgentBench's selective forgetting — [liner.com review](https://liner.com/review/evaluating-memory-in-llm-agents-via-incremental-multiturn-interactions)
  - PersistBench's "should this memory be applied here?" — [arXiv 2602.01146](https://arxiv.org/html/2602.01146v2)
- **Judge pitfalls:**
  - An audit found the LoCoMo judge accepted 62.81% of deliberately wrong but on-topic answers, and found 6.4% gold-answer errors — [radar.zurb.com](https://radar.zurb.com/article/the-benchmark-answer-key-had-a-64-percent-error-rate-so-stop-trusting-the-score)
  - A separate re-audit found judge errors were 293 of 294 false negatives (7.8% noise) — [arXiv 2607.22690](https://arxiv.org/pdf/2607.22690)
  - The direction of judge bias therefore depends on the setup.
  - Across four judges, rankings held but absolute scores varied; Claude Haiku was strictest and DeepSeek most lenient — [search summary of arXiv 2607.22690 / related](https://arxiv.org/pdf/2607.22690)
  - JudgeSense (2026) benchmarks prompt sensitivity of LLM judges — [arXiv 2604.23478](https://arxiv.org/pdf/2604.23478) (title only)
- **Abstention:** as commonly run, LoCoMo gives no credit for "I don't know" — [dev.to](https://dev.to/gde03/the-ai-memory-benchmark-everyone-quotes-forbids-saying-i-dont-know-o1n)
- **Reader confound:** the same memory system scored 95.4% vs 84.23% depending on the reader model — [omegamax.co](https://omegamax.co/blog/number-one-on-longmemeval)

### Inferences
**Recommended Sarthi eval design (solo-developer scale)**

1. **Personas:** 20–40 synthetic users, each a script of 15–40 sessions over 3–12 simulated months. Generate them with an LLM from a hand-written "life timeline". The timeline includes:
   - goal changes;
   - budget changes;
   - an injury;
   - a job change;
   - a deleted memory;
   - a sensitive disclosure with no consent;
   - matching structured logs (food, spend, habits, skill hours) produced by a seeded generator.

   The timeline is the ground truth.
2. **Write-path metrics, per session:**
   - extraction precision and recall against the gold facts introduced that session;
   - false-memory rate (facts not stated or implied);
   - policy violations (implied fact saved without confirmation; sensitive fact saved without consent);
   - update correctness: when a fact changes, did the old row get `valid_to` set and the new row get linked?
3. **Read-path question types (aim for about 300–600 questions):**
   - **(a)** single-fact recall;
   - **(b)** multi-session aggregation ("what have I said about my sleep?");
   - **(c)** temporal ("what was my savings target before I changed jobs?");
   - **(d)** knowledge update (must give the current value and must not give the stale one);
   - **(e)** contradiction / false premise ("since I quit coffee…" when they didn't);
   - **(f)** abstention (never mentioned, so the coach must say so);
   - **(g)** deletion honoured (a deleted fact must not appear, even paraphrased);
   - **(h)** structured-data questions with SQL-computed gold answers ("average daily spend last 2 weeks");
   - **(i)** cross-context leakage (PersistBench-style: a health memory shouldn't surface in a money question unless relevant);
   - **(j)** sycophancy probes: the user claims progress that the logs contradict, and the coach must point this out kindly.
4. **Scoring:**
   - Use exact or regex or numeric-tolerance checks for (a), (c), (d) and (h).
   - Use a rubric LLM judge for the rest, with "must contain X / must not contain Y" fields.
   - Use a judge from a different model family than the coach.
   - Calibrate the judge on about 100 hand-labelled items and report its agreement.
   - Run each question 2–3 times and report the mean with a CI.
   - Track tokens per turn and p50/p95 latency.
5. **Regression:** run the suite in CI whenever extraction or retrieval prompts, embedding models or ranking weights change. Keep a frozen subset to compare across model versions, because the reader-model confound is large.

### Gaps
- I found no public eval dataset that combines conversational memory with personal time-series logs; it has to be built.
- Didn't research inter-annotator agreement norms or cost-per-eval-run figures for memory benchmarks.

---

## 6. Practical recommendation: minimal-but-proper memory on Postgres + pgvector for one developer (tables, write path, read path, consolidation, buy vs build)

### Takeaway
Build it in your existing Supabase Postgres:
- an append-only message log;
- per-session episode summaries;
- a bi-temporal `memory_facts` table with embeddings and full-text search;
- an always-loaded, user-editable profile document;
- first-class goals and commitments tables;
- SQL tools over the structured logs.

Use a Mem0-style extract → reconcile write path gated by Sarthi's consent rules, hybrid RRF retrieval plus frecency at read time, and a nightly "sleep-time" consolidation job. Don't adopt a graph DB or a hosted memory vendor at this stage.

### Cited Findings
- **Hybrid search on Supabase:**
  - The official guide pairs a GIN index on a `tsvector` column (keyword) with an HNSW index on the embedding (semantic).
  - It runs each in a CTE, fuses with a **FULL OUTER JOIN** and **Reciprocal Rank Fusion** (`rrf_k` default 50; `full_text_weight` and `semantic_weight` default 1), and uses `websearch_to_tsquery`.
  - `ts_rank_cd` is not indexable and only ranks rows already matched — [Supabase docs: Hybrid search](https://supabase.com/docs/guides/ai/hybrid-search)
  - Other references use k = 60 — [pgEdge pgvector docs](https://docs.pgedge.com/pgvector/v0-8-1/hybrid-search)
- **Reference designs:**
  - Mem0's ADD/UPDATE/DELETE/NOOP reconciliation over the top-10 similar memories — [arXiv 2504.19413](https://arxiv.org/abs/2504.19413)
  - Mem0's 2026 shift to a single-pass, add-only extraction call to cut cost — [Mem0 blog](https://mem0.ai/blog/mem0-the-token-efficient-memory-algorithm)
  - Zep's bi-temporal invalidation of contradicted facts — [Zep notes](https://github.com/AviAvni/database-learning-path/blob/master/topics/38-graphrag-agent-memory/reading-zep-graphiti.md)
  - Letta's always-in-context memory blocks plus a sleep-time agent that edits them — [Letta blog](https://www.letta.com/blog/sleep-time-compute/)
  - Letta's evidence that simple search tools driven by the agent perform well — [Letta blog](https://www.letta.com/blog/benchmarking-ai-agent-memory)
  - Generative Agents' recency + importance + relevance scoring and evidence-citing reflections — [arXiv 2304.03442](https://arxiv.org/abs/2304.03442)
  - MemoryBank's reinforcement-on-recall decay — [arXiv 2305.10250](https://arxiv.org/abs/2305.10250)
- **Context budget:** Zep's retrieval delivered about 1.6K context tokens per query, beating 115K-token full context on accuracy and latency (LongMemEval, gpt-4o) — [memorypapers.org](https://memorypapers.org/papers/zep-a-temporal-knowledge-graph-architecture-for-agent-memory). Mem0's 2026 algorithm uses about 6.8K tokens per query — [Mem0 via search](https://mem0.ai/blog/mem0-the-token-efficient-memory-algorithm)
- **Memory hygiene:** cap memory size, expire unaccessed items, strip sensitive data, validate tool paths and arguments — [Claude memory-tool docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)
- **Consolidation cadence in shipped products:** Claude consumer memory processes updates once daily — [Anthropic help center via search](https://support.anthropic.com/en/articles/11817273-how-does-claude-s-memory-work). ChatGPT Pulse runs overnight — [ChatGPT release notes via search](https://help.openai.com/en/articles/6825453-chatgpt-release-notes)

### Inferences

**A. Tables** (Drizzle/Postgres; `vector` from pgvector; one embedding model; 768–1536 dims)

```
messages            -- keep coach_messages; add session_id, tsv tsvector (GIN). Embed per-session summaries, not every message.
sessions            -- id, user_id, started_at, ended_at, summary text, summary_embedding vector, domains text[],
                    -- key_events jsonb, mood/energy (if consented), summarized_at
memory_facts        -- the semantic store (replaces coach_memory)
  id, user_id,
  slot_key text NULL          -- normalized attribute, e.g. 'diet.pattern', 'finance.monthly_budget', 'health.injury.knee'
  content text                -- one atomic, third-person, dated statement: "Since 2026-09 user follows a vegetarian diet."
  value_json jsonb NULL       -- typed value for slot facts (amount, unit, currency)
  domain enum(health,money,habits,skills,global,relationships,work)
  kind enum(fact,preference,goal_context,constraint,event,coaching_pref,insight)
  source enum(user_stated,user_confirmed,inferred,derived_from_logs)
  evidence_message_ids uuid[], evidence_query jsonb NULL
  sensitivity enum(normal,health,financial,special)
  confidence real, importance smallint (1-5, set at write time)
  valid_from timestamptz, valid_to timestamptz NULL           -- event time (when true in the user's life)
  recorded_at timestamptz, superseded_at timestamptz NULL, superseded_by uuid NULL  -- system time
  status enum(active,superseded,retired,deleted_pending)
  pinned bool, use_count int, last_used_at timestamptz, strength real   -- frecency/forgetting
  embedding vector, tsv tsvector GENERATED
  indexes: HNSW(embedding) WHERE status='active'; GIN(tsv); btree(user_id, domain, status); unique(user_id, slot_key) WHERE status='active'
memory_ops          -- audit: fact_id, op(ADD|UPDATE|SUPERSEDE|RETIRE|DELETE|CONFIRM|REJECT), actor(user|extractor|consolidator),
                    -- reason, model, created_at; content diff only while the fact exists (purge on erasure)
memory_proposals    -- pending "cards" for implied or sensitive facts awaiting user confirmation (keeps the existing rule)
user_profile        -- 1 row/user: versioned markdown "core block" (≤ ~800–1500 tokens), sections: identity & context,
                    -- active goals (pointer), constraints, preferences & coaching style, do-not-mention list; user-editable;
                    -- regenerated nightly from active facts, but the user's edits win (store user_locked sections)
goals, commitments  -- structured: metric, target, unit, deadline, cadence, status, created_from_message_id
log tables          -- existing food/spend/habit/skill logs + materialized daily/weekly rollups per user
consents            -- per user × purpose/domain (e.g. memory.health, memory.finance), granted_at, withdrawn_at, notice_version
```

**B. Write path**, run asynchronously after each assistant turn or at session close (a queue such as Supabase cron/pg_net or a worker), never blocking the reply.

1. A cheap model extracts JSON candidates from the last exchange plus a rolling session summary. Each candidate has: `{content, slot_key?, kind, domain, valid_from, explicitness: stated|implied, sensitivity, evidence_quote}`. Few-shot it with coaching examples and tell it not to extract opinions about the user.
2. **Policy gate (Sarthi's differentiator):**
   - stated + normal → eligible to auto-save;
   - implied, or inferred → `memory_proposals`, shown as a card;
   - sensitive with no consent for that domain → drop it, or propose it with the consent ask;
   - anything about third parties → minimize.
3. **Reconcile, deterministic first:**
   - If `slot_key` matches an active fact: same value → NOOP (bump confidence and evidence). Different value → SUPERSEDE: set the old row's `valid_to` and `superseded_at`, then insert the new row.
   - Otherwise retrieve the top ~5–10 similar active facts in the same user and domain (hybrid search), and let an LLM choose ADD / UPDATE (rephrase or merge) / SUPERSEDE / NOOP / DELETE. This is Mem0's pattern with Zep's "invalidate, don't delete".
   - Log every operation in `memory_ops`.
4. User edits and deletes from the memory UI go straight to the table (status `deleted_pending`, then hard delete), with audit. A deleted fact's `content` hash goes on a per-user "do-not-re-extract" list, so the extractor doesn't immediately re-learn it. Honour this in the eval (question type g).

**C. Read path**, assembled per turn under a fixed budget of about 2–4K memory tokens.

1. **Always included** (cheap and cacheable as a stable prefix):
   - `user_profile`;
   - active goals and commitments due soon (SQL);
   - a compact "last 7/30 days" stats card from the rollups;
   - the last session's summary.
2. **Query-dependent:**
   - Hybrid RRF over active `memory_facts` and `sessions.summary` (Supabase pattern), filtered by `user_id`, domain hint and validity (`valid_to IS NULL`, or overlapping the time window the question asks about).
   - Re-rank with `score = rrf + w1·frecency(Δdays, use_count) + w2·importance + pinned_boost`. Keep the existing frecency formula as one signal, not the only one.
   - Take the top 8–15.
   - Inject facts with their dates and sources ("[2026-09-14, you said] …") to curb sycophancy and stale-fact errors.
3. **Agentic tools** (provider-agnostic function calling):
   - `search_memory(query, domain?, as_of?)`;
   - `get_fact_history(slot_key)` for "how has X changed";
   - `query_logs(metric, range, agg, group_by)` (whitelisted SQL);
   - `propose_memory(...)`;
   - `forget(fact_id)`.

   This follows Letta's finding that the model searching for itself does well, while avoiding a vector lookup for numeric questions.
4. Record `use_count` and `last_used_at` for the facts actually injected, and show them as "used in this reply" chips.

**D. Consolidation ("sleep-time") jobs, nightly per active user, with a cheap model**

- Summarize closed sessions into `sessions.summary` with embeddings and `key_events`.
- Dedupe and merge near-duplicate active facts (cosine > ~0.9 within a slot or domain), then re-check contradictions.
- Regenerate `user_profile` from active facts, preserving user-locked sections, and diff it for the audit.
- **Decay:** `strength *= exp(-Δt/τ)`, reinforced on use (MemoryBank-style). Facts below a threshold that aren't pinned or goal-linked → `retired`, still visible in the UI.
- **Weekly reflection:** generate up to 3 candidate "insights" from logs and episodes, each citing evidence (Generative Agents style). Store them as `inferred` proposals for the user to accept, never as auto-facts.
- **Expiry:** auto-expire time-bound facts ("travelling this week").

**E. Cost sketch** (formulas, not quotes; check current model prices)

- Per turn: extraction ≈ (last exchange ~1–2K + rolling summary ~0.5K + prompt ~1K) input tokens on a small model. Reconciliation runs only when candidates exist.
- Nightly: summary + consolidation ≈ day's transcript tokens + about 2K profile tokens.
- Embeddings: a few hundred short texts per user per month, which is negligible against chat costs.
- Expect memory overhead of very roughly 20–50% on top of a small-model chat cost, and well under full-context replay once histories pass about 50–100K tokens. (This is an inference; no source measured it for a coaching app.)

**F. Buy vs build**

- **Build:** schema, write-path policy gate, hybrid retrieval and consolidation. Each is a few hundred lines of TypeScript plus SQL, and owning them is what makes DPDP erasure, user editing and SQL joins with logs straightforward.
- **Borrow:**
  - Mem0's extraction and update prompts and its ADD/UPDATE/DELETE/NOOP schema, as reference (Apache-2.0);
  - Zep's bi-temporal edge fields;
  - Letta's memory-block plus sleep-time split;
  - the Supabase hybrid-search SQL function;
  - optionally `langmem-ts` (pgvector) as a code reference.
- **Avoid for now:**
  - Graphiti and Neo4j/FalkorDB: a second datastore, Python-centric, and graph value is low for a single user's facts;
  - hosted memory APIs: cost, data residency and DPDP processor obligations, plus vendor scores that come from proprietary platform tuning;
  - any provider-locked memory (Anthropic memory tool, OpenAI memory), given the provider-agnostic model layer.
- **Revisit when:** many users exceed about 1K active facts each, multi-hop relational questions (people, places, routines) become common in evals, or eval shows hybrid retrieval recall@10 < ~85%.

**G. Migration from the current Sarthi memory**

- Map `coach_memory` → `memory_facts`:
  - domain, kind, pinned, useCount and lastUsedAt carry over;
  - retired → `status=retired`;
  - `estimated` → `source=inferred` (or `confidence<1`);
  - the audit table → `memory_ops`.
- Then backfill `valid_from` from creation time, embeddings, `tsv`, and session summaries from `coach_messages`.

### Gaps
- None of the recommended weights (RRF k, frecency vs RRF weighting, decay τ, dedupe threshold) have published values for coaching data. They must be tuned on the Sarthi eval set (section 5).
- Supabase-specific limits weren't verified: the HNSW index build memory on small plans, and pg_cron/pg_net job limits for nightly per-user batches.
- Current per-token prices for candidate extraction and embedding models were not fetched in this session. The cost section is formulas only.
