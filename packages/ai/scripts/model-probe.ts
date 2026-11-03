// P-7 model probe: which models each provider with a key serves, and which roles each passes, live, through this
// package's own adapters (generate and the voice adapters), so a go means our code works against that model. Passing
// calls are recorded under fixtures/probe/ (test/probe-recorded.test.ts replays them); a failing call's recording is
// removed. The output, appended to docs/model-probe-<date>.md, is the only source of model ids for MODEL_ALIASES and
// the allow-list. Keys load from the env file and are never printed; error text is scrubbed of every key. No
// gemini-2.5-* model is ever probed (retired).
//
//   node packages/ai/scripts/model-probe.ts --env=<path> [--providers=a,b] [--models=provider:model,...] [--list]
//     --list: print each provider's model ids (filtered) and stop; no model call is made.
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import OpenAI from "openai";
import { BASE_URLS, KEY_ENV, ROLE_TIMEOUT_MS } from "../src/config.ts";
import { ANTHROPIC_VERSION } from "../src/providers/anthropic.ts";
import { fixtureKey, sha256Hex } from "../src/providers/fixtures.ts";
import { generate, generateKeyed } from "../src/providers/generate.ts";
import { redact } from "../src/providers/redact.ts";
import { sarvamTranscribe } from "../src/providers/sarvam-voice.ts";
import type { ProviderId, Role } from "../src/providers/types.ts";
import { type Check, HINDI_WAV, PROBE_CALLS, PROBE_FIXTURES, ROLE_CHECKS } from "./probe-requests.ts";

const root = new URL("../../../", import.meta.url);
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
for (const a of process.argv.slice(2)) if (!/^--(env|providers|models)=|^--list$/.test(a)) throw new Error(`model-probe: unknown argument ${a.split("=")[0]}`);
// Node loads the file; values are never printed.
const envFile = arg("env") ?? new URL(".env", root).pathname;
if (existsSync(envFile)) process.loadEnvFile(envFile);
const LIST = process.argv.includes("--list");

const PROBED: ProviderId[] = ["gemini", "anthropic", "openai", "openrouter", "nvidia", "sarvam"];
const only = arg("providers")?.split(",").filter(Boolean);
const providers = PROBED.filter((p) => !only || only.includes(p));
// The models to call, per provider: --models=provider:model (comma-separated); else the defaults below.
const DEFAULT_MODELS: Partial<Record<ProviderId, string[]>> = {
  anthropic: ["claude-haiku-4-5-20251001", "claude-haiku-5-5"],
  openai: ["gpt-5.6-luna", "gpt-6-luna"],
  sarvam: ["sarvam-105b"],
};
const pick: Partial<Record<ProviderId, string[]>> = {};
for (const pm of arg("models")?.split(",").filter(Boolean) ?? []) {
  const [p, ...m] = pm.split(":");
  pick[p as ProviderId] = [...(pick[p as ProviderId] ?? []), m.join(":")];
}
const SARVAM_STT = "saaras:v4";

const scrub = (t: string) => redact(t).replace(/\|/g, "/").replace(/\s+/g, " ").slice(0, 90);
const out = (s: string) => process.stdout.write(`${s}\n`);

