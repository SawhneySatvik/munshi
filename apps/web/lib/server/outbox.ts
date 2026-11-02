// The outbox's wiring (BP-F3b). Boot wires the senders once: every deployment gets the recorded sender (ids and body
// hashes only, in the config's outbox folder), and only a live one with WhatsApp configured also gets WhatsApp Cloud
// (channelsFor decides; the database decides per delivery whether it may be real). After an approval executes, the
// app flushes the outbox once, as munshi_jobs, so a demo's recorded sends show as sent at once instead of at the next
// tick; a slot the tick already took this minute is left to it. The jobs pool is the tick route's too.
import { tmpdir } from "node:os";
import path from "node:path";
import { channelsFor, recordedSender, whatsAppCloud } from "@munshi/adapters/channels";
import { createJobsPool, log, runDueJobs, wireChannels } from "@munshi/core";
import { config, tickSettings } from "./config.ts";
import { wirePaypal } from "./paypal.ts";

type Pool = ReturnType<typeof createJobsPool>;

// The Graph API version WhatsApp Cloud is called at; checked against Meta's current one at W6, with the first live call.
const GRAPH_VERSION = "v21.0";

// Kept on globalThis so next dev's module reloads reuse one pool and wire once.
const held = globalThis as typeof globalThis & { munshiJobsPool?: { url: string; pool: Pool } | undefined; munshiOutboxWired?: boolean };

export function wireOutbox(): void {
  if (held.munshiOutboxWired) return;
  const c = config();
  const live = c.whatsapp
    ? { whatsapp: whatsAppCloud({ phoneNumberId: c.whatsapp.phoneNumberId, token: c.whatsapp.accessToken, graphVersion: GRAPH_VERSION, fetch }) }
    : {};
  wireChannels(channelsFor(c.deployment ?? "demo", recordedSender(c.outboxDir ?? path.join(tmpdir(), "munshi-outbox")), live));
  wirePaypal(); // PayPal links an approval queued (recorded unless the sandbox keys are set)
  held.munshiOutboxWired = true;
}

/** The jobs pool (role munshi_jobs), or null where JOBS_DATABASE_URL is unset. */
export function jobsPool(): Pool | null {
  const url = tickSettings().jobsDatabaseUrl;
  if (!url) return null;
  if (held.munshiJobsPool?.url === url) return held.munshiJobsPool.pool;
  const pool = createJobsPool(url);
  held.munshiJobsPool = { url, pool };
  return pool;
}

/** One outbox sweep after an approval; never fails the approval (the next tick sends what this one could not). */
export async function flushOutbox(): Promise<void> {
  try {
    const pool = jobsPool();
    if (!pool) return;
    wireOutbox();
    await runDueJobs(pool, new Date(), ["outbox"], 2_000);
  } catch {
    log("outbox.flush_failed", { code: "flush_failed" }, "warn");
  }
}
