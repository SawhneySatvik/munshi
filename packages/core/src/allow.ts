// AI's off switch and caps (BLUEPRINT §4.6, D-045): allow() is asked before every model call and counts the call in
// ai.usage, so the count is core's, not the agent's. A call is refused when the deployment has AI off (MUNSHI_AI, passed
// in: core reads no environment), when the shop's platform config has it off (platformLimits: no row means off), or when
// the shop's calls today in that role's class — text (router, reason, narrate) or media (vision, segment, voice, speak) — have
// reached its cap. Refused, every AI surface shows its template or hides; nothing shows an error. The day is the shop's.
//
// After the shop's own cap, the deployment's ceiling (D-068): platform.count_ai_call counts the call against the day's
// total across every shop, up to deployment_daily_calls from the effective default config (0, or no default config:
// no call at all, as the function itself rules). Refused there, the shop's count is rolled back too, so a refused call is
// never counted anywhere. A sandbox (a sample-shop sign-up) reads AI off unless the default config's sandbox_ai_enabled
// is on.
//
// The ceiling all sandboxes share (sandbox_media_daily_calls_total) is not enforced here: ai.usage and ops.tenant force
// the tenant's RLS on every role, so no transaction can sum another sandbox's calls. That needs a schema decision.
import type pg from 'pg';
import { platformLimits } from './platform.ts';
import { withTx } from './session.ts';

export const TEXT_ROLES = ['router', 'reason', 'narrate'] as const;
export const MEDIA_ROLES = ['vision', 'segment', 'voice', 'speak'] as const;
export type AiRole = (typeof TEXT_ROLES)[number] | (typeof MEDIA_ROLES)[number];
export type DeploymentAi = 'on' | 'off';
export type Allowance = { ok: true } | { ok: false; reason: 'off' | 'cap' };

const isMedia = (role: AiRole) => (MEDIA_ROLES as readonly string[]).includes(role);

// Inside the caller's transaction, under the tenant's context. The lock is per shop, day and class, so two calls of
// different roles of one class cannot both read the total under the cap; the increment itself is one statement that adds
// the call only while the class's total is under the cap.
export async function allowIn(c: pg.PoolClient, tenantId: string, role: AiRole, deploymentAi: DeploymentAi): Promise<Allowance> {
  if (deploymentAi !== 'on') return { ok: false, reason: 'off' };
  const limits = await platformLimits(c, tenantId);
  if (!limits.aiEnabled) return { ok: false, reason: 'off' };
  if (limits.sandbox && !limits.sandboxAiEnabled) return { ok: false, reason: 'off' };
  const media = isMedia(role);
  const roles = media ? MEDIA_ROLES : TEXT_ROLES;
  const cap = media ? limits.mediaDailyCalls : limits.aiDailyCalls;
  const { rows } = await c.query<{ day: string }>('select (now() at time zone time_zone)::date::text as day from ops.tenant');
  const day = (rows[0] as { day: string }).day;
  await c.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`munshi.ai_usage:${tenantId}:${day}:${media ? 'media' : 'text'}`]);
  await c.query('savepoint munshi_allow');
  const counted = await c.query(
    `insert into ai.usage (tenant_id, day, role, calls)
     select $1, $2::date, $3, 1
      where (select coalesce(sum(u.calls), 0) from ai.usage u where u.day = $2::date and u.role = any ($4::text[])) < $5
     on conflict (tenant_id, day, role) do update set calls = ai.usage.calls + 1`,
    [tenantId, day, role, roles, cap],
  );
  if (counted.rowCount !== 1) return { ok: false, reason: 'cap' };
  const { rows: ceiling } = await c.query<{ ok: boolean }>('select platform.count_ai_call($1::date, $2) as ok', [day, limits.deploymentDailyCalls]);
  if (ceiling[0]?.ok !== true) {
    await c.query('rollback to savepoint munshi_allow');
    return { ok: false, reason: 'cap' };
  }
  await c.query('release savepoint munshi_allow');
  return { ok: true };
}

/** One model call's allowance, counted in its own transaction (the app's or the jobs pool, with no actor). */
export function allow(pool: pg.Pool, tenantId: string, role: AiRole, deploymentAi: DeploymentAi): Promise<Allowance> {
  return withTx(pool, { kind: 'system', tenantId }, (c) => allowIn(c, tenantId, role, deploymentAi));
}

/**
 * Whether a surface may offer AI now, without counting a call: what Ask reads to show or hide its box, and the brief to
 * narrate or use its template. A later allow() may still refuse (another call took the last one).
 */
export async function aiOpen(c: pg.ClientBase, tenantId: string, deploymentAi: DeploymentAi): Promise<{ text: boolean; media: boolean }> {
  if (deploymentAi !== 'on') return { text: false, media: false };
  const limits = await platformLimits(c, tenantId);
  if (!limits.aiEnabled || (limits.sandbox && !limits.sandboxAiEnabled)) return { text: false, media: false };
  const { rows } = await c.query<{ text: number; media: number }>(
    `select coalesce(sum(u.calls) filter (where u.role = any ($1::text[])), 0)::int as text,
            coalesce(sum(u.calls) filter (where u.role = any ($2::text[])), 0)::int as media
       from ai.usage u where u.day = (select (now() at time zone time_zone)::date from ops.tenant)`,
    [TEXT_ROLES, MEDIA_ROLES],
  );
  const used = rows[0] as { text: number; media: number };
  return { text: used.text < limits.aiDailyCalls, media: used.media < limits.mediaDailyCalls };
}
