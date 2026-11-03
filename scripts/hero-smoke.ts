// The hero chain, live, once: a shelf photo counted (vision names, segment counts), a supplier's bill read
// (vision, no tools) into a purchase draft, and a spoken Hindi question answered from cells (voice, then the question
// run). It runs on a throwaway embedded database seeded with the synthetic kirana, through the same port as the tests,
// and prints PASS/FAIL per step with what came back, rendered from cells. Exit 0 only if every step passes.
// Run: pnpm --filter @munshi/agent hero-smoke, with the keys in the shell (node --env-file=.env works; values are never
// printed). Without META_MODEL_API_KEY every step FAILs at once and nothing starts. UNVERIFIED: no Meta key existed when
// this was written, so the live path has run only as the recorded tests' requests (db/test/v2/core/hero, h1–h3).
import { readFileSync } from "node:fs";
import { type Cell, renderCell } from "../packages/core/src/read.ts";
import { businessDate } from "../packages/core/src/time.ts";
import { readBill } from "../packages/agent/src/bill.ts";
import { ModelError, redact } from "../packages/ai/src/index.ts";
import { countShelf } from "../packages/agent/src/shelf.ts";
import { askByVoice } from "../packages/agent/src/voice.ts";
import { renderReply } from "../packages/agent/src/answer.ts";
import { agentPort, startRun } from "../db/test/v2/core/agent-port.ts";
import { startLiveDb } from "../db/test/v2/live-db.ts";
import { seedKirana } from "../db/seed/kirana.ts";

const STEPS = ["shelf count (vision + segment)", "bill read (vision)", "ask by voice (voice + router/reason/narrate)"];
const media = (name: string) => new Uint8Array(readFileSync(new URL(`../packages/agent/fixtures/media/${name}`, import.meta.url)));
const live = { mode: "live" };

if (!process.env.META_MODEL_API_KEY) {
  for (const step of STEPS) console.log(`FAIL  ${step}  META_MODEL_API_KEY is not set: nothing was started`);
  process.exit(1);
}

const db = await startLiveDb();
let failed = 0;
try {
  const asOf = businessDate(new Date(), "Asia/Kolkata");
  const k = await seedKirana(db.app, { asOf });
  const port = async () => agentPort(db, k.owner, await startRun(db, k.owner, "photo")).port;
  const shown = async (p: Awaited<ReturnType<typeof port>>, ref: { snapshotId: string; row: number; col: string }) => renderCell((await p.resolve(ref)) as Cell | null);

  const steps: (() => Promise<string>)[] = [
    async () => {
      const p = await port();
      const r = await countShelf(media("shelf.png"), { port: p, deps: live });
      if (r.kind !== "counted" || r.counts.length === 0) throw new Error(`no count (${r.kind === "refused" ? r.why : "nothing counted"})`);
      const lines = await Promise.all(r.counts.map(async (c) => `shelf ${await shown(p, c.counted)} vs books ${await shown(p, c.onHand)}${c.draftId ? " → draft" : ""}`));
      return `${lines.join("; ")}; ${r.unrecognised.length ? "some products outside the catalogue" : "every product in the catalogue"}`;
    },
    async () => {
      const p = await port();
      const r = await readBill(media("bill.png"), { port: p, deps: live, supplierId: k.suppliers.get("Gupta Traders (simulated)") as string });
      if (r.kind !== "read") throw new Error(`refused (${r.kind === "refused" ? r.why : r.kind})`);
      if (!r.draftId) throw new Error(`read, but no draft (${r.why})`);
      const rises = await Promise.all(r.priceRises.map(async (x) => `${await shown(p, x.lastCost)} → ${await shown(p, x.billCost)}`));
      return `draft proposed; ${r.lines.some((l) => !l.itemId) ? "a line matched no item" : "every line matched"}; price rises: ${rises.join(", ") || "none"}`;
    },
    async () => {
      const p = agentPort(db, k.owner, await startRun(db, k.owner)).port;
      const r = await askByVoice(media("ask-hi.wav"), { port: p, asOf, deps: live, language: "Hindi" });
      if (r.reply.kind !== "answer") throw new Error(`abstained (${r.reply.missing.join(", ")})`);
      return renderReply(r.reply).join(" ");
    },
  ];
  for (const [i, step] of steps.entries()) {
    const t0 = Date.now();
    try {
      const detail = await step();
      console.log(`PASS  ${STEPS[i]}  ${Date.now() - t0}ms  ${detail}`);
    } catch (e) {
      failed++;
      const code = e instanceof ModelError && e.code ? ` [${e.code}]` : "";
      console.log(`FAIL  ${STEPS[i]}  ${Date.now() - t0}ms${code}  ${redact(e instanceof Error ? e.message : String(e))}`);
    }
  }
} finally {
  await db.stop();
}
process.exit(failed === 0 ? 0 : 1);