async function listIds(p: ProviderId, key: string): Promise<string[]> {
  if (p === "anthropic") {
    const r = await fetch(`${BASE_URLS.anthropic}/models?limit=100`, { headers: { "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION } });
    if (!r.ok) throw Object.assign(new Error(`list ${r.status}`), { status: r.status });
    return ((await r.json()) as { data: { id: string }[] }).data.map((m) => m.id);
  }
  if (p === "openrouter") {
    // Cheapest first, among models that take tools, a JSON schema and an image.
    const r = await fetch(`${BASE_URLS.openrouter}/models`);
    type M = { id: string; pricing?: { prompt?: string; completion?: string }; supported_parameters?: string[]; architecture?: { input_modalities?: string[] } };
    const data = ((await r.json()) as { data: M[] }).data.filter(
      (m) => m.supported_parameters?.includes("tools") && m.supported_parameters.includes("structured_outputs") && m.architecture?.input_modalities?.includes("image") && !/gemini-2\.5/.test(m.id),
    );
    const cost = (m: M) => Number(m.pricing?.prompt ?? 1) + Number(m.pricing?.completion ?? 1);
    return data.filter((m) => cost(m) > 0).sort((a, b) => cost(a) - cost(b)).map((m) => `${m.id} (${(cost(m) * 1e6).toFixed(2)}/Mtok in+out)`);
  }
  if (p === "sarvam") return []; // no model list endpoint in Sarvam's docs; ids from its docs
  const client = new OpenAI({ apiKey: key, baseURL: BASE_URLS[p], timeout: 30_000, maxRetries: 0 });
  const ids: string[] = [];
  for await (const m of await client.models.list()) ids.push(m.id.replace(/^models\//, ""));
  return ids.filter((id) => !id.startsWith("gemini-2.5"));
}

// The JSON check runs at narrate's timeout; the router (a shorter timeout) passes only if that answer came inside its own.
let jsonMs = 0;
async function check(p: ProviderId, model: string, c: Check): Promise<string> {
  const req = PROBE_CALLS[c];
  const file = join(PROBE_FIXTURES, `${fixtureKey(generateKeyed(req, { provider: p, model }))}.json`);
  try {
    const r = await generate(req, { mode: "record", fixturesDir: PROBE_FIXTURES, chain: async () => [{ provider: p, model, alias: "probe" }] });
    const ok = c === "tool" ? r.toolCalls.some((t) => t.name === "record_sale") : r.json !== undefined;
    if (c === "json") jsonMs = r.latencyMs;
    if (ok) return "go";
    rmSync(file, { force: true });
    return `no-go (${c === "tool" ? "no tool call" : "no JSON"})`;
  } catch (e) {
    rmSync(file, { force: true });
    const status = (e as { status?: number }).status;
    return `no-go (${status ?? "error"}: ${scrub(e instanceof Error ? e.message : String(e))})`;
  }
}

const date = new Date().toISOString().slice(0, 10);
const lines: string[] = ["", `# Model probe, ${date}, through the adapters`, ""];
lines.push("Live calls from `packages/ai/scripts/model-probe.ts` through `generate()` and the voice adapters. FACT for the date above; re-run before relying on it.", "");
lines.push(`Keys: ${PROBED.map((p) => `\`${KEY_ENV[p]}\` ${process.env[KEY_ENV[p]] ? "set" : "unset"}`).join(", ")}.`, "");
out(lines.at(-2) as string);

const table: string[] = ["| provider | model | json | tool | image | router | reason | vision | narrate | voice |", "|---|---|---|---|---|---|---|---|---|---|"];
for (const p of providers) {
  const key = process.env[KEY_ENV[p]];
  if (!key) {
    lines.push(`- ${p}: \`${KEY_ENV[p]}\` unset, skipped.`);
    out(`${p}: ${KEY_ENV[p]} unset, skipped`);
    continue;
  }
  const wanted = (pick[p] ?? DEFAULT_MODELS[p] ?? []).filter((m) => !m.startsWith("gemini-2.5"));
  try {
    const ids = await listIds(p, key);
    if (LIST) {
      out(`${p}: ${ids.length} models\n  ${ids.slice(0, 200).join("\n  ")}`);
      continue;
    }
    const listed = p === "sarvam" ? "(no list endpoint)" : wanted.map((m) => `\`${m}\` ${ids.some((i) => i === m || i.startsWith(`${m} `)) ? "listed" : "not listed"}`).join(", ");
    lines.push(`- ${p}: ${ids.length} models listed; probed: ${listed || "none"}.`);
  } catch (e) {
    lines.push(`- ${p}: listing failed (${scrub(e instanceof Error ? e.message : String(e))}).`);
    if (LIST) continue;
  }
  for (const model of wanted) {
    const r: Record<Check, string> = { json: await check(p, model, "json"), tool: await check(p, model, "tool"), image: await check(p, model, "image") };
    const role = (x: Role) => ((ROLE_CHECKS[x] as Check[]).every((c) => r[c] === "go") && (x !== "router" || jsonMs < ROLE_TIMEOUT_MS.router) ? "go" : "no-go");
    table.push(`| ${p} | \`${model}\` | ${r.json} | ${r.tool} | ${r.image} | ${role("router")} | ${role("reason")} | ${role("vision")} | ${role("narrate")} | - |`);
    out(`${p} ${model}: json=${r.json.split(" ")[0]} tool=${r.tool.split(" ")[0]} image=${r.image.split(" ")[0]}`);
  }
  if (p === "sarvam") {
    let voice: string;
    try {
      const t = await sarvamTranscribe({ wav: HINDI_WAV, language: "Hindi" }, { provider: "sarvam", model: SARVAM_STT }, { mode: "record", fixturesDir: PROBE_FIXTURES });
      voice = t.text.trim() ? `go (${t.language ?? "no language"})` : "no-go (empty transcript)";
    } catch (e) {
      rmSync(join(PROBE_FIXTURES, `${fixtureKey({ kind: "transcribe", provider: "sarvam", model: SARVAM_STT, audio: sha256Hex(HINDI_WAV), language: "Hindi" })}.json`), { force: true });
      voice = `no-go (${(e as { status?: number }).status ?? "error"}: ${scrub(e instanceof Error ? e.message : String(e))})`;
    }
    table.push(`| sarvam | \`${SARVAM_STT}\` (speech-to-text, hindi.wav) | - | - | - | - | - | - | - | ${voice} |`);
    out(`sarvam ${SARVAM_STT}: voice=${voice.split(" ")[0]}`);
  }
}

if (!LIST) {
  lines.push("", ...table, "");
  const doc = new URL(`docs/model-probe-${date}.md`, root);
  // Always appended: earlier runs are the record MODEL_ALIASES cites.
  writeFileSync(doc, `${lines.join("\n")}\n`, { flag: "a" });
  out(`appended to docs/model-probe-${date}.md`);
}
