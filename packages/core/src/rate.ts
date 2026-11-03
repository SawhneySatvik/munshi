// The public API's rate limits: per IP 5 writes in 10 minutes and 120 reads a minute, per publishable key
// 300 writes a day. Counted in ops.rate_counter as munshi_public, one statement per hit: a bucket is the first 16 bytes
// of the sha256 of the limit's name and its subject (an IP's keyed hash, a key's id), so the table holds no address and
// no key. The window is a fixed bin of the database clock; Retry-After is the seconds left in it.
import { createHash } from 'node:crypto';
import type pg from 'pg';

export const RATE_LIMITS = {
  'api.write.ip': { hits: 5, window: '10 minutes', seconds: 600 },
  'api.read.ip': { hits: 120, window: '1 minute', seconds: 60 },
  'api.write.key': { hits: 300, window: '1 day', seconds: 86_400 },
} as const;
export type RateLimit = keyof typeof RATE_LIMITS;

export type RateHit = { allowed: true } | { allowed: false; retryAfter: number };

export async function hitRate(pub: pg.Pool, limit: RateLimit, subject: Buffer | string): Promise<RateHit> {
  const rule = RATE_LIMITS[limit];
  const bucket = createHash('sha256').update(limit).update('\u001f').update(subject).digest().subarray(0, 16);
  const { rows } = await pub.query<{ hits: number; left: number }>(
    `insert into ops.rate_counter as r (bucket, window_start, hits) values ($1, date_bin($2::interval, now(), timestamptz '2000-01-01'), 1)
     on conflict (bucket, window_start) do update set hits = r.hits + 1
     returning hits, ceil(extract(epoch from (window_start + $2::interval - now())))::int as left`,
    [bucket, rule.window],
  );
  const row = rows[0] as { hits: number; left: number };
  return row.hits <= rule.hits ? { allowed: true } : { allowed: false, retryAfter: Math.max(1, Math.min(rule.seconds, row.left)) };
}
