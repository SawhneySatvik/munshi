// Red-proofs of the public API, /api/v1 (BP-API-1): apps/web/test/api/api-{reads,writes}.test.ts, run by the web vitest
// config (its sabotage plugin applies the ts cases). Each breaks one protection; the named test must then fail.
import type { Case } from './case.ts';

const WEB = { dir: 'apps/web', config: 'vitest.config.ts' } as const;
const READS = 'test/api/api-reads.test.ts';
const WRITES = 'test/api/api-writes.test.ts';
const PUBLIC = 'packages/core/src/public.ts';
const SITE_API = 'packages/core/src/site-api.ts';
const PIPELINE = 'apps/web/lib/api/pipeline.ts';

const VERIFY1 =
  'VERIFY1 an unverified site, an unknown slug, a malformed slug or parameter, an unknown or malformed order code and an unknown route answer the same bytes; verified, the site answers';
const S1 = "S1 a bad, another slug's, a revoked or a missing key answers the one 404, identical to an unknown route";
const S3 = 'S3 every figure in every GET response is a release cell that resolves through its ref and equals the book row it names';
const S5_FORM = 'S5 API enquiry: 202 stored; a filled honeypot is 202 and stores nothing; a failed bot check is 400 bot_check and stores nothing';
const S5_TABLE = 'S5 413 over 4 KB, 415 for anything but JSON, 400 for malformed JSON, an unknown field or a malformed key';

