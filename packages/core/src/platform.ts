// The superadmin's platform (BLUEPRINT §2.10.15, §6.5; Munim R24): operators sign in with a TOTP code that counts once,
// and every platform setting changes only as an approved platform.change. A change is proposed in one transaction and
// decided in a later one (the change guard); its execution writes the row from the payload stored at proposal, read back
// from platform.change by the INSERT itself, never from the request, in the approval's transaction, with the chain
// entries the triggers add (09_idp_platform.sql). The approver approves the diff they were shown: approveChange takes
// its digest and refuses one that has gone stale. Runs as munshi_platform; platformLimits and siteVerified are also read
// by the app, jobs and public roles. Every operator transaction names its operator here, and only here (actAs).
import { createHash } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { dropSite } from './cache-keys.ts';
import { CoreError, toCoreError } from './errors.ts';
import { matchStep, newTotpSecret, openSecret, otpauthUri, STEP_SECONDS, sealSecret } from './platform-totp.ts';

declare const minted: unique symbol;

// A signed-in operator. Only signInOperator and openOperatorSession make one (the brand is not exported). `totpAt` is the
// database time of the code that opened it, and only signInOperator sets it: the cookie path proves no fresh code.
export type OperatorSession = { readonly sessionId: string; readonly operatorId: string; readonly totpAt: string | null; readonly [minted]: true };
const mint = (sessionId: string, operatorId: string, totpAt: string | null) => ({ sessionId, operatorId, totpAt }) as OperatorSession;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// The platform's refusals (MS010, MS011, MS017, MS018) are not in errors.ts's map yet; here they are `refused`.
const REFUSALS = ['MS010', 'MS011', 'MS017', 'MS018'];
function refusal(err: unknown): CoreError {
  const e = toCoreError(err);
  return e.sqlstate && REFUSALS.includes(e.sqlstate) ? new CoreError('refused', { sqlstate: e.sqlstate }) : e;
}

async function platformTx<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  let client: pg.PoolClient | undefined;
  let broken = false;
  try {
    client = await pool.connect();
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    if (client) await client.query('rollback').catch(() => (broken = true));
    throw refusal(err);
  } finally {
    client?.release(broken);
  }
}

const actAs = (c: pg.ClientBase, operatorId: string) => c.query(`select set_config('munshi.operator_id', $1, true)`, [operatorId]);

type OperatorRow = { id: string; subject: string; totp_secret_enc: Buffer };

// Counts a code once for the acting operator: its step must be later than the last one used, set in one compare-and-set,
// so a replay, or an older code after a newer one, matches no row. Only then is munshi.totp_at set, from the database's
// clock, which the guards judge freshness by.
async function consumeCode(c: pg.ClientBase, op: OperatorRow, code: string, platformSecret: string): Promise<boolean> {
  const secret = openSecret(op.totp_secret_enc, op.subject, platformSecret);
  const { rows } = await c.query<{ step: string }>('select floor(extract(epoch from now()) / $1)::bigint::text as step', [STEP_SECONDS]);
  const step = secret && matchStep(secret, code, Number(rows[0]?.step));
  if (step === null) return false;
  const used = await c.query('update platform.operator set totp_last_step = $2 where id = $1 and active and totp_last_step < $2', [op.id, step]);
  if (used.rowCount !== 1) return false;
  await c.query(`select set_config('munshi.totp_at', now()::text, true)`);
  return true;
}

