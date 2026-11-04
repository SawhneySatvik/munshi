// Gemini's OpenAI-compatible endpoint refuses a response schema it judges too complex with a bare 400 "Request contains
// an invalid argument" (measured live on 4 Nov against gemini-3.5-flash and -flash-lite). Two things push a schema over:
// zod's safe-integer bounds (every .int() gets ±9007199254740991 as minimum/maximum, which zod means as "an integer",
// not as a limit), and a long maxItems on an array of objects (60 bill lines fail, 20 pass). So the schema sent to Gemini
// drops those two hints; the reply is still checked against the full zod schema (generate.ts), so nothing is loosened.

/**
 * Whether a 429's error text is a daily quota: Gemini's QuotaFailure names it (quotaId "…PerDay…"), or its RetryInfo asks
 * for a wait over a minute. Retrying within the binding cannot help, so the chain moves on at once. Only these two
 * fields are read; the text is never logged.
 */
export function dailyQuota(text: string): boolean {
  if (/"quotaId"\s*:\s*"[^"]*PerDay/.test(text)) return true;
  const wait = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(text);
  return wait !== null && Number(wait[1]) > 60;
}

/** Above this, an array's maxItems is not sent to Gemini (the zod check still holds it). */
export const GEMINI_MAX_ITEMS = 20;

const sentinel = (k: string, v: unknown) => (k === "maximum" && v === Number.MAX_SAFE_INTEGER) || (k === "minimum" && v === Number.MIN_SAFE_INTEGER);

/** A JSON schema as Gemini will take it: zod's safe-integer bounds and any maxItems over GEMINI_MAX_ITEMS left out. */
export function geminiSchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(geminiSchema);
  if (!s || typeof s !== "object") return s;
  return Object.fromEntries(
    Object.entries(s)
      .filter(([k, v]) => !sentinel(k, v) && !(k === "maxItems" && typeof v === "number" && v > GEMINI_MAX_ITEMS))
      .map(([k, v]) => [k, geminiSchema(v)]),
  );
}