export const API_CASES: Case[] = [
  // VERIFY1: serve a site the platform has not verified
  {
    sabotage: 'v2-api-verify-skipped',
    file: READS,
    test: VERIFY1,
    ...WEB,
    ts: { file: PUBLIC, from: 'if (!(await siteVerified(c, tenantId))) return null;', to: 'if (!tenantId) return null;' },
  },
  // the 404's sameness: a malformed path parameter answered 400
  {
    sabotage: 'v2-api-bad-param-400',
    file: READS,
    test: VERIFY1,
    ...WEB,
    ts: { file: PIPELINE, from: 'if (!parsed?.success) throw new Answer(notFound(requestId));', to: 'if (!parsed?.success) throw new Answer(apiError("invalid", requestId));' },
  },
  // S1: accept any of the site's live keys, whatever the bearer sends
  {
    sabotage: 'v2-api-any-key',
    file: WRITES,
    test: S1,
    ...WEB,
    ts: { file: PUBLIC, from: 'return m && m[1] === site.slug ? found : null;', to: 'return rows[0]?.id ?? null;' },
  },
  // S1's source scan: the key hash compared with Buffer.equals (harness-level: the scanned text is planted)
  { sabotage: 'v2-s1-hash-compare-planted', file: WRITES, test: "S1 the key is compared timing-safe: core's resolver uses timingSafeEqual and no === on a hash", ...WEB },
  // S2: any origin may write
  {
    sabotage: 'v2-api-any-origin',
    file: WRITES,
    test: 'S2 a write from an origin the site does not list, or with none, is the 404 and stores nothing',
    ...WEB,
    ts: { file: PUBLIC, from: 'origin === null ? !required : site.origins.includes(origin);', to: 'true;' },
  },
  // S3: a figure that is not its cell's value
  {
    sabotage: 'v2-api-figure-not-cell',
    file: READS,
    test: S3,
    ...WEB,
    ts: { file: SITE_API, from: "return v?.k === 'money' ? { minor: Number(v.n), currency: v.c, ref: refOf(s, row, col) } : null;", to: "return v?.k === 'money' ? { minor: Number(v.n) + 1, currency: v.c, ref: refOf(s, row, col) } : null;" },
  },
  // PUB1: the public role reads any snapshot of the tenant
  {
    sabotage: 'v2-api-pub1-policy',
    file: READS,
    test: 'PUB1 through the API: a display snapshot of the shop (not pinned by a release) is Cannot verify, and the public role cannot read it',
    ...WEB,
    sql: 'drop policy snapshot_public on snap.snapshot',
  },
  // S4: a public write that changes the books (a trigger, as the superuser, deletes an audit row on each site request)
  {
    sabotage: 'v2-api-books-written',
    file: WRITES,
    test: 'S4 the public routes write ops rows only: a scripted run of every write leaves books, snap, audit and approval row counts unchanged',
    ...WEB,
    sql: `create function public.api_sabotage_leak() returns trigger language plpgsql security definer set search_path = pg_catalog as $$
begin
  perform set_config('session_replication_role', 'replica', true);
  delete from audit.audit_log where ctid = (select a.ctid from audit.audit_log a limit 1);
  perform set_config('session_replication_role', 'origin', true);
  return new;
end $$;
create trigger zz_api_sabotage after insert on ops.site_request for each row execute function public.api_sabotage_leak();`,
  },
  // S5: no body limit
  { sabotage: 'v2-api-no-size-limit', file: WRITES, test: S5_TABLE, ...WEB, ts: { file: PIPELINE, from: 'const MAX_BODY = 4096;', to: 'const MAX_BODY = 1_000_000;' } },
  // S5: the honeypot's request is stored
  {
    sabotage: 'v2-api-honeypot-stores',
    file: WRITES,
    test: S5_FORM,
    ...WEB,
    ts: { file: PIPELINE, from: 'if (typeof body.website === "string" && body.website !== "")', to: 'if (typeof body.website === "string" && body.website === "honeypot")' },
  },
  // S5: a failed bot check passes
  {
    sabotage: 'v2-api-bot-check-ignored',
    file: WRITES,
    test: S5_FORM,
    ...WEB,
    ts: { file: PIPELINE, from: 'if (!r.success || r.hostname === null || !hosts.includes(r.hostname)) throw new ApiRefusal("bot_check");', to: 'if (r.hostname === null) throw new ApiRefusal("bot_check");' },
  },
  // S5: the IP's write limit raised past reach
  {
    sabotage: 'v2-api-write-limit',
    file: WRITES,
    test: 'S5 the sixth write from one IP in ten minutes is 429 with Retry-After',
    ...WEB,
    ts: { file: 'packages/core/src/rate.ts', from: "'api.write.ip': { hits: 5,", to: "'api.write.ip': { hits: 500," },
  },
  // the read limit raised past reach
  {
    sabotage: 'v2-api-read-limit',
    file: READS,
    test: 'API rate limit: a GET past 120 from one IP in a minute is 429 with Retry-After',
    ...WEB,
    ts: { file: 'packages/core/src/rate.ts', from: "'api.read.ip': { hits: 120,", to: "'api.read.ip': { hits: 12000," },
  },
  // S6: every request claims a key of its own, so a replay writes again
  {
    sabotage: 'v2-api-idempotency-scope',
    file: WRITES,
    test: 'API hold: 201 with a ten-minute hold; a replay answers the same bytes and stores one row; another body under the key is 409',
    ...WEB,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the source text of site-api.ts, not a template
    ts: { file: SITE_API, from: 'const scopeOf = (site: SiteCtx) => `site:${site.siteId}`;', to: 'const scopeOf = (_site: SiteCtx) => `site:${randomUUID()}`;' },
  },
  // S7: paused intake not answered 503 (the database still refuses the write)
  {
    sabotage: 'v2-api-intake-unchecked',
    file: WRITES,
    test: 'S7 paused intake answers 503 intake_paused to a POST while GETs still work',
    ...WEB,
    ts: { file: SITE_API, from: "if (site.intake !== 'open') throw new ApiRefusal('intake_paused');", to: "if (site.intake === 'closed') throw new ApiRefusal('intake_paused');" },
  },
  // S10: on the demo, the caller's phone passed through (the database then refuses it)
  {
    sabotage: 'v2-api-demo-phone',
    file: WRITES,
    test: 'S10 API book: a hold becomes a request; on the demo the real-looking name and phone are stored as the samples; stale versions are 400; a wrong token is the 404',
    ...WEB,
    ts: { file: SITE_API, from: 'return site.live ? e164 : SAMPLE_PHONE;', to: 'return e164;' },
  },
  // ORD1: a cart total that is not the sum of its lines' counter arithmetic
  {
    sabotage: 'v2-api-order-total',
    file: WRITES,
    test: "ORD1 API order: 201, the lines priced from the release's cells with the counter's line function and no offer discount; a replay answers the same bytes, one request stored",
    ...WEB,
    ts: { file: SITE_API, from: 'total: figures.total,', to: 'total: { ...figures.total, minor: Math.round(figures.total.minor * 0.9) },' },
  },
];