// Sign-in's second factor. The password is the identity adapter's (BP-AUTH-1): `subject` is the identity it verified.
// Null for every failure, one shape.
export async function signInOperator(pool: pg.Pool, subject: string, code: string, platformSecret: string): Promise<OperatorSession | null> {
  if (!UUID.test(subject)) return null;
  return platformTx(pool, async (c) => {
    const { rows } = await c.query<OperatorRow>('select id, subject::text, totp_secret_enc from platform.operator where subject = $1 and active', [subject]);
    const op = rows[0];
    if (!op) return null;
    await actAs(c, op.id);
    if (!(await consumeCode(c, op, code, platformSecret))) return null;
    const s = await c.query<{ id: string; at: string }>(
      `insert into platform.operator_session (operator_id, subject_epoch, expires_at)
       values ($1, coalesce((select x.epoch from ops.subject_summary x where x.provider = 'password' and x.subject = $2), 0), now() + interval '2 hours')
       returning id, created_at::text as at`,
      [op.id, op.subject],
    );
    const row = s.rows[0] as { id: string; at: string };
    return mint(row.id, op.id, row.at);
  });
}

// Live: not revoked, not expired, its operator active, opened at the identity's current epoch (a reset ends it).
const LIVE = `select s.id, s.operator_id from platform.operator_session s join platform.operator o on o.id = s.operator_id
               where s.id = $1 and s.revoked_at is null and s.expires_at > now() and o.active
                 and s.subject_epoch = coalesce((select x.epoch from ops.subject_summary x
                                                  where x.provider = 'password' and x.subject = o.subject::text), 0)`;

// The console's cookie names a session id; this re-opens it, if live, without the sign-in's code.
export async function openOperatorSession(pool: pg.Pool, sessionId: string): Promise<OperatorSession | null> {
  if (!UUID.test(sessionId)) return null;
  const { rows } = await platformTx(pool, (c) => c.query<{ id: string; operator_id: string }>(LIVE, [sessionId]));
  return rows[0] ? mint(rows[0].id, rows[0].operator_id, null) : null;
}

// One transaction as the session's operator, the session re-checked inside it. A session fresh from its code carries that
// code's time as munshi.totp_at; the change guard decides whether it is still within 5 minutes.
export async function withOperator<T>(pool: pg.Pool, session: OperatorSession, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  return platformTx(pool, async (c) => {
    await actAs(c, session.operatorId);
    const { rows } = await c.query<{ operator_id: string }>(LIVE, [session.sessionId]);
    if (rows[0]?.operator_id !== session.operatorId) throw new CoreError('refused');
    if (session.totpAt) await c.query(`select set_config('munshi.totp_at', $1, true)`, [session.totpAt]);
    return fn(c);
  });
}

// ---- Limits: what allow() (BP-AI-1) and the console read ----

export type PlatformRowRef = { table: string; id: string; changeId: string | null };
export type PlatformLimits = {
  source: 'shop' | 'default' | 'none';
  aiEnabled: boolean;
  aiDailyCalls: number; // text roles
  mediaDailyCalls: number; // vision, segment, voice
  deploymentDailyCalls: number;
  sandboxAiEnabled: boolean;
  siteVerified: boolean;
  sandboxMediaDailyCallsTotal: number | null; // the one ceiling all sandboxes share; null for a shop that is not one
  from: PlatformRowRef | null; // the approved row these came from
};

type LimitsRow = {
  ctx: string | null;
  tenant: { data_class: string; sandbox: boolean } | null;
  shop: { id: string; change_id: string; ai_enabled: boolean; ai_daily_calls: number; media_daily_calls: number; site_verified: boolean } | null;
  dflt: {
    id: string;
    change_id: string;
    ai_enabled: boolean;
    ai_daily_calls: number;
    media_daily_calls: number;
    sandbox_media_daily_calls_total: number;
    deployment_daily_calls: number;
    sandbox_ai_enabled: boolean;
  } | null;
};

