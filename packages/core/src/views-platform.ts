// The superadmin console's reads (BLUEPRINT §6.5, D-052), run in the operator's one transaction (platform.ts's
// withOperator) as munshi_platform, which holds no grant on any shop's books, approvals, snapshots or audit chain. Every
// config value comes with the platform row it was read from and the approved change that wrote it (PlatformRowRef), so
// the console shows the change id beside it; a value with no row is the schema's default (AI off, no grant), shown as
// such. A shop is read under its own tenant context (ops.tenant and ai.usage force its RLS), never with an actor.
import type pg from 'pg';
import { CoreError } from './errors.ts';
import {
  type ChangeKind,
  type ChangeListed,
  changeDiff,
  listChanges,
  type OperatorSession,
  type PlatformDiff,
  type PlatformLimits,
  type PlatformRowRef,
  platformLimits,
  verifyPlatformChain,
  withOperator,
} from './platform.ts';
import { MEDIA_ROLES, TEXT_ROLES } from './allow.ts';

export type ConsoleGrant = { channel: 'whatsapp' | 'instagram'; granted: boolean; maxTestRecipients: number; accountRef: string | null; from: PlatformRowRef | null };
export type ConsoleShop = {
  tenantId: string;
  slug: string;
  name: string;
  businessType: string;
  dataClass: string;
  sandbox: boolean;
  createdAt: string;
  limits: PlatformLimits;
  // Today's model calls, the shop's day, from ai.usage (allow()'s own count).
  usage: { day: string; text: number; media: number };
  grants: ConsoleGrant[];
};

type TenantRow = { name: string; business_type: string; data_class: string; sandbox: boolean; created_at: string; day: string; text: number; media: number };
type GrantRow = { id: string; change_id: string; channel: 'whatsapp' | 'instagram'; granted: boolean; max_test_recipients: number; account_ref: string | null };

const CHANNELS = ['whatsapp', 'instagram'] as const;

async function shopIn(c: pg.ClientBase, tenantId: string, slug: string): Promise<ConsoleShop | null> {
  await c.query(`select set_config('munshi.tenant_id', $1, true)`, [tenantId]);
  const { rows } = await c.query<TenantRow>(
    `select t.name, t.business_type, t.data_class, t.sandbox, t.created_at::text as created_at,
            (now() at time zone t.time_zone)::date::text as day,
            coalesce((select sum(u.calls) from ai.usage u where u.day = (now() at time zone t.time_zone)::date and u.role = any ($2::text[])), 0)::int as text,
            coalesce((select sum(u.calls) from ai.usage u where u.day = (now() at time zone t.time_zone)::date and u.role = any ($3::text[])), 0)::int as media
       from ops.tenant t where t.tenant_id = $1`,
    [tenantId, TEXT_ROLES, MEDIA_ROLES],
  );
  const t = rows[0];
  if (!t) return null;
  const limits = await platformLimits(c, tenantId);
  const g = await c.query<GrantRow>(
    `select distinct on (channel) id, change_id, channel, granted, max_test_recipients, account_ref from platform.channel_grant
      where tenant_id = $1 order by channel, effective_from desc, id desc`,
    [tenantId],
  );
  const grants = CHANNELS.map((channel): ConsoleGrant => {
    const r = g.rows.find((x) => x.channel === channel);
    return r
      ? { channel, granted: r.granted, maxTestRecipients: r.max_test_recipients, accountRef: r.account_ref, from: { table: 'platform.channel_grant', id: r.id, changeId: r.change_id } }
      : { channel, granted: false, maxTestRecipients: 0, accountRef: null, from: null };
  });
  return {
    tenantId,
    slug,
    name: t.name,
    businessType: t.business_type,
    dataClass: t.data_class,
    sandbox: t.sandbox,
    createdAt: t.created_at,
    limits,
    usage: { day: t.day, text: t.text, media: t.media },
    grants,
  };
}

const outOfTenant = (c: pg.ClientBase) => c.query(`select set_config('munshi.tenant_id', '', true)`);

/** Every shop in the directory, newest first, each read under its own context. */
export async function consoleShops(c: pg.ClientBase): Promise<ConsoleShop[]> {
  const { rows } = await c.query<{ slug: string; tenant_id: string }>('select slug, tenant_id::text from ops.tenant_directory order by created_at desc, slug');
  const shops: ConsoleShop[] = [];
  for (const d of rows) {
    const s = await shopIn(c, d.tenant_id, d.slug);
    if (s) shops.push(s);
  }
  await outOfTenant(c);
  return shops;
}

