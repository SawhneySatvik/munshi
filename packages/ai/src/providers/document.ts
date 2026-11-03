import { DOCUMENT_ALIAS, MODEL_ALIASES } from "../models.ts";
import { replayed, told, type Deps } from "./client.ts";
import { ModelError } from "./redact.ts";
import { sarvamReadDocument } from "./sarvam-docs.ts";
import type { DocumentResult, ProviderId } from "./types.ts";

/** The document reader's binding: the document alias (models.ts), the same on both editions. */
export function documentBinding(): { provider: ProviderId; model: string } {
  const m = MODEL_ALIASES[DOCUMENT_ALIAS] as { provider: ProviderId; model: string };
  return { provider: m.provider, model: m.model };
}

/**
 * A PDF's pages as the document reader reads them, through the adapter that speaks its provider's job API; any other
 * provider is refused before a call. `language`: the document's, BCP-47.
 */
export async function readDocument(file: Uint8Array, mime: "application/pdf", language: string, d: Deps = {}): Promise<DocumentResult> {
  const b = documentBinding();
  const adapter = b.provider === "sarvam" ? sarvamReadDocument : null;
  if (!adapter) throw new ModelError(`document: provider ${b.provider} has no adapter`);
  const read = await adapter(file, mime, language, b, d);
  // The parse job reports no usage: the call is kept with none.
  await told(d, { role: "document", alias: DOCUMENT_ALIAS, provider: b.provider, model: b.model, usage: null, replayed: replayed(d) });
  return read;
}
