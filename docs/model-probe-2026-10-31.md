# Model probe, 2026-10-31

Live calls from `packages/agent/scripts/model-probe.ts`. FACT for the date above; re-run before relying on it.

## gemini

60 models listed; probed (newest first, at most 6): 6.

| model | text | tool call | JSON schema | image |
|---|---|---|---|---|
| `gemini-pro-latest` | no-go (429: 429 [{"error":{"code":429,"message":"You exceeded your current quota, please che) | no-go (429: 429 [{"error":{"code":429,"message":"You exceeded your current quota, please che) | no-go (429: 429 [{"error":{"code":429,"message":"You exceeded your current quota, please che) | no-go (429: 429 [{"error":{"code":429,"message":"You exceeded your current quota, please che) |
| `gemini-omni-flash-preview` | no-go (429: 429 [{"error":{"code":429,"message":"You exceeded your current quota, please che) | no-go (429: 429 [{"error":{"code":429,"message":"You exceeded your current quota, please che) | no-go (429: 429 [{"error":{"code":429,"message":"You exceeded your current quota, please che) | no-go (429: 429 [{"error":{"code":429,"message":"You exceeded your current quota, please che) |
| `gemini-omni-1.1-flash` | no-go (429: 429 [{"error":{"code":429,"message":"You exceeded your current quota, please che) | no-go (429: 429 [{"error":{"code":429,"message":"You exceeded your current quota, please che) | no-go (429: 429 [{"error":{"code":429,"message":"You exceeded your current quota, please che) | no-go (429: 429 [{"error":{"code":429,"message":"You exceeded your current quota, please che) |
| `gemini-nano-banana-2.1` | no-go (429: 429 [{"error":{"code":429,"message":"You exceeded your current quota, please che) | no-go (429: 429 [{"error":{"code":429,"message":"You exceeded your current quota, please che) | no-go (429: 429 [{"error":{"code":429,"message":"You exceeded your current quota, please che) | no-go (429: 429 [{"error":{"code":429,"message":"You exceeded your current quota, please che) |
| `gemini-flash-lite-latest` | go | go | go | go |
| `gemini-flash-latest` | no-go (error: Request timed out.) | go | no-go (error: Request timed out.) | no-go (error: Request timed out.) |

## openai

`OPENAI_API_KEY` unset: not probed.

## openrouter

`OPENROUTER_API_KEY` unset: not probed.

# Model probe, 2026-10-31

Live calls from `packages/agent/scripts/model-probe.ts`. FACT for the date above; re-run before relying on it.

## gemini

60 models listed; probed (newest first, at most 6): 6.

| model | text | tool call | JSON schema | image |
|---|---|---|---|---|
| `gemini-3.1-flash-lite` | go | go | go | go |
| `gemini-3.5-flash` | go | go | go | go |
| `gemini-3.5-flash-lite` | go | go | go | go |
| `gemini-3.7-flash` | no-go (error: Request timed out.) | no-go (error: Request timed out.) | no-go (error: Request timed out.) | no-go (503: 503 [{"error":{"code":503,"message":"This model is currently experiencing high d) |
| `gemini-3.8-flash` | no-go (503: 503 [{"error":{"code":503,"message":"This model is currently experiencing high d) | no-go (error: Request timed out.) | no-go (error: Request timed out.) | no-go (429: 429 [{"error":{"code":429,"message":"You exceeded your current quota, please che) |
| `gemini-4-argon` | no-go (429: 429 [{"error":{"code":429,"message":"You exceeded your current quota, please che) | no-go (429: 429 [{"error":{"code":429,"message":"You exceeded your current quota, please che) | no-go (429: 429 [{"error":{"code":429,"message":"You exceeded your current quota, please che) | no-go (429: 429 [{"error":{"code":429,"message":"You exceeded your current quota, please che) |

## openai

`OPENAI_API_KEY` unset: not probed.

## openrouter

`OPENROUTER_API_KEY` unset: not probed.


# Model probe, 2026-10-31, through the adapters

Live calls from `packages/agent/scripts/model-probe.ts` through `generate()` and the voice adapters. FACT for the date above; re-run before relying on it.

Keys: `GEMINI_API_KEY` set, `CLAUDE_API_KEY` set, `OPENAI_API_KEY` set, `OPENROUTER_API_KEY` set, `NVIDIA_API_KEY` set, `SARVAM_API_KEY` set.

- anthropic: 14 models listed; probed: `claude-haiku-4-5-20251001` listed, `claude-haiku-5-5` listed.
- openai: 136 models listed; probed: `gpt-5.6-luna` listed, `gpt-6-luna` listed.
- openrouter: 247 models listed; probed: `z-ai/glm-5.3-flash` listed, `mistralai/mistral-small-3.2-24b-instruct` listed.
- nvidia: 85 models listed; probed: `nvidia/nemotron-3.5-super-vl-120b-a12b` listed, `meta/llama-3.2-90b-vision-instruct` listed.
- sarvam: 0 models listed; probed: (no list endpoint).

| provider | model | json | tool | image | router | reason | vision | narrate | voice |
|---|---|---|---|---|---|---|---|---|---|
| anthropic | `claude-haiku-4-5-20251001` | go | go | go | go | go | go | go | - |
| anthropic | `claude-haiku-5-5` | go | go | go | go | go | go | go | - |
| openai | `gpt-5.6-luna` | go | go | go | go | go | go | go | - |
| openai | `gpt-6-luna` | go | go | go | go | go | go | go | - |
| openrouter | `z-ai/glm-5.3-flash` | go | go | go | go | go | go | go | - |
| openrouter | `mistralai/mistral-small-3.2-24b-instruct` | go | go | go | go | go | go | go | - |
| nvidia | `nvidia/nemotron-3.5-super-vl-120b-a12b` | go | go | go | go | go | go | go | - |
| nvidia | `meta/llama-3.2-90b-vision-instruct` | no-go (error: model call timed out) | go | no-go (error: model call timed out) | no-go | no-go | no-go | no-go | - |
| sarvam | `sarvam-105b` | no-go (error: model call timed out) | go | no-go (400: 400 body.messages.0.user.content : Input should be a valid string) | no-go | no-go | no-go | no-go | - |
| sarvam | `saaras:v4` (speech-to-text, hindi.wav) | - | - | - | - | - | - | - | go (hi-IN) |


# Model probe, 2026-10-31, through the adapters

Live calls from `packages/agent/scripts/model-probe.ts` through `generate()` and the voice adapters. FACT for the date above; re-run before relying on it.

Keys: `GEMINI_API_KEY` set, `CLAUDE_API_KEY` set, `OPENAI_API_KEY` set, `OPENROUTER_API_KEY` set, `NVIDIA_API_KEY` set, `SARVAM_API_KEY` set.

- nvidia: 85 models listed; probed: `meta/llama-3.2-90b-vision-instruct` listed.
- sarvam: 0 models listed; probed: (no list endpoint).

| provider | model | json | tool | image | router | reason | vision | narrate | voice |
|---|---|---|---|---|---|---|---|---|---|
| nvidia | `meta/llama-3.2-90b-vision-instruct` | no-go (error: model call timed out) | go | no-go (error: model call timed out) | no-go | no-go | no-go | no-go | - |
| sarvam | `sarvam-105b` | go | go | no-go (400: 400 body.messages.0.user.content : Input should be a valid string) | go | go | no-go | go | - |
| sarvam | `saaras:v4` (speech-to-text, hindi.wav) | - | - | - | - | - | - | - | go (hi-IN) |

The second run above re-probed the two rows that timed out in the first; its JSON check ran at narrate's 60-second
timeout (the first ran it at the router's 20 seconds), and the router counts as a go only if that answer came within 20
seconds.

## Aliases taken from these runs (packages/agent/src/models.ts)

| alias | provider | model | roles |
|---|---|---|---|
| `haiku-4-5` | anthropic | `claude-haiku-4-5-20251001` | router, reason, vision, narrate |
| `haiku-5-5` | anthropic | `claude-haiku-5-5` | router, reason, vision, narrate |
| `gpt-luna-5-6` | openai | `gpt-5.6-luna` | router, reason, vision, narrate |
| `gpt-luna-6` | openai | `gpt-6-luna` | router, reason, vision, narrate |
| `or-glm-5.3-flash` | openrouter | `z-ai/glm-5.3-flash` (the cheapest model with tools, a JSON schema and images) | router, reason, vision, narrate |
| `nemotron-super-vl` | nvidia | `nvidia/nemotron-3.5-super-vl-120b-a12b` | router, reason, vision, narrate |
| `sarvam-105b` | sarvam | `sarvam-105b` | reason, narrate (no image input; the router is left off because its first JSON answer overran 20 seconds) |
| `saaras-v4` | sarvam | `saaras:v4` | voice |

`mistralai/mistral-small-3.2-24b-instruct` passed too but is not aliased (one OpenRouter model was asked for);
`meta/llama-3.2-90b-vision-instruct` on NVIDIA timed out twice and is not aliased.
