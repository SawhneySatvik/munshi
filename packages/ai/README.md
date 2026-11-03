# @munshi/ai

The model provider layer. Code asks for a **role**; this package turns it into a call to a provider's model, with
timeouts, retries, key redaction and recorded fixtures. It has no database and no agent logic.

## Roles and models

| Role | Used for | Default |
|---|---|---|
| `router` | Pick the desk for a question | Muse Spark (Meta) |
| `reason` | The tool loop over named reads; explanations | Muse Spark (Meta) |
| `vision` | Read a bill or name the products on a shelf | Muse Spark (Meta) |
| `segment` | Count items in a photo, one product at a time | SAM 3.1 (Meta); no other provider |
| `voice` | Speech to text | Muse Voice Transcribe (Meta); Sarvam's Saaras as fallback |
| `narrate` | Write an answer's short segments with cell refs | Muse Spark Open (Meta, on Baseten) |
| `speak` | Read aloud | Sarvam's Bulbul (Meta has no text-to-speech model) |

A PDF bill is read by Sarvam's document reader, outside the chains and the allow-list. Meta-hosted models come first in
every chain; Gemini is the first fallback; Anthropic, OpenAI, OpenRouter, NVIDIA and Sarvam follow where the
operator's allow-list includes them. In live mode, a missing key or a failing provider moves a call to the next allowed
model that has a key.

## Entry points

| File | What |
|---|---|
| [`src/models.ts`](src/models.ts) | The catalogue: short aliases mapped to a provider, a model id and their roles (for every non-Meta alias, the roles it passed a live probe in; Meta's follow its documentation until a live call). The database stores only aliases |
| [`src/config.ts`](src/config.ts) | Defaults per role, provider base URLs, key names, per-role timeouts, the allow-list and fallback order |
| [`src/providers/generate.ts`](src/providers/generate.ts) | Text, tools, JSON schema and images over the Responses or Chat Completions wire format |
| [`src/providers/anthropic.ts`](src/providers/anthropic.ts) | Anthropic's Messages API |
| [`src/providers/meta-sam.ts`](src/providers/meta-sam.ts), [`meta-voice.ts`](src/providers/meta-voice.ts) | SAM 3.1 segmentation (response hashed on arrival) and Muse Voice Transcribe |
| [`src/providers/sarvam-voice.ts`](src/providers/sarvam-voice.ts), [`sarvam-speak.ts`](src/providers/sarvam-speak.ts), [`sarvam-docs.ts`](src/providers/sarvam-docs.ts) | Sarvam speech to text, text to speech and PDF reading |
| [`src/providers/client.ts`](src/providers/client.ts), [`fixtures.ts`](src/providers/fixtures.ts) | Transport, chains, and recorded mode (`MUNSHI_MODEL_MODE`) |
| [`src/providers/redact.ts`](src/providers/redact.ts) | `ModelError`, which scrubs every provider key and bearer token from its message |
| [`src/prices.ts`](src/prices.ts) | Prices per alias, where known; an unknown price or usage is an unknown cost, never zero |

## Boundaries

- Imports no `@munshi` package, no database driver and no app code (gate B6 in
  [`packages/core/test/boundary.test.ts`](../core/test/boundary.test.ts)).
- No provider name reaches the database, and no provider-specific code lives outside its adapter.
- Keys are read by the names in [`.env.example`](../../.env.example) and never logged.

## Testing

```bash
pnpm --filter @munshi/ai test         # adapters against recorded responses; no network
pnpm --filter @munshi/ai smoke        # one live call per Meta model; fails clearly without a key
```

Recorded probe calls for each provider are in [`fixtures/probe`](fixtures/probe). Some response shapes follow the
providers' docs and are marked `UNVERIFIED` in their adapters until a live call confirms them; see
[docs/limitations.md](../../docs/limitations.md).
