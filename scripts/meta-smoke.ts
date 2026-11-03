// Meta smoke test: one real call per model. Access is granted per model, so listing models proves nothing.
// Run: pnpm --filter @munshi/ai smoke   (keys from the repo's .env or the shell; BASETEN_API_KEY optional)
import { existsSync, readFileSync } from "node:fs";
import { DEFAULT_ROLES, generate, ModelError, redact, type Role, segment, transcribe, z, type Deps } from "../packages/ai/src/index.ts";

// Values are never printed.
const envFile = new URL("../.env", import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);

const smokeDir = new URL("../packages/ai/fixtures/smoke/", import.meta.url);
const live: Deps = { mode: "live" };

const checks: { label: string; role: Role; run: () => Promise<string> }[] = [
  {
    label: "muse-spark-1.3 (tool + JSON schema)",
    role: "reason",
    run: async () => {
      const r = await generate(
        {
          role: "reason",
          messages: [{ role: "user", content: "A kirana sold 3 packets of tea. Call record_sale for tea, or if you cannot, answer in the JSON schema." }],
          tools: [{ name: "record_sale", description: "Record a sale", parameters: { type: "object", properties: { item: { type: "string" }, qty: { type: "integer" } }, required: ["item", "qty"] } }],
          schema: { name: "Answer", zod: z.object({ item: z.string(), qty: z.number() }) },
        },
        live,
      );
      if (r.toolCalls.length === 0 && r.json === undefined) throw new Error("neither a tool call nor schema JSON came back");
      return `${r.toolCalls.length} tool call(s), json=${r.json !== undefined}`;
    },
  },
  {
    label: "sam-3.1 (noun phrase on shelf.png)",
    role: "segment",
    run: async () => {
      const png = readFileSync(new URL("shelf.png", smokeDir));
      const r = await segment({ imageUrl: `data:image/png;base64,${png.toString("base64")}`, prompt: { phrase: "red packet" } }, live);
      if (r.matches.length === 0) throw new Error("zero matches on an image with 15 packets");
      return `${r.matches.length} match(es) (drawn: 15)`;
    },
  },
  {
    label: "muse-voice-transcribe-1.0 (hindi.wav)",
    role: "voice",
    run: async () => {
      const r = await transcribe({ wav: new Uint8Array(readFileSync(new URL("hindi.wav", smokeDir))), language: "Hindi" }, live);
      if (!r.text.trim()) throw new Error("empty transcript");
      return `${r.text.length} chars`;
    },
  },
];

if (process.env.BASETEN_API_KEY) {
  checks.push({
    label: "muse-spark-open (baseten)",
    role: "narrate",
    run: async () => {
      const r = await generate({ role: "narrate", messages: [{ role: "user", content: "Say hello in one word." }] }, live);
      if (!r.text.trim()) throw new Error("empty text");
      return `${r.text.length} chars`;
    },
  });
} else {
  console.log("SKIP  baseten (BASETEN_API_KEY not set)");
}

let failed = 0;
for (const c of checks) {
  const model = DEFAULT_ROLES[c.role].model;
  const t0 = Date.now();
  try {
    const detail = await c.run();
    console.log(`PASS  ${model}  ${Date.now() - t0}ms  ${detail}`);
  } catch (e) {
    failed++;
    const code = e instanceof ModelError && e.code ? ` [${e.code}]` : "";
    console.log(`FAIL  ${model}  ${Date.now() - t0}ms${code}  ${redact(e instanceof Error ? e.message : String(e))}`);
  }
}
process.exit(failed === 0 ? 0 : 1);
