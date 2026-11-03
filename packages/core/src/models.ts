// Model choice per agent. The platform's operators approve an allow-list of model aliases per role
// (platform.model_allow, one approved change per (alias, role), the latest row winning); a shop's owner picks one per
// agent from it, as their own audited command (model.choose, written to ops.model_choice, whose guard admits only an
// active owner and an alias enabled for the agent's role). Core never imports the agent: the running build's aliases,
// with the roles each serves, and the build's default per role come in as a ModelCatalogue.
//
// model.choose is not in COMMANDS: 22_ai_controls.sql gives it no ref.command or ref.command_capability row, so
// runCommand's capability check would refuse it. It runs here, as switchCapability does, under its own command name so
// the table's guard admits it, with the form's idempotency key.
import type pg from 'pg';
import { z } from 'zod';
import { CoreError } from './errors.ts';
import { claimKey, IDEMPOTENCY_KEY } from './idempotency.ts';
import { type Session, withTx } from './session.ts';

// The router's other halves ride on this module's export (index.ts exports it): the AI features per shop, and spend.
export * from './ai-features.ts';
export * from './spend.ts';

export type ModelCatalogue = {
  /** every alias the running build knows, with the roles it may serve */
  known: Readonly<Record<string, readonly string[]>>;
  /** the build's default alias per role */
  defaults: Readonly<Partial<Record<string, string>>>;
};

const serves = (cat: ModelCatalogue, alias: string, role: string) => Object.hasOwn(cat.known, alias) && (cat.known[alias] as readonly string[]).includes(role);

// The shop's list for a role (ai.shop_models()): every alias the deployment enables for the role, narrowed to
// the shop's own list once the operator has set one, with the shop's default for the role (null: none) and which list
// governs. In the caller's transaction, under the tenant's context.
export type ShopModelList = { aliases: string[]; shopDefault: string | null; source: 'shop' | 'deployment' };
export async function shopModelList(c: pg.ClientBase, role: string): Promise<ShopModelList> {
  const { rows } = await c.query<{ alias: string; is_default: boolean }>(
    'select m.alias, m.is_default from ai.shop_models() m where m.role = $1 order by m.alias',
    [role],
  );
  // Whose list governs is read from the shop's rows, not from what is left: a list that allows nothing for the role
  // still governs it (and leaves it no model), where the deployment's would offer every alias it enables.
  const { rows: listed } = await c.query<{ shop: boolean }>(
    `select exists (select 1 from platform.shop_model s
                     where s.tenant_id = nullif(current_setting('munshi.tenant_id', true), '')::uuid and s.role = $1) as shop`,
    [role],
  );
  return { aliases: rows.map((r) => r.alias), shopDefault: rows.find((r) => r.is_default)?.alias ?? null, source: listed[0]?.shop ? 'shop' : 'deployment' };
}

type AgentRow = { role: string; chosen: string | null; chosen_at: string | null };
const AGENT = `select a.role,
                      (select m.alias from ops.model_choice m where m.agent = a.agent order by m.chosen_at desc, m.id desc limit 1) as chosen,
                      (select m.chosen_at::text from ops.model_choice m where m.agent = a.agent order by m.chosen_at desc, m.id desc limit 1) as chosen_at
                 from ref.ai_agent a where a.agent = $1`;

/**
 * The fallback chain for one model call of `agent` (ref.ai_agent) in `role` (the agent's own by default): the shop's
 * choice, then the shop's default (the operator's), then the build's default, then every other alias on the shop's
 * list for the role (ai.shop_models(): the deployment's allow-list, narrowed to the shop's own once it has one), each
 * only while the running build serves it in that role. An alias off the shop's list never enters the chain. The choice
 * applies to the agent's own role only (the role model.choose checked it against); the run's other calls (Ask's router
 * and narrate) keep the build's.
 * Empty: no model may answer, and the AI surface shows its template or hides, never an error. In the caller's
 * transaction, under the tenant's context.
 */
