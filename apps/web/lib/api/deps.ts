// What /api/v1 runs on: the munshi_public pool (never the app's, and never the session cookie, §5.2), the key that
// hashes an IP, a device token and a hold token, the bot-check port and the media store. Tests swap the ports in.
// The first call wires core's cache (MUNSHI_CACHE_URL's adapter, BLUEPRINT §4.8) unless a test wired one already.
// The media store is the config's (packages/config's media): Supabase Storage, a folder on this machine, or none.
import { createHmac } from "node:crypto";
import { type BotCheckPort, recordedBotCheck } from "@munshi/adapters/botcheck";
import { cacheFor } from "@munshi/adapters/cache";
import { localMediaStore, type MediaReader, type MediaStore as WritableStore, supabaseMediaStore } from "@munshi/adapters/media";
import { cacheWired, wireCache } from "@munshi/core";
import { config } from "../server/config.ts";
import { publicPool } from "../server/db.ts";

/** Where a published card's or art document's bytes live; a store that can also write takes uploads (a post's card). */
export type MediaStore = MediaReader | WritableStore;
const NO_STORE: MediaStore = { read: async () => null };

export type ApiDeps = { pub: ReturnType<typeof publicPool>; secret: Buffer; botCheck: BotCheckPort; media: MediaStore };

let swapped: { botCheck?: BotCheckPort; media?: MediaStore | null } = {};

/** Tests only: replace the bot check or the media store (null: none wired); `{}` restores the defaults. */
export function swapApiPorts(ports: { botCheck?: BotCheckPort; media?: MediaStore | null }): void {
  swapped = ports;
}

// One store per settings object, so a process (and next dev's reloads) reuses it.
const built = new WeakMap<object, WritableStore>();
function configured(): WritableStore | null {
  const m = config().media;
  if (!m) return null;
  let store = built.get(m);
  if (!store) {
    store = m.kind === "supabase" ? supabaseMediaStore({ url: m.url, secretKey: m.secretKey, bucket: m.bucket }) : localMediaStore(m.dir);
    built.set(m, store);
  }
  return store;
}

/** The media store wired, or null while none is (then no card is served, and Instagram cannot post: channels.ts). */
export const mediaStore = (): MediaStore | null => (swapped.media !== undefined ? swapped.media : configured());

/** The store an upload is written to: the wired one, if it can write; else null (then nothing can be attached). */
export const writableStore = (): WritableStore | null => {
  const store = mediaStore();
  return store && "put" in store ? store : null;
};

export function apiDeps(): ApiDeps {
  const c = config();
  if (!cacheWired()) wireCache(cacheFor(c.cacheUrl), c.deployment ?? "demo");
  // MUNSHI_RATE_SECRET keys the hashes; config requires it on live. A demo without one derives a key from the session
  // secret, so an IP is still never stored as itself.
  const secret = c.rateSecret ? Buffer.from(c.rateSecret, "utf8") : createHmac("sha256", c.sessionSecret).update("munshi.api.rate").digest();
  return { pub: publicPool(), secret, botCheck: swapped.botCheck ?? recordedBotCheck(), media: mediaStore() ?? NO_STORE };
}

/** A keyed hash of `value` under `purpose`: what an IP, a device token or a hold's derivation becomes. */
export const keyed = (secret: Buffer, purpose: string, value: string): Buffer => createHmac("sha256", secret).update(`${purpose}\u001f${value}`).digest();