// The shop's latest platform.shop_config wins outright; with none, the demo's sample shops (synthetic and showcase, which
// exist only on a demo deployment, sandboxes included) take the latest platform.default_config; else AI is off and the
// site hidden (D-045). The caller's transaction must be under this tenant's context: ops.tenant forces RLS, and an
// unreadable tenant would otherwise read as "off" for the wrong reason.
export async function platformLimits(c: pg.ClientBase, tenantId: string): Promise<PlatformLimits> {
  const { rows } = await c.query<LimitsRow>(
    `select nullif(current_setting('munshi.tenant_id', true), '') as ctx,
            (select to_jsonb(t) from (select data_class, sandbox from ops.tenant where tenant_id = $1) t) as tenant,
            (select to_jsonb(s) from (select id, change_id, ai_enabled, ai_daily_calls, media_daily_calls, site_verified from platform.shop_config
                                       where tenant_id = $1 order by effective_from desc, id desc limit 1) s) as shop,
            (select to_jsonb(d) from (select id, change_id, ai_enabled, ai_daily_calls, media_daily_calls, sandbox_media_daily_calls_total,
                                             deployment_daily_calls, sandbox_ai_enabled
                                        from platform.default_config where scope = 'demo_shops' order by effective_from desc, id desc limit 1) d) as dflt`,
    [tenantId],
  );
  const { ctx, tenant, shop, dflt } = rows[0] as LimitsRow;
  if (ctx !== tenantId) throw new CoreError('refused');
  if (!tenant) throw new CoreError('not_found');
  const sandboxMediaDailyCallsTotal = tenant.sandbox ? (dflt?.sandbox_media_daily_calls_total ?? 0) : null;
  const deploymentDailyCalls = dflt?.deployment_daily_calls ?? 0;
  const sandboxAiEnabled = dflt?.sandbox_ai_enabled ?? false;
  if (shop) {
    const { ai_enabled, ai_daily_calls, media_daily_calls, site_verified } = shop;
    const from = { table: 'platform.shop_config', id: shop.id, changeId: shop.change_id };
    return {
      source: 'shop', aiEnabled: ai_enabled, aiDailyCalls: ai_daily_calls, mediaDailyCalls: media_daily_calls,
      deploymentDailyCalls, sandboxAiEnabled, siteVerified: site_verified, sandboxMediaDailyCallsTotal, from,
    };
  }
  const sample = tenant.data_class === 'synthetic' || tenant.data_class === 'showcase';
  if (sample && dflt) {
    const from = { table: 'platform.default_config', id: dflt.id, changeId: dflt.change_id };
    return {
      source: 'default', aiEnabled: dflt.ai_enabled, aiDailyCalls: dflt.ai_daily_calls, mediaDailyCalls: dflt.media_daily_calls,
      deploymentDailyCalls, sandboxAiEnabled, siteVerified: false, sandboxMediaDailyCallsTotal, from,
    };
  }
  return {
    source: 'none', aiEnabled: false, aiDailyCalls: 0, mediaDailyCalls: 0, deploymentDailyCalls, sandboxAiEnabled,
    siteVerified: false, sandboxMediaDailyCallsTotal, from: null,
  };
}

// VERIFY1's read: whether a shop's site may be served. The public role reads only these columns of platform.shop_config.
export async function siteVerified(c: pg.ClientBase, tenantId: string): Promise<boolean> {
  const { rows } = await c.query<{ site_verified: boolean }>(
    'select site_verified from platform.shop_config where tenant_id = $1 order by effective_from desc, id desc limit 1',
    [tenantId],
  );
  return rows[0]?.site_verified === true;
}

// ---- Changes ----

export type ChangeKind = 'shop_config' | 'site_verify' | 'default_config' | 'channel_grant' | 'reserved_slug' | 'operator';
export type PlatformValue = boolean | number | string | null;
// `set`: the payload keys to change, by their column names; every other key keeps its current value.
export type ChangeInput = { kind: ChangeKind; tenantId?: string | null; set: Record<string, unknown> };

const flag = z.boolean();
const cap = (max: number) => z.number().int().min(0).max(max);
// A short name the change payload's CHECK admits: no run of seven digits, so no phone number rides in it (CH1).
const shortText = (max: number) =>
  z.string().regex(new RegExp(`^[A-Za-z0-9 _.:-]{1,${max}}$`)).refine((s) => !/[0-9]{7}/.test(s));
