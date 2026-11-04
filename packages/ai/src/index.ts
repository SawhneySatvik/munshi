// The model provider layer: roles and their defaults, the alias catalogue, each provider's adapter, the
// transport (timeouts, retries, redaction) and the recorded fixtures. No database and no agent logic: packages/agent's
// flows call models through this, and a boundary test keeps this package free of any import from outside it.
export * from "./providers/types.ts";
export * from "./config.ts";
export * from "./models.ts";
export { type ModelNotice, onModelNotice } from "./notice.ts";
export { generate } from "./providers/generate.ts";
export { evidenceOf, parseSegments, promptText, segment } from "./providers/meta-sam.ts";
export { transcribe } from "./providers/transcribe.ts";
export { speak } from "./providers/speech.ts";
export { MAX_SPEAK_CHARS, speakPieces } from "./providers/sarvam-speak.ts";
export { documentBinding, readDocument } from "./providers/document.ts";
export { MAX_PAGES, pageBlocks } from "./providers/sarvam-docs.ts";
export { ModelError, redact } from "./providers/redact.ts";
export { fixtureKey, type ModelMode, parseMode, sha256Hex } from "./providers/fixtures.ts";
export { aliasOf, type ChainBinding, type Deps, type ModelCall, requireKey, resolveBinding } from "./providers/client.ts";
export { z } from "zod";
export { type Cost, costFrom, costOf, type Price, PRICES } from "./prices.ts";