/** One shop, by its tenant id; not_found for an id the directory does not hold. */
export async function consoleShop(c: pg.ClientBase, tenantId: string): Promise<ConsoleShop> {
  const { rows } = await c.query<{ slug: string }>('select slug from ops.tenant_directory where tenant_id = $1', [UUID.test(tenantId) ? tenantId : null]);
  const shop = rows[0] ? await shopIn(c, tenantId, rows[0].slug) : null;
  await outOfTenant(c);
  if (!shop) throw new CoreError('not_found');
  return shop;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type ConsoleDefaults = {
  defaults: { aiEnabled: boolean; aiDailyCalls: number; mediaDailyCalls: number; sandboxMediaDailyCallsTotal: number; from: PlatformRowRef } | null;
  slugs: { slug: string; note: string | null; changeId: string | null }[];
};

/** The demo shops' default config (latest wins) and the reserved slugs. */
export async function consoleDefaults(c: pg.ClientBase): Promise<ConsoleDefaults> {
  const d = await c.query<{ id: string; change_id: string; ai_enabled: boolean; ai_daily_calls: number; media_daily_calls: number; sandbox_media_daily_calls_total: number }>(
    `select id, change_id, ai_enabled, ai_daily_calls, media_daily_calls, sandbox_media_daily_calls_total from platform.default_config
      where scope = 'demo_shops' order by effective_from desc, id desc limit 1`,
  );
  const s = await c.query<{ slug: string; note: string | null; change_id: string | null }>('select slug, note, change_id from platform.reserved_slug order by slug');
  const r = d.rows[0];
  return {
    defaults: r
      ? {
          aiEnabled: r.ai_enabled,
          aiDailyCalls: r.ai_daily_calls,
          mediaDailyCalls: r.media_daily_calls,
          sandboxMediaDailyCallsTotal: r.sandbox_media_daily_calls_total,
          from: { table: 'platform.default_config', id: r.id, changeId: r.change_id },
        }
      : null,
    slugs: s.rows.map((x) => ({ slug: x.slug, note: x.note, changeId: x.change_id })),
  };
}

export type ConsoleChange = ChangeListed & { proposer: string; decider: string | null; slug: string | null };
export type ConsoleLog = { changes: ConsoleChange[]; chainBrokenAt: string | null };

type Names = { operators: Map<string, string>; slugs: Map<string, string> };

async function names(c: pg.ClientBase): Promise<Names> {
  const o = await c.query<{ id: string; display_name: string }>('select id::text, display_name from platform.operator');
  const d = await c.query<{ tenant_id: string; slug: string }>('select tenant_id::text, slug from ops.tenant_directory');
  return { operators: new Map(o.rows.map((r) => [r.id, r.display_name])), slugs: new Map(d.rows.map((r) => [r.tenant_id, r.slug])) };
}

const named = (ch: ChangeListed, n: Names): ConsoleChange => ({
  ...ch,
  proposer: n.operators.get(ch.proposedBy) ?? ch.proposedBy,
  decider: ch.decidedBy ? (n.operators.get(ch.decidedBy) ?? ch.decidedBy) : null,
  slug: ch.tenantId ? (n.slugs.get(ch.tenantId) ?? null) : null,
});

/** The change log, newest first, and whether the platform chain verifies (the first broken seq, or null). */
export async function consoleLog(c: pg.ClientBase, opts: { pending?: boolean } = {}): Promise<ConsoleLog> {
  const n = await names(c);
  const changes = (await listChanges(c, opts)).map((ch) => named(ch, n));
  return { changes, chainBrokenAt: await verifyPlatformChain(c) };
}

// A channel grant and an operator change are approved only with a TOTP code from the last 5 minutes (change_guard).
export const NEEDS_CODE: readonly ChangeKind[] = ['channel_grant', 'operator'];

/** One change as the approval screen shows it: what it would write against what is there now, and its digest. */
export async function consoleChange(c: pg.ClientBase, changeId: string): Promise<{ change: ConsoleChange; diff: PlatformDiff; needsCode: boolean }> {
  const n = await names(c);
  const diff = await changeDiff(c, changeId);
  await outOfTenant(c);
  const { rows } = await c.query<ChangeListed>(
    `select id, kind, tenant_id as "tenantId", proposed_by as "proposedBy", proposed_at::text as "proposedAt", verdict, decided_by as "decidedBy"
       from platform.change where id = $1`,
    [diff.changeId],
  );
  return { change: named(rows[0] as ChangeListed, n), diff, needsCode: NEEDS_CODE.includes(diff.kind) };
}

/** The signed-in operator's display name. */
export async function operatorName(c: pg.ClientBase, session: OperatorSession): Promise<string> {
  const { rows } = await c.query<{ display_name: string }>('select display_name from platform.operator where id = $1', [session.operatorId]);
  return rows[0]?.display_name ?? '';
}

/** The console's sign-out: the session row is revoked, once (platform.session_guard). */
export function endOperatorSession(pool: pg.Pool, session: OperatorSession): Promise<void> {
  return withOperator(pool, session, async (c) => {
    await c.query('update platform.operator_session set revoked_at = now() where id = $1 and revoked_at is null', [session.sessionId]);
  });
}