const SHOP = z.strictObject({ ai_enabled: flag, ai_daily_calls: cap(2000), media_daily_calls: cap(500), site_verified: flag });

// Per kind (the operator kind has two shapes): the table written, whether it names a tenant, the payload keys (exactly the
// platform guard's columns for that table), the keys a change of this kind may move, and the payload's schema.
type Spec = { table: string; tenant: boolean; keys: readonly string[]; settable: readonly string[]; schema: z.ZodType };
const SPECS: Record<string, Spec> = {
  shop_config: { table: 'shop_config', tenant: true, keys: SHOP.keyof().options, settable: ['ai_enabled', 'ai_daily_calls', 'media_daily_calls'], schema: SHOP },
  site_verify: { table: 'shop_config', tenant: true, keys: SHOP.keyof().options, settable: ['site_verified'], schema: SHOP },
  default_config: {
    table: 'default_config',
    tenant: false,
    keys: ['scope', 'ai_enabled', 'ai_daily_calls', 'media_daily_calls', 'sandbox_media_daily_calls_total', 'deployment_daily_calls', 'sandbox_ai_enabled'],
    settable: ['ai_enabled', 'ai_daily_calls', 'media_daily_calls', 'sandbox_media_daily_calls_total', 'deployment_daily_calls', 'sandbox_ai_enabled'],
    schema: z.strictObject({
      scope: z.literal('demo_shops'), ai_enabled: flag, ai_daily_calls: cap(2000), media_daily_calls: cap(500),
      sandbox_media_daily_calls_total: cap(5000), deployment_daily_calls: cap(100000), sandbox_ai_enabled: flag,
    }),
  },
  channel_grant: {
    table: 'channel_grant',
    tenant: true,
    keys: ['channel', 'granted', 'max_test_recipients', 'account_ref'],
    settable: ['channel', 'granted', 'max_test_recipients', 'account_ref'],
    schema: z
      .strictObject({ channel: z.enum(['whatsapp', 'instagram']), granted: flag, max_test_recipients: cap(5), account_ref: z.string().regex(/^[a-z0-9_.-]{1,64}$/).nullable() })
      .refine((g) => (g.channel === 'whatsapp' || g.max_test_recipients === 0) && (g.account_ref === null || g.channel === 'instagram')),
  },
  reserved_slug: {
    table: 'reserved_slug',
    tenant: false,
    keys: ['slug', 'note'],
    settable: ['slug', 'note'],
    schema: z.strictObject({ slug: z.string().regex(/^[a-z][a-z0-9-]{2,39}$/), note: shortText(64).nullable() }),
  },
  operator_add: {
    table: 'operator',
    tenant: false,
    keys: ['subject', 'display_name'],
    settable: ['subject', 'display_name'],
    schema: z.strictObject({ subject: z.guid(), display_name: shortText(40) }),
  },
  operator_deactivate: { table: 'operator', tenant: false, keys: ['id', 'active'], settable: ['id', 'active'], schema: z.strictObject({ id: z.guid(), active: z.literal(false) }) },
};
const specName = (kind: string, keys: string[]) => (kind === 'operator' ? (keys.includes('id') ? 'operator_deactivate' : 'operator_add') : kind);

type Current = { values: Record<string, PlatformValue>; from: PlatformRowRef | null };

