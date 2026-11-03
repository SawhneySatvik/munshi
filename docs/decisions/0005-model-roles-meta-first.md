# 5. Agents ask for roles; Meta's models first

Status: accepted · November 2026

## Context

Munshi needs several kinds of model work: routing a question, reasoning over reads, reading photos, counting items in a
photo, transcribing speech, writing short answers and speaking them. Providers differ in what they offer, their keys
arrive at different times, and any of them can be slow or down. Provider details must not leak into the domain or the
database.

## Decision

- Code asks for a **role**: router, reason, vision, segment, voice, narrate or speak. Configuration maps each role to a
  model by a short alias, and the alias to a provider and model id, in `packages/ai` only.
- **Meta's models are the default** for every role Meta serves: Muse Spark for router, reason and vision; SAM 3.1 for
  segment; Muse Voice Transcribe for voice; Muse Spark Open for narrate. Meta has no text-to-speech model, so speak
  defaults to Sarvam's Bulbul; a PDF bill goes to Sarvam's document reader.
- **Fallback.** Meta-hosted models stay first in a call's chain; Gemini is the first fallback; Anthropic, OpenAI,
  OpenRouter, NVIDIA and Sarvam follow where the allow-list includes them. A missing key or a failing provider moves the
  call to the next allowed model with a key.
- Only aliases are stored in the database, never a provider's model id, and no provider-specific code lives outside its
  adapter. `packages/ai` has no database and no agent logic, held by a source-scanning gate.

## Consequences

- A deployment without Meta's key still answers, through Gemini and the others.
- The shelf count has no fallback: no other provider serves segment, so without Meta's key items are marked uncounted
  rather than guessed.
- Adding a provider is an adapter plus catalogue entries; nothing else changes.
- A non-Meta alias is listed only for the roles it passed a live probe in. Meta's own models have not yet been called live from
  this code; see [limitations.md](../limitations.md).

Code: [`packages/ai/src/config.ts`](../../packages/ai/src/config.ts),
[`packages/ai/src/models.ts`](../../packages/ai/src/models.ts),
[`packages/ai/src/providers`](../../packages/ai/src/providers).
