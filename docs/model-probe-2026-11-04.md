
# Model probe, 2026-11-04, through the adapters

Live calls from `packages/ai/scripts/model-probe.ts` through `generate()` and the voice adapters. FACT for the date above; re-run before relying on it.

Keys: `GEMINI_API_KEY` set, `CLAUDE_API_KEY` set, `OPENAI_API_KEY` set, `OPENROUTER_API_KEY` set, `NVIDIA_API_KEY` set, `SARVAM_API_KEY` set.

- gemini: 50 models listed; probed: none.
- anthropic: 14 models listed; probed: `claude-haiku-4-5-20251001` listed, `claude-haiku-5-5` listed.
- openai: 136 models listed; probed: `gpt-5.6-luna` listed, `gpt-6-luna` listed.
- openrouter: 251 models listed; probed: `meta/muse-spark-open` listed.
- nvidia: 85 models listed; probed: none.
- sarvam: 0 models listed; probed: (no list endpoint).

| provider | model | json | tool | image | router | reason | vision | narrate | voice |
|---|---|---|---|---|---|---|---|---|---|
| openrouter | `meta/muse-spark-open` | go | go | go | go | go | go | go | - |

