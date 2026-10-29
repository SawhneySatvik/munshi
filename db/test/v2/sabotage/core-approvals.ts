// Red-proofs of drafts and decisions on v2 (test/v2/core/{approvals,current}): each breaks one protection of
// packages/core/src/approvals.ts, session.ts or the approval schema, and its named test must fail. The v1 cases they
// succeed keep their mutation and their name, with a v2- prefix. v2 checks a decider's authority and active membership
// twice, as the decision is inserted (stamp_decision) and as the draft's status moves (draft_status), so a case that
// lets a rejection through breaks both, and one that lets a stale mark through breaks draft_status alone.
import type { Case } from './case.ts';
import { asOwner, mutate } from './sql.ts';

const V2 = 'vitest.v2.config.ts';
const c4 = 'test/v2/core/approvals/c4-approvals.test.ts';
const c7 = 'test/v2/core/current/c7-current-state.test.ts';
const APPROVALS = 'packages/core/src/approvals.ts';

const C4_PAYLOAD = "C4 every number in a draft's payload is mapped to a cell of its kind holding that number, and basedOn is never empty";
const C4_PAYLOAD_RECHECK = 'C4 a cell a payload number came from is re-checked at approval like basedOn';
const C4_CURRENT = "C4 a stock or money draft must cite the current on-hand of every item it names; a watcher's dated read is not enough";
const C4_AFTER_AS_OF = "C4 a write-off recorded after a watcher's as_of makes a draft cited from it stale";
const C4_AUTHORITY = 'C4 only an active member allowed to approve a command may reject it or have it marked stale';
const C7_CREDIT = "C7 a credit draft cites the customer's current balance from credit.balance, and goes stale when it moves";
const RECHECK = 'const changed = await recheck(c, [...draft.based_on, ...Object.values(draft.payload_refs)]);';

const DECISION_AUTHORITY = mutate('approval.stamp_decision()', '\n    join ref.command_authority ca on ca.role = m.role and ca.command = dr.command', '');
const DECISION_ACTIVE = mutate('approval.stamp_decision()', 'm.id = ctx_actor and m.active', 'm.id = ctx_actor');
const STATUS_AUTHORITY = mutate('approval.draft_status()', ' join ref.command_authority ca on ca.role = m.role and ca.command = old.command', '');
const STATUS_ACTIVE = mutate('approval.draft_status()', 'm.id = ctx_actor and m.active) then', 'm.id = ctx_actor) then');

const ts = (sabotage: string, file: string, test: string, from: string, to: string, source = APPROVALS): Case => ({
  sabotage,
  file,
  test,
  config: V2,
  ts: { file: source, from, to },
});
const sql = (sabotage: string, file: string, test: string, body: string): Case => ({ sabotage, file, test, config: V2, sql: body });

export const CORE_APPROVALS_CASES: Case[] = [
  sql(
    'v2-c4-two-open-drafts',
    c4,
    'C4 a finding has at most one open draft: a second proposal conflicts until the first is decided',
    asOwner('drop index approval.draft_open_per_finding;'),
  ),
  ts(
    'v2-c4-no-decision',
    c4,
    'C4 a draft approved by the owner executes under the owner in one transaction, and its audit chain verifies',
    "await c.query(`select set_config('munshi.decision_id', $1, true)`, [decisionId]);",
    '',
  ),
  ts('v2-c4-no-recheck', c4, 'C4 a draft whose evidence changed goes stale, and nothing executes', RECHECK, 'const changed: string[] = [];'),
  // The MS-5 review's probe: without the re-check, the write-off after as_of and the approved draft take on-hand to −8.
  ts('v2-c4-no-recheck-after-as-of', c4, C4_AFTER_AS_OF, RECHECK, 'const changed: string[] = [];'),
  ts('v2-c4-unchecked-refs', c4, 'C4 a draft must cite cells that exist in this tenant, and a payload its command accepts', 'if (!(await resolveRef(c, ref)))', 'if (!ref)'),
  ts('v2-c4-empty-basedon', c4, C4_PAYLOAD, 'basedOn: z.array(refSchema).min(1).max(50),', 'basedOn: z.array(refSchema).max(50),'),
  ts('v2-c4-payload-unmapped', c4, C4_PAYLOAD, 'if (unmapped.length) throw', 'if (false) throw'),
  ts('v2-c4-payload-value', c4, C4_PAYLOAD, "'num' in cell && cell.num === String(n)", "'num' in cell"),
  ts('v2-c4-payload-kind', c4, C4_PAYLOAD, 'cell.kind === kind && ', ''),
  ts('v2-c4-payload-unchecked', c4, C4_PAYLOAD_RECHECK, RECHECK, 'const changed = await recheck(c, draft.based_on);'),
  ts('v2-c4-dated-evidence', c4, C4_CURRENT, "if (!current) throw new CoreError('invalid', { fields: ['basedOn'] });", ''),
  ts('v2-c4-any-item', c4, C4_CURRENT, ' && snap.params[cur.param] === id', ''),
  ts('v2-c4-no-item-needed', c4, C4_CURRENT, 'let current = touched.length > 0;', 'let current = true;'),
  sql('v2-c4-reject-authority', c4, C4_AUTHORITY, DECISION_AUTHORITY + STATUS_AUTHORITY),
  sql('v2-c4-reject-inactive', c4, C4_AUTHORITY, DECISION_ACTIVE + STATUS_ACTIVE),
  sql('v2-c4-stale-authority', c4, C4_AUTHORITY, STATUS_AUTHORITY),
  sql('v2-c4-stale-inactive', c4, C4_AUTHORITY, STATUS_ACTIVE),
  ts(
    'v2-c4-session-inactive',
    c4,
    'C4 a Session opens only for an active member of its own tenant',
    "'select 1 from ops.member where id = $1 and active'",
    "'select 1 from ops.member where id = $1'",
    'packages/core/src/session.ts',
  ),
  ts('v2-c7-credit-not-current', c7, C7_CREDIT, "  customerId: { query: 'credit.balance', param: 'customer_id', col: 'balance' },\n", ''),
];