// What a change of this kind would replace now: the effective values of its keys, and the row they come from.
async function current(c: pg.ClientBase, spec: string, tenantId: string | null, ref: Record<string, unknown>): Promise<Current> {
  if (spec === 'shop_config' || spec === 'site_verify') {
    // The console reads a shop under that tenant's own context (§2.10.15), never with an actor.
    await c.query(`select set_config('munshi.tenant_id', $1, true)`, [tenantId]);
    const l = await platformLimits(c, tenantId as string);
    return { values: { ai_enabled: l.aiEnabled, ai_daily_calls: l.aiDailyCalls, media_daily_calls: l.mediaDailyCalls, site_verified: l.siteVerified }, from: l.from };
  }
  if (spec === 'default_config') {
    const { rows } = await c.query(
        `select id, change_id, ai_enabled, ai_daily_calls, media_daily_calls, sandbox_media_daily_calls_total,
                deployment_daily_calls, sandbox_ai_enabled from platform.default_config
        where scope = 'demo_shops' order by effective_from desc, id desc limit 1`,
    );
    const d = rows[0];
    return {
      values: {
        scope: 'demo_shops', ai_enabled: d?.ai_enabled ?? false, ai_daily_calls: d?.ai_daily_calls ?? 0,
        media_daily_calls: d?.media_daily_calls ?? 0, sandbox_media_daily_calls_total: d?.sandbox_media_daily_calls_total ?? 0,
        deployment_daily_calls: d?.deployment_daily_calls ?? 0, sandbox_ai_enabled: d?.sandbox_ai_enabled ?? false,
      },
      from: d ? { table: 'platform.default_config', id: d.id, changeId: d.change_id } : null,
    };
  }
  if (spec === 'channel_grant') {
    const { rows } = await c.query(
      `select id, change_id, granted, max_test_recipients, account_ref from platform.channel_grant
        where tenant_id = $1 and channel = $2 order by effective_from desc, id desc limit 1`,
      [tenantId, ref.channel],
    );
    const g = rows[0];
    return {
      values: { channel: (ref.channel as PlatformValue) ?? null, granted: g?.granted ?? false, max_test_recipients: g?.max_test_recipients ?? 0, account_ref: g?.account_ref ?? null },
      from: g ? { table: 'platform.channel_grant', id: g.id, changeId: g.change_id } : null,
    };
  }
  if (spec === 'operator_deactivate') {
    const { rows } = await c.query<{ active: boolean }>('select active from platform.operator where id = $1', [UUID.test(String(ref.id)) ? ref.id : null]);
    if (!rows[0]) throw new CoreError('not_found');
    return { values: { id: ref.id as string, active: rows[0].active }, from: { table: 'platform.operator', id: ref.id as string, changeId: null } };
  }
  // A reserved slug or an operator is a new row: nothing is replaced.
  return { values: Object.fromEntries((SPECS[spec] as Spec).keys.map((k) => [k, null])), from: null };
}

export async function proposeChange(c: pg.ClientBase, input: ChangeInput): Promise<{ id: string }> {
  const set = input.set;
  const name = specName(input.kind, Object.keys(set));
  const spec = SPECS[name];
  if (!spec) throw new CoreError('invalid', { fields: ['kind'] });
  const tenantId = input.tenantId ?? null;
  if (spec.tenant !== (tenantId !== null) || (tenantId !== null && !UUID.test(tenantId))) throw new CoreError('invalid', { fields: ['tenantId'] });
  const stray = Object.keys(set).filter((k) => !spec.settable.includes(k));
  if (stray.length) throw new CoreError('invalid', { fields: stray.map((k) => `set.${k}`) });
  const { values } = await current(c, name, tenantId, set);
  const payload = spec.schema.safeParse(Object.fromEntries(spec.keys.map((k) => [k, k in set ? set[k] : values[k]])));
  if (!payload.success) throw new CoreError('invalid', { fields: payload.error.issues.map((i) => `set.${i.path.join('.')}`) });
  const { rows } = await c.query<{ id: string }>(
    `insert into platform.change (kind, tenant_id, payload, proposed_by, proposed_txid)
     values ($1, $2, $3, nullif(current_setting('munshi.operator_id', true), '')::uuid, 0) returning id`,
    [input.kind, tenantId, JSON.stringify(payload.data)],
  );
  return { id: (rows[0] as { id: string }).id };
}

