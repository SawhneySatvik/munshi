// What /api/v1 runs on: the munshi_public pool (never the app's, and never the session cookie, §5.2), the key that
// hashes an IP, a device token and a hold token, the bot-check port and the media store. Tests swap the ports in.
// The first call wires core's cache (MUNSHI_CACHE_URL's adapter, BLUEPRINT §4.8) unless a test wired one already.
import { createHmac } from "node:crypto";
import { type BotCheckPort, recordedBotCheck } from "@munshi/adapters/botcheck";
import { cacheFor } from "@munshi/adapters/cache";
import { cacheWired, wireCache } from "@munshi/core";
import { config } from "../server/config.ts";
import { publicPool } from "../server/db.ts";

/** Where a published card's or art document's bytes live. None is wired before the deploy wave: the route answers 404. */
export type MediaStore = { read: (storageKey: string) => Promise<Buffer | null> };
const NO_STORE: MediaStore = { read: async () => null };

export type ApiDeps = { pub: ReturnType<typeof publicPool>; secret: Buffer; botCheck: BotCheckPort; media: MediaStore };

let swapped: Partial<Pick<ApiDeps, "botCheck" | "media">> = {};

/** Tests only: replace the bot check or the media store; `{}` restores the defaults. */
export function swapApiPorts(ports: Partial<Pick<ApiDeps, "botCheck" | "media">>): void {
  swapped = ports;
}

export function apiDeps(): ApiDeps {
  const c = config();
  if (!cacheWired()) wireCache(cacheFor(c.cacheUrl), c.deployment ?? "demo");
  // MUNSHI_RATE_SECRET keys the hashes; config requires it on live. A demo without one derives a key from the session
  // secret, so an IP is still never stored as itself.
  const secret = c.rateSecret ? Buffer.from(c.rateSecret, "utf8") : createHmac("sha256", c.sessionSecret).update("munshi.api.rate").digest();
  return { pub: publicPool(), secret, botCheck: swapped.botCheck ?? recordedBotCheck(), media: swapped.media ?? NO_STORE };
}

/** A keyed hash of `value` under `purpose`: what an IP, a device token or a hold's derivation becomes. */
export const keyed = (secret: Buffer, purpose: string, value: string): Buffer => createHmac("sha256", secret).update(`${purpose}\u001f${value}`).digest();
