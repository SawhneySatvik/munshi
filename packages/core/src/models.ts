// Model choice per agent (D-066, P-5). The platform's operators approve an allow-list of model aliases per role
// (platform.model_allow, one approved change per (alias, role), the latest row winning); a shop's owner picks one per
// agent from it, as their own audited command (model.choose, written to ops.model_choice, whose guard admits only an
// active owner and an alias enabled for the agent's role). Core never imports the agent: the running build's aliases,
// with the roles each serves, and the edition's default per role come in as a ModelCatalogue.
//
// model.choose is not in COMMANDS: 22_ai_controls.sql gives it no ref.command or ref.command_capability row, so
// runCommand's capability check would refuse it. It runs here, as switchCapability does, under its own command name so
// the table's guard admits it, with the form's idempotency key.
import type pg from 'pg';
import { z } from 'zod';
import { CoreError } from './errors.ts';
import { claimKey, IDEMPOTENCY_KEY } from './idempotency.ts';
import { type Session, withTx } from './session.ts';

export type ModelCatalogue = {
  /** every alias the running build knows, with the roles it may serve */
  known: Readonly<Record<string, readonly string[]>>;
  /** the edition's default alias per role */
  defaults: Readonly<Partial<Record<string, string>>>;
};

const serves = (cat: ModelCatalogue, alias: string, role: string) => Object.hasOwn(cat.known, alias) && (cat.known[alias] as readonly string[]).includes(role);

// The aliases whose latest allow-list row for the role is enabled.
async function enabled(c: pg.ClientBase, role: string): Promise<string[]> {
  const { rows } = await c.query<{ alias: string }>(
    `select a.alias from (select distinct on (alias) alias, enabled from platform.model_allow where role = $1
                          order by alias, effective_from desc, id desc) a
      where a.enabled order by a.alias`,
    [role],
  );
  return rows.map((r) => r.alias);
}

type AgentRow = { role: string; chosen: string | null; chosen_at: string | null };
const AGENT = `select a.role,
                      (select m.alias from ops.model_choice m where m.agent = a.agent order by m.chosen_at desc, m.id desc limit 1) as chosen,
                      (select m.chosen_at::text from ops.model_choice m where m.agent = a.agent order by m.chosen_at desc, m.id desc limit 1) as chosen_at
                 from ref.ai_agent a where a.agent = $1`;

/**
 * The fallback chain for one model call of `agent` (ref.ai_agent) in `role` (the agent's own by default): the shop's
 * choice, then the edition's default, then every other alias allowed for the role, each only while the allow-list has it
 * enabled for that role and the running build serves it in that role. Empty: no model may answer, and the AI surface
 * shows its template or hides, never an error. In the caller's transaction, under the tenant's context.
 */
export async function modelFor(c: pg.ClientBase, agent: string, cat: ModelCatalogue, role?: string): Promise<string[]> {
  const { rows } = await c.query<AgentRow>(AGENT, [agent]);
  const a = rows[0];
  if (!a) return [];
  const r = role ?? a.role;
  const allowed = (await enabled(c, r)).filter((alias) => serves(cat, alias, r));
  return [...new Set([a.chosen, cat.defaults[r], ...allowed])].filter((x): x is string => typeof x === 'string' && allowed.includes(x));
}

export type AiStaffRow = {
  agent: string;
  role: string;
  /** the alias the shop chose, while still allowed; null: the edition's default */
  chosen: string | null;
  chosenAt: string | null;
  /** what answers now: the chain's first alias; null: the surface is hidden */
  current: string | null;
  defaultAlias: string | null;
  /** what the picker offers */
  allowed: string[];
};

/** Settings → AI staff: one row per agent, under the tenant's context. */
export async function aiStaff(c: pg.ClientBase, cat: ModelCatalogue): Promise<AiStaffRow[]> {
  const { rows } = await c.query<{ agent: string }>('select agent from ref.ai_agent order by agent');
  const out: AiStaffRow[] = [];
  for (const { agent } of rows) {
    const a = (await c.query<AgentRow>(AGENT, [agent])).rows[0] as AgentRow;
    const allowed = (await enabled(c, a.role)).filter((alias) => serves(cat, alias, a.role));
    const chain = await modelFor(c, agent, cat);
    const chosen = a.chosen && allowed.includes(a.chosen) ? a.chosen : null;
    out.push({ agent, role: a.role, chosen, chosenAt: chosen ? a.chosen_at : null, current: chain[0] ?? null, defaultAlias: cat.defaults[a.role] ?? null, allowed });
  }
  return out;
}

const choice = z.strictObject({ agent: z.string().regex(/^[a-z][a-z0-9_]{1,31}$/), alias: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,31}$/).nullable() });

/**
 * model.choose: the owner picks the model for one agent. `alias` null is "Default": the edition's default alias for the
 * agent's role is recorded (ops.model_choice has no "default" value). Refused unless the member is an active owner, the
 * running build serves the alias in the agent's role, and the allow-list's latest row for (alias, role) is enabled; the
 * table's guard checks the owner and the allow-list again. One audited row (the table's trigger); with a key, a replay
 * returns the first row's id.
 */
export async function chooseModel(pool: pg.Pool, session: Session, input: unknown, cat: ModelCatalogue, key?: string): Promise<{ choiceId: string }> {
  const r = choice.safeParse(input);
  if (!r.success) throw new CoreError('invalid', { fields: r.error.issues.map((i) => i.path.join('.') || '(input)') });
  if (key !== undefined && !IDEMPOTENCY_KEY.test(key)) throw new CoreError('invalid', { fields: ['key'] });
  return withTx(pool, { kind: 'member', session, command: 'model.choose' }, async (c) => {
    const claim = key === undefined ? undefined : await claimKey(c, session.memberId, key, 'model.choose', r.data);
    if (claim && 'replay' in claim) return { choiceId: claim.replay.choiceId as string };
    const { rows: who } = await c.query<{ role: string }>('select role from ops.member where id = $1 and active', [session.memberId]);
    if (who[0]?.role !== 'owner') throw new CoreError('refused', { fields: ['member'] });
    const a = (await c.query<AgentRow>(AGENT, [r.data.agent])).rows[0];
    if (!a) throw new CoreError('invalid', { fields: ['agent'] });
    const alias = r.data.alias ?? cat.defaults[a.role];
    if (!alias || !serves(cat, alias, a.role) || !(await enabled(c, a.role)).includes(alias)) throw new CoreError('refused', { fields: ['alias'] });
    const { rows } = await c.query<{ id: string }>(
      'insert into ops.model_choice (tenant_id, agent, alias, chosen_by) values ($1, $2, $3, $4) returning id::text as id',
      [session.tenantId, r.data.agent, alias, session.memberId],
    );
    const result = { choiceId: (rows[0] as { id: string }).id };
    await claim?.fill(result);
    return result;
  });
}
