// P-7 model probe: which models each provider with a key actually serves, and which roles each passes, live.
// The output (docs/model-probe-<date>.md) is the only source of model ids for MODEL_ALIASES and the allow-list seed.
// Keys load from .env and are never printed; any error text has them scrubbed. gemini-2.5-* is refused (retired).
// Run: node packages/agent/scripts/model-probe.ts [--max=6] [--env=<path to .env>]   (default: this checkout's .env)
import { writeFileSync } from "node:fs";
import OpenAI from "openai";
import { loadEnvFiles } from "../../config/src/index.ts";

const root = new URL("../../../", import.meta.url);
const envArg = process.argv.find((a) => a.startsWith("--env="));
loadEnvFiles([envArg ? new URL(`file://${envArg.slice(6)}`) : new URL(".env", root)]);

const maxArg = process.argv.find((a) => a.startsWith("--max="));
const MAX = maxArg ? Number(maxArg.slice(6)) : 6;
// --models=a,b: probe exactly these ids (for every provider whose list holds them) instead of the newest-first pick.
const modelsArg = process.argv.find((a) => a.startsWith("--models="));
const ONLY = modelsArg ? modelsArg.slice(9).split(",").filter(Boolean) : null;

type Provider = { id: string; key: string; base: string; pick: (id: string) => boolean };
const PROVIDERS: Provider[] = [
  {
    id: "gemini",
    key: "GEMINI_API_KEY",
    base: "https://generativelanguage.googleapis.com/v1beta/openai/",
    // Text-capable chat models only; never the retired 2.5 line, never audio/image/embedding/tts variants.
    pick: (m) => /gemini-/.test(m) && !/gemini-(1|2)\./.test(m) && !/(embedding|tts|image|audio|live|robotics|computer-use)/.test(m),
  },
  { id: "openai", key: "OPENAI_API_KEY", base: "https://api.openai.com/v1/", pick: (m) => /^(gpt-|o\d)/.test(m) && !/(audio|realtime|tts|image|transcribe|search)/.test(m) },
  { id: "openrouter", key: "OPENROUTER_API_KEY", base: "https://openrouter.ai/api/v1/", pick: () => false },
];

// A 1×1 red PNG: enough to show the endpoint accepts an image part.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

function scrub(text: string, secret: string): string {
  return secret ? text.split(secret).join("[key]") : text;
}

async function attempt(name: string, fn: () => Promise<boolean>, secret: string): Promise<string> {
  try {
    return (await fn()) ? "go" : `no-go (${name}: empty)`;
  } catch (e) {
    const status = (e as { status?: number }).status;
    return `no-go (${status ?? "error"}: ${scrub(e instanceof Error ? e.message : String(e), secret).slice(0, 80).replace(/\|/g, "/")})`;
  }
}

const lines: string[] = [];
const date = new Date().toISOString().slice(0, 10);
lines.push(`# Model probe, ${date}`, "", "Live calls from `packages/agent/scripts/model-probe.ts`. FACT for the date above; re-run before relying on it.", "");

for (const p of PROVIDERS) {
  const secret = process.env[p.key] ?? "";
  if (!secret) {
    lines.push(`## ${p.id}`, "", `\`${p.key}\` unset: not probed.`, "");
    continue;
  }
  const client = new OpenAI({ apiKey: secret, baseURL: p.base, timeout: 60_000, maxRetries: 1 });
  const ids: string[] = [];
  try {
    const list = await client.models.list();
    for await (const m of list) ids.push(m.id.replace(/^models\//, ""));
  } catch (e) {
    lines.push(`## ${p.id}`, "", `Listing failed: ${scrub(e instanceof Error ? e.message : String(e), secret).slice(0, 120)}`, "");
    continue;
  }
  const candidates = (ONLY ? ids.filter((m) => ONLY.includes(m)) : ids.filter(p.pick).sort().reverse().slice(0, MAX)).filter((m) => !m.startsWith("gemini-2.5"));
  lines.push(`## ${p.id}`, "", `${ids.length} models listed; probed (newest first, at most ${MAX}): ${candidates.length}.`, "");
  lines.push("| model | text | tool call | JSON schema | image |", "|---|---|---|---|---|");
  for (const model of candidates) {
    const text = await attempt("text", async () => {
      const r = await client.chat.completions.create({ model, messages: [{ role: "user", content: "Reply with the word ready." }] });
      return Boolean(r.choices[0]?.message?.content);
    }, secret);
    const tool = await attempt("tool", async () => {
      const r = await client.chat.completions.create({
        model,
        messages: [{ role: "user", content: "A kirana sold 3 packets of tea. Record it with the tool." }],
        tools: [{ type: "function", function: { name: "record_sale", description: "Record a sale", parameters: { type: "object", properties: { item: { type: "string" }, qty: { type: "integer" } }, required: ["item", "qty"] } } }],
        tool_choice: "required",
      });
      return (r.choices[0]?.message?.tool_calls?.length ?? 0) > 0;
    }, secret);
    const json = await attempt("json", async () => {
      const r = await client.chat.completions.create({
        model,
        messages: [{ role: "user", content: "Give the item and quantity: 3 packets of tea." }],
        response_format: { type: "json_schema", json_schema: { name: "Sale", schema: { type: "object", properties: { item: { type: "string" }, qty: { type: "integer" } }, required: ["item", "qty"] } } },
      });
      const parsed = JSON.parse(r.choices[0]?.message?.content ?? "null") as { qty?: unknown } | null;
      return typeof parsed?.qty === "number";
    }, secret);
    const image = await attempt("image", async () => {
      const r = await client.chat.completions.create({
        model,
        messages: [{ role: "user", content: [{ type: "text", text: "What colour is this pixel? One word." }, { type: "image_url", image_url: { url: PNG } }] }],
      });
      return Boolean(r.choices[0]?.message?.content);
    }, secret);
    lines.push(`| \`${model}\` | ${text} | ${tool} | ${json} | ${image} |`);
    process.stdout.write(`${p.id} ${model}: text=${text.split(" ")[0]} tool=${tool.split(" ")[0]} json=${json.split(" ")[0]} image=${image.split(" ")[0]}\n`);
  }
  lines.push("");
}

const out = new URL(`docs/model-probe-${date}.md`, root);
writeFileSync(out, `${lines.join("\n")}\n`, { flag: ONLY ? "a" : "w" });
process.stdout.write(`wrote docs/model-probe-${date}.md\n`);
