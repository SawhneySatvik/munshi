// The outbox's wiring (BP-F3b). The senders are wired at boot and checked again before every sweep (the tick and the
// flush after an approval call wireOutbox): every deployment gets the recorded sender (ids and body hashes only, in the
// config's outbox folder); one whose send mode is live also gets WhatsApp Cloud where its credentials are set, and
// Instagram where its credentials are set and instagramCards() holds (channels.ts: an https MUNSHI_APP_URL and a media
// store), the very predicate the screens' channel state calls, evaluated afresh on each wiring, so a store unwired
// later unwires the sender before the next sweep. channelsFor decides, the database decides per delivery whether it
// may be real, and the sweep hands a real sender only a real shop's delivery. Without the card address no Instagram
// sender is wired: a pending post waits and lapses unposted, and the screens say so (channelState's no_card).
// Instagram's sender asks mediaUrlFor for the card's address, given only for a card the public role can read (the
// database's policies: an approved or sent Instagram campaign names it, unerased); whether the store holds its bytes is
// the card route's check when Meta fetches it. A campaign with no such card fails its post, never guessed. After an
// approval executes, the app flushes the outbox once, as munshi_jobs, so a demo's recorded sends show as sent at once
// instead of at the next tick; a slot the tick already took this minute is left to it. The jobs pool is the tick
// route's too.
import { tmpdir } from "node:os";
import path from "node:path";
import { type Channels, channelsFor, GRAPH_VERSION, instagramGraph, recordedSender, type TemplatePurpose, whatsAppCloud } from "@munshi/adapters/channels";
import { eraseUnboundIdentity } from "@munshi/adapters/identity";
import { createIdpPool, createJobsPool, log, runDueJobs, wireChannels } from "@munshi/core";
import { instagramCards, mediaUrlFor } from "./channels.ts";
import { config, tickSettings } from "./config.ts";
import { publicPool } from "./db.ts";
import { wirePaypal } from "./paypal.ts";

type Pool = ReturnType<typeof createJobsPool>;

// Kept on globalThis so next dev's module reloads reuse one pool and wire once.
const held = globalThis as typeof globalThis & {
  munshiJobsPool?: { url: string; pool: Pool } | undefined;
  munshiEraserPool?: { url: string; pool: ReturnType<typeof createIdpPool> } | undefined;
  /** The wiring's input that can change while the process runs: instagramCards() as last wired. */
  munshiOutboxWired?: { cards: boolean } | undefined;
};

export function wireOutbox(): void {
  const cards = instagramCards();
  if (held.munshiOutboxWired?.cards === cards) return;
  const c = config();
  const live: Omit<Channels, "recorded"> = {};
  if (c.whatsapp) {
    const { phoneNumberId, accessToken, templates, templateLanguage } = c.whatsapp;
    const names = Object.fromEntries(Object.entries(templates).map(([purpose, t]) => [purpose, t.name])) as Partial<Record<TemplatePurpose, string>>;
    live.whatsapp = whatsAppCloud({ phoneNumberId, token: accessToken, graphVersion: GRAPH_VERSION, fetch, templates: names, language: templateLanguage });
    // The sender takes each template's name; the sweep its approved text, to send only words that fit it.
    live.templates = Object.fromEntries(Object.entries(templates).map(([purpose, t]) => [purpose, t.text]));
  }
  const jobs = c.instagram ? jobsPool() : null;
  if (c.instagram && c.appUrl && c.publicDatabaseUrl && jobs && cards) {
    const { accountRef, businessAccountId, accessToken, graphHost } = c.instagram;
    live.instagram = instagramGraph({
      accounts: { [accountRef]: { igUserId: businessAccountId, token: accessToken } },
      mediaUrlFor: mediaUrlFor(c.appUrl, jobs, publicPool()),
      graphVersion: GRAPH_VERSION,
      host: graphHost,
      fetch,
    });
  }
  wireChannels(channelsFor(c.sendMode ?? "recorded", recordedSender(c.outboxDir ?? path.join(tmpdir(), "munshi-outbox")), live));
  wirePaypal(); // PayPal links an approval queued (recorded unless the sandbox keys are set)
  held.munshiOutboxWired = { cards };
}

/** The tick's check before its sweep: a wiring boot made is checked again (wireOutbox); with none yet, nothing. */
export function rewireOutbox(): void {
  if (held.munshiOutboxWired) wireOutbox();
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

/** The purge of lapsed sign-ups' identity eraser: the password adapter's eraseUnbound on idp's own pool (munshi_idp), or null
 *  where IDP_DATABASE_URL is unset. */
export function identityEraser(): ((subject: string) => Promise<boolean>) | null {
  const url = tickSettings().idpDatabaseUrl;
  if (!url) return null;
  if (held.munshiEraserPool?.url !== url) held.munshiEraserPool = { url, pool: createIdpPool(url) };
  const pool = held.munshiEraserPool.pool;
  return (subject) => eraseUnboundIdentity(pool, subject);
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
