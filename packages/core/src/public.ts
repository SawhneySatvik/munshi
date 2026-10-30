// The public API's site, key and origin (BLUEPRINT §5.1, §5.2), on the munshi_public pool. The tenant always comes from
// the slug in the path, never a payload. A slug answers only when it names a tenant whose site the platform verified
// (VERIFY1) and that has published a release; anything else is null, and the route answers the one 404 it answers for an
// unknown route. A publishable key `mpk_<slug>_<43 base64url>` is kept only as its sha256 and compared timing-safe
// (S1); one that is malformed, of another slug, unknown or revoked is null too.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type pg from 'pg';
import { asTenantId, cached, cacheKey, PINNED_TTL, PLATFORM_TENANT, SHORT_TTL } from './cache-keys.ts';
import { siteVerified } from './platform.ts';
import { withTx } from './session.ts';

// The public API's error codes (packages/contracts' ERRORS, which core does not import). A refusal carries a code, the
// input paths at fault and, for a limit, the seconds to wait; never a value or a database message.
export type ApiCode =
  | 'invalid'
  | 'idempotency_key_required'
  | 'stale_notice'
  | 'bot_check'
  | 'not_found'
  | 'slot_taken'
  | 'idempotency_mismatch'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'rate_limited'
  | 'hold_limit'
  | 'intake_paused'
  | 'internal';

export class ApiRefusal extends Error {
  readonly code: ApiCode;
  readonly fields: string[];
  readonly retryAfter: number | undefined;
  constructor(code: ApiCode, fields: string[] = [], retryAfter?: number) {
    super(code);
    this.name = 'ApiRefusal';
    this.code = code;
    this.fields = fields;
    this.retryAfter = retryAfter;
  }
}

export type SiteCtx = {
  slug: string;
  tenantId: string;
  siteId: string;
  name: string;
  businessType: string;
  dataClass: 'synthetic' | 'showcase' | 'live';
  currency: string;
  timeZone: string;
  live: boolean; // the deployment
  intake: 'open' | 'paused';
  bookingMode: 'none' | 'request' | 'slots';
  origins: string[];
  noticeVersion: string;
  consentVersion: string;
  release: { id: string; lookId: string; publishedAt: string; snapshots: Record<string, string> };
};

const SLUG = /^[a-z][a-z0-9-]{2,39}$/;
const KEY = /^mpk_([a-z][a-z0-9-]{2,39})_([A-Za-z0-9_-]{43})$/;

type SiteRow = {
  name: string;
  business_type: string;
  data_class: SiteCtx['dataClass'];
  currency: string;
  time_zone: string;
  deployment: string;
  site_id: string | null;
  intake: SiteCtx['intake'];
  booking_mode: SiteCtx['bookingMode'];
  origins: string[];
  privacy_version: string;
  consent_version: string;
};

/**
 * The site a slug names, if it is verified and published; null otherwise (one answer for every reason). The slug's
 * tenant, the verified site's latest release id and that release come through the cache (cache-keys.ts), nulls
 * included; the site's own settings (origins, intake, booking mode, notice versions) are read live on every request.
 */