// A site is verified (or hidden again) only as this change, approved (VERIFY1).
export function verifySite(c: pg.ClientBase, tenantId: string, verified = true): Promise<{ id: string }> {
  return proposeChange(c, { kind: 'site_verify', tenantId, set: { site_verified: verified } });
}

type ChangeRow = { id: string; kind: ChangeKind; tenant_id: string | null; payload: Record<string, PlatformValue>; verdict: string | null };

export type PlatformDiff = {
  changeId: string;
  kind: ChangeKind;
  tenantId: string | null;
  verdict: string | null;
  fields: { key: string; before: PlatformValue; after: PlatformValue }[]; // after: the change's payload, exactly what an approval writes
  from: PlatformRowRef | null; // where every `before` was read
  digest: string; // what approveChange must be given back: the diff as shown
};

async function diffOf(c: pg.ClientBase, ch: ChangeRow): Promise<PlatformDiff & { stray: string[] }> {
  const name = specName(ch.kind, Object.keys(ch.payload));
  const spec = SPECS[name] as Spec;
  const { values, from } = await current(c, name, ch.tenant_id, ch.payload);
  const fields = spec.keys.map((key) => ({ key, before: values[key] ?? null, after: ch.payload[key] ?? null }));
  const digest = createHash('sha256').update(JSON.stringify([ch.id, ch.kind, ch.tenant_id, fields])).digest('hex');
  // Keys this kind may not move that would move now: a stale site_verify reverting caps, or a stale cap change hiding a site.
  const stray = fields.filter((f) => !spec.settable.includes(f.key) && f.before !== f.after).map((f) => f.key);
  return { changeId: ch.id, kind: ch.kind, tenantId: ch.tenant_id, verdict: ch.verdict, fields, from, digest, stray };
}

const CHANGE = 'select id, kind, tenant_id, payload, verdict from platform.change where id = $1';

export async function changeDiff(c: pg.ClientBase, changeId: string): Promise<PlatformDiff> {
  const { rows } = await c.query<ChangeRow>(CHANGE, [UUID.test(changeId) ? changeId : null]);
  if (!rows[0]) throw new CoreError('not_found');
  const { stray: _, ...diff } = await diffOf(c, rows[0]);
  return diff;
}

// Locks the change for its decision. The platform chain's lock (class 10, which every platform write takes for its chain
// entry anyway) is taken first, so no other decision can move what this one's diff was computed against before it commits.
async function undecided(c: pg.ClientBase, changeId: string): Promise<ChangeRow> {
  await c.query('select pg_advisory_xact_lock(10, 0)');
  const { rows } = await c.query<ChangeRow>(`${CHANGE} for update`, [UUID.test(changeId) ? changeId : null]);
  const ch = rows[0];
  if (!ch) throw new CoreError('not_found');
  if (ch.verdict !== null) throw new CoreError('not_proposed');
  return ch;
}

export type PlatformApproval = { changeId: string; enrolment?: { subject: string; otpauthUri: string } };

// `digest` is the diff the approver was shown (changeDiff). `code` is a fresh TOTP code, for a session that does not
// carry one from its sign-in (a channel grant and an operator change need one from the last 5 minutes); `platformSecret`
// opens the operator's secret for it, and seals a new operator's.
export async function approveChange(c: pg.ClientBase, changeId: string, opts: { digest: string; code?: string; platformSecret?: string }): Promise<PlatformApproval> {
  const ch = await undecided(c, changeId);
  const diff = await diffOf(c, ch);
  if (diff.digest !== opts.digest || diff.stray.length) throw new CoreError('conflict');
  // Before munshi.platform_change_id is set: 09's audit_write chains an operator UPDATE made under a change id as
  // operator.deactivate of that change.
  if (opts.code !== undefined) {
    const { rows } = await c.query<OperatorRow>(
      `select id, subject::text, totp_secret_enc from platform.operator where id = nullif(current_setting('munshi.operator_id', true), '')::uuid`,
    );
    if (!rows[0] || !(await consumeCode(c, rows[0], opts.code, opts.platformSecret ?? ''))) throw new CoreError('refused');
  }
  await c.query(`update platform.change set verdict = 'approved' where id = $1 and verdict is null`, [ch.id]);
  await c.query(`select set_config('munshi.platform_change_id', $1, true)`, [ch.id]);
  const done = await execute(c, ch, opts.platformSecret ?? '');
  // A site verified or hidden: its cached state goes now (cache-keys.ts); another process's cache keeps it for at most
  // its 10 seconds.
  if (ch.kind === 'site_verify' && ch.tenant_id) await dropSite(ch.tenant_id);
  return done;
}