export async function modelFor(c: pg.ClientBase, agent: string, cat: ModelCatalogue, role?: string): Promise<string[]> {
  const { rows } = await c.query<AgentRow>(AGENT, [agent]);
  const a = rows[0];
  if (!a) return [];
  const r = role ?? a.role;
  const list = await shopModelList(c, r);
  const allowed = list.aliases.filter((alias) => serves(cat, alias, r));
  const chosen = r === a.role ? a.chosen : null;
  const chain = [...new Set([chosen, list.shopDefault, cat.defaults[r], ...allowed])].filter((x): x is string => typeof x === 'string' && allowed.includes(x));
  return chain;
}

export type AiStaffRow = {
  agent: string;
  role: string;
  /** the alias the shop chose, while still allowed; null: Default (no pick, or a "Default" pick: the shop's, else the build's) */
  chosen: string | null;
  chosenAt: string | null;
  /** what answers now: the chain's first alias; null: the surface is hidden */
  current: string | null;
  defaultAlias: string | null;
  /** what the picker offers */
  allowed: string[];
  /** whose list `allowed` is: the shop's own (set by the operator) or the deployment's */
  source: 'shop' | 'deployment';
};

/** Settings → AI staff: one row per agent, under the tenant's context. */
export async function aiStaff(c: pg.ClientBase, cat: ModelCatalogue): Promise<AiStaffRow[]> {
  const { rows } = await c.query<{ agent: string }>('select agent from ref.ai_agent order by agent');
  const out: AiStaffRow[] = [];
  for (const { agent } of rows) {
    const a = (await c.query<AgentRow>(AGENT, [agent])).rows[0] as AgentRow;
    const list = await shopModelList(c, a.role);
    const allowed = list.aliases.filter((alias) => serves(cat, alias, a.role));
    const chain = await modelFor(c, agent, cat);
    const chosen = a.chosen && allowed.includes(a.chosen) ? a.chosen : null;
    const defaultAlias = list.shopDefault && allowed.includes(list.shopDefault) ? list.shopDefault : (cat.defaults[a.role] ?? null);
    out.push({ agent, role: a.role, chosen, chosenAt: chosen ? a.chosen_at : null, current: chain[0] ?? null, defaultAlias, allowed, source: list.source });
  }
  return out;
}

const choice = z.strictObject({ agent: z.string().regex(/^[a-z][a-z0-9_]{1,31}$/), alias: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,31}$/).nullable() });

/**
 * model.choose: the owner picks the model for one agent. `alias` null is "Default": a NULL pick is recorded, so the
 * agent follows modelFor's chain with no pick (the shop's default, the build's, then the rest of the list), as it
 * changes later; it is refused only while that chain is empty, that is while the running build serves nothing on the
 * shop's list for the role. A named alias is refused unless the running build serves it in the agent's role and it is on
 * the shop's list for the role (ai.shop_models()). Refused unless the member is an active owner; the table's guard checks
 * the owner, and for a named alias the allow-list and the shop's list, again. One audited row (the table's trigger); with a key, a replay returns the first row's id.
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
    const list = await shopModelList(c, a.role);
    const allowed = list.aliases.filter((x) => serves(cat, x, a.role));
    const alias = r.data.alias;
    if (alias === null ? allowed.length === 0 : !allowed.includes(alias)) throw new CoreError('refused', { fields: ['alias'] });
    const { rows } = await c.query<{ id: string }>(
      'insert into ops.model_choice (tenant_id, agent, alias, chosen_by) values ($1, $2, $3, $4) returning id::text as id',
      [session.tenantId, r.data.agent, alias, session.memberId],
    );
    const result = { choiceId: (rows[0] as { id: string }).id };
    await claim?.fill(result);
    return result;
  });
}

export type ModelAllowRow = { alias: string; role: string; enabled: boolean; at: string; from: { table: string; id: string; changeId: string } };

/** The console's allow-list: the latest row per (alias, role), each beside the approved change that wrote it. */
export async function modelAllowList(c: pg.ClientBase): Promise<ModelAllowRow[]> {
  const { rows } = await c.query<{ id: string; alias: string; role: string; enabled: boolean; at: string; change_id: string }>(
    `select distinct on (alias, role) id::text, alias, role, enabled, effective_from::text as at, change_id::text
       from platform.model_allow order by alias, role, effective_from desc, id desc`,
  );
  return rows.map((r) => ({ alias: r.alias, role: r.role, enabled: r.enabled, at: r.at, from: { table: 'platform.model_allow', id: r.id, changeId: r.change_id } }));
}
