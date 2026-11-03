// The outbox's wiring (BP-F3b). Boot wires the senders once: every deployment gets the recorded sender (ids and body
// hashes only, in the config's outbox folder); one whose send mode is live also gets WhatsApp Cloud where its
// credentials are set (channelsFor decides; the database decides per delivery whether it may be real, and the sweep
// hands a real sender only a real shop's delivery). Instagram's sender is not wired yet: Meta fetches a post's image
// from a public HTTPS address, and no route serves a campaign's card at one (the jobs role cannot read a campaign's
// card, and the public media route serves only a site's look). The adapter is ready (instagramGraph, tested in CH1);
// wire it with a mediaUrlFor that answers the card's address once one exists. Until then the sweep ends a pending post
// blocked, and the screens say "recorded, not sent" (channelState's no_card). After an approval executes, the
// app flushes the outbox once, as munshi_jobs, so a demo's recorded sends show as sent at once instead of at the next
// tick; a slot the tick already took this minute is left to it. The jobs pool is the tick route's too.
import { tmpdir } from "node:os";
import path from "node:path";
import { type Channels, channelsFor, GRAPH_VERSION, recordedSender, type TemplatePurpose, whatsAppCloud } from "@munshi/adapters/channels";
import { createJobsPool, log, runDueJobs, wireChannels } from "@munshi/core";
import { config, tickSettings } from "./config.ts";
import { wirePaypal } from "./paypal.ts";

type Pool = ReturnType<typeof createJobsPool>;

// Kept on globalThis so next dev's module reloads reuse one pool and wire once.
const held = globalThis as typeof globalThis & { munshiJobsPool?: { url: string; pool: Pool } | undefined; munshiOutboxWired?: boolean };

export function wireOutbox(): void {
  if (held.munshiOutboxWired) return;
  const c = config();
  const live: Omit<Channels, "recorded"> = {};
  if (c.whatsapp) {
    const { phoneNumberId, accessToken, templates, templateLanguage } = c.whatsapp;
    const names = Object.fromEntries(Object.entries(templates).map(([purpose, t]) => [purpose, t.name])) as Partial<Record<TemplatePurpose, string>>;
    live.whatsapp = whatsAppCloud({ phoneNumberId, token: accessToken, graphVersion: GRAPH_VERSION, fetch, templates: names, language: templateLanguage });
    // The sender takes each template's name; the sweep its approved text, to send only words that fit it.
    live.templates = Object.fromEntries(Object.entries(templates).map(([purpose, t]) => [purpose, t.text]));
  }
  wireChannels(channelsFor(c.sendMode ?? "recorded", recordedSender(c.outboxDir ?? path.join(tmpdir(), "munshi-outbox")), live));
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