export async function rejectChange(c: pg.ClientBase, changeId: string): Promise<void> {
  const ch = await undecided(c, changeId);
  await c.query(`update platform.change set verdict = 'rejected' where id = $1 and verdict is null`, [ch.id]);
}

// The approved change's row, read from platform.change by the statement that writes it. Table and column names are this
// module's constants.
async function execute(c: pg.ClientBase, ch: ChangeRow, platformSecret: string): Promise<PlatformApproval> {
  const name = specName(ch.kind, Object.keys(ch.payload));
  const spec = SPECS[name] as Spec;
  if (name === 'operator_deactivate') {
    const { rows } = await c.query<{ n: number }>('select count(*)::int as n from platform.operator where active and id <> $1', [ch.payload.id]);
    if (rows[0]?.n === 0) throw new CoreError('refused'); // the last active operator: nobody could approve anything again
    await c.query(`update platform.operator o set active = false from platform.change c where c.id = $1 and o.id = (c.payload ->> 'id')::uuid`, [ch.id]);
    return { changeId: ch.id };
  }
  if (name === 'operator_add') {
    const subject = String(ch.payload.subject);
    const secret = newTotpSecret();
    await c.query(
      `insert into platform.operator (subject, display_name, totp_secret_enc)
       select r.subject, r.display_name, $2 from platform.change c, jsonb_populate_record(null::platform.operator, c.payload) r where c.id = $1`,
      [ch.id, sealSecret(secret, subject, platformSecret)],
    );
    return { changeId: ch.id, enrolment: { subject, otpauthUri: otpauthUri(secret, String(ch.payload.display_name)) } };
  }
  const cols = spec.keys.join(', ');
  const tenant = spec.tenant ? 'tenant_id, ' : '';
  await c.query(
    `insert into platform.${spec.table} (${tenant}${cols}, change_id)
     select ${spec.tenant ? 'c.tenant_id, ' : ''}${spec.keys.map((k) => `r.${k}`).join(', ')}, c.id
       from platform.change c, jsonb_populate_record(null::platform.${spec.table}, c.payload) r where c.id = $1`,
    [ch.id],
  );
  return { changeId: ch.id };
}

export type ChangeListed = { id: string; kind: ChangeKind; tenantId: string | null; proposedBy: string; proposedAt: string; verdict: string | null; decidedBy: string | null };

// The change log, newest first (the console's and `pnpm platform:list`'s).
export async function listChanges(c: pg.ClientBase, opts: { pending?: boolean } = {}): Promise<ChangeListed[]> {
  const { rows } = await c.query<ChangeListed>(
    `select id, kind, tenant_id as "tenantId", proposed_by as "proposedBy", proposed_at::text as "proposedAt", verdict, decided_by as "decidedBy"
       from platform.change where ($1::boolean is not true or verdict is null) order by proposed_at desc, id desc limit 200`,
    [opts.pending ?? false],
  );
  return rows;
}

// The first seq at which the platform chain breaks, or null when it verifies.
export async function verifyPlatformChain(c: pg.ClientBase): Promise<string | null> {
  const { rows } = await c.query<{ broken: string | null }>('select platform.verify_chain()::text as broken');
  return rows[0]?.broken ?? null;
}