export async function openSite(pub: pg.Pool, slug: string): Promise<SiteCtx | null> {
  if (!SLUG.test(slug)) return null;
  const tenantId = await cached(cacheKey(PLATFORM_TENANT, 'slug', slug), SHORT_TTL, async () => {
    const { rows: dir } = await pub.query<{ tenant_id: string }>('select tenant_id::text as tenant_id from ops.tenant_directory where slug = $1', [slug]);
    return dir[0]?.tenant_id ?? null;
  });
  if (!tenantId) return null;
  const tenant = asTenantId(tenantId);
  return withTx(pub, { kind: 'system', tenantId }, async (c) => {
    const releaseId = await cached(cacheKey(tenant, 'site'), SHORT_TTL, async () => {
      if (!(await siteVerified(c, tenantId))) return null;
      const { rows: latest } = await c.query<{ release_id: string | null }>(
        `select (select x.id::text from ops.site_release x where x.site_id = s.id order by x.published_at desc, x.id desc limit 1) as release_id
           from ops.site s order by s.created_at, s.id limit 1`,
      );
      return latest[0]?.release_id ?? null;
    });
    if (!releaseId) return null;
    const release = await cached(
      cacheKey(tenant, 'release', releaseId),
      PINNED_TTL,
      async () => {
        const { rows: rel } = await c.query<{ look_id: string; published_at: Date; snapshots: Record<string, string> }>(
          'select look_id::text as look_id, published_at, snapshots from ops.site_release where id = $1',
          [releaseId],
        );
        const x = rel[0];
        return x ? { id: releaseId, lookId: x.look_id, publishedAt: x.published_at.toISOString(), snapshots: x.snapshots } : null;
      },
      { keepNull: false },
    );
    if (!release) return null;
    const { rows } = await c.query<SiteRow>(
      `select t.name, t.business_type, t.data_class, t.currency, t.time_zone, coalesce((select d.kind from ops.deployment d), 'demo') as deployment,
              s.id::text as site_id, s.intake, s.booking_mode, s.origins, s.privacy_version, s.consent_version
         from ops.tenant t
         left join lateral (select * from ops.site x order by x.created_at, x.id limit 1) s on true
        where t.tenant_id = $1`,
      [tenantId],
    );
    const r = rows[0];
    if (!r?.site_id) return null;
    return {
      slug,
      tenantId,
      siteId: r.site_id,
      name: r.name,
      businessType: r.business_type,
      dataClass: r.data_class,
      currency: r.currency,
      timeZone: r.time_zone,
      live: r.deployment === 'live',
      intake: r.intake,
      bookingMode: r.booking_mode,
      origins: r.origins,
      noticeVersion: r.privacy_version,
      consentVersion: r.consent_version,
      release,
    };
  });
}

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest();

/**
 * The id of the live publishable key `bearer` is, for this site; null for a malformed key, another slug's, an unknown or
 * a revoked one. Every live key of the site is compared, each timing-safe, so the time taken says nothing of which.
 */
export async function siteKeyId(pub: pg.Pool, site: SiteCtx, bearer: string | null): Promise<string | null> {
  const m = KEY.exec(bearer ?? '');
  const given = sha256(bearer ?? '');
  const { rows } = await withTx(pub, { kind: 'system', tenantId: site.tenantId }, (c) =>
    c.query<{ id: string; key_sha256: Buffer }>('select id::text as id, key_sha256 from ops.site_key where site_id = $1 and revoked_at is null', [site.siteId]),
  );
  let found: string | null = null;
  for (const row of rows) if (timingSafeEqual(row.key_sha256, given)) found = row.id;
  return m && m[1] === site.slug ? found : null;
}

/** An Origin the site lists (exactly); a request without one passes only when `required` is false (a server render). */
export const originAllowed = (site: SiteCtx, origin: string | null, required: boolean): boolean =>
  origin === null ? !required : site.origins.includes(origin);

/**
 * A new publishable key for the site, made by an active owner in the caller's transaction (site_key_guard holds who).
 * The key is returned once; only its sha256 and a display prefix are stored.
 */
export async function issueSiteKey(c: pg.PoolClient, siteId: string, slug: string): Promise<{ keyId: string; key: string }> {
  if (!SLUG.test(slug)) throw new ApiRefusal('invalid', ['slug']);
  let secret = randomBytes(32).toString('base64url');
  while (!/^[A-Za-z0-9]{4}/.test(secret)) secret = randomBytes(32).toString('base64url');
  const key = `mpk_${slug}_${secret}`;
  const { rows } = await c.query<{ id: string }>(
    `insert into ops.site_key (tenant_id, site_id, key_sha256, prefix)
     values (nullif(current_setting('munshi.tenant_id', true), '')::uuid, $1, $2, $3) returning id::text as id`,
    [siteId, sha256(key), `mpk_${slug}_${secret.slice(0, 4)}`],
  );
  return { keyId: (rows[0] as { id: string }).id, key };
}
