// Red-proofs of surplus for good (test/v2/gates/25-surplus.test.ts), the document and video roles
// (22-ai-roles.test.ts), quieting a finding (07-ai.test.ts, ROLE7) and the "written by AI" mark (19-messaging.test.ts,
// AI1-MARK). A protection held twice (the gift's own guard and the book guard both read the decision) is broken in both
// places, as one protection.
import type { Case } from './case.ts';
import { asOwner, dropCheck, mutate } from './sql.ts';

const V2 = 'vitest.v2.config.ts';
const at = (file: string) => (test: string, sabotage: string, sql: string): Case => ({ sabotage, file, test, config: V2, sql });
const s = at('test/v2/gates/25-surplus.test.ts');
const r = at('test/v2/gates/22-ai-roles.test.ts');
const f = at('test/v2/gates/07-ai.test.ts');
const m = at('test/v2/gates/19-messaging.test.ts');

const GIVE = 'ops.surplus_give()';
const WRITE = 'books.write()';
const KIND = 'books.stock_kind()';
const IMPACT = 'ops.surplus_impact(timestamp with time zone,timestamp with time zone)';

const SURPLUS1 = 'nothing moves before approval: a proposed or rejected gift writes nothing, and no listing is taken without an approved decision of this transaction';
const SURPLUS2 = "approval writes the stock row and the listing together, under the approver, valued at the lot's cost, each with its audit entry";
const SURPLUS3 = 'neither alone: no donated stock row without its listing, none by any other command, surplus.give writes nothing else, and the gift is exactly the approved one';
const SURPLUS4 = 'staff can neither approve a gift nor execute one';
const SURPLUS5 = "another shop neither reads nor writes a shop's recipients and listings";
const SURPLUS6 = 'the impact read counts the shop’s gifts not reversed, valued at cost, in its currency, for this shop only';
const SURPLUS7 = 'a recipient is simulated, listed by an active owner or manager, and never changed';
const SURPLUS8 = "a gift's lot is live and has an expiry, the gift is at most what is left of it, and its value is in the lot's currency";
const SURPLUS9 = 'a donated row comes only from its listing: not from another trigger chain, nor directly with a forged marker';

const SURPLUS_GIFT_CASES: Case[] = [
  s(SURPLUS1, 'v2-surplus-same-txn', `${mutate(WRITE, 'and d.created_txid = txid_current() and d.decided_by = ctx_actor', 'and d.decided_by = ctx_actor')}
    ${mutate(GIVE, 'and d.created_txid = txid_current() and d.decided_by = ctx_actor', 'and d.decided_by = ctx_actor')}`),
  s(SURPLUS1, 'v2-surplus-approved', `${mutate(WRITE, "and d.verdict = 'approved'", '')} ${mutate(GIVE, "and d.verdict = 'approved'", '')}`),
  s(SURPLUS2, 'v2-surplus-value-rounding', mutate(GIVE, '(new.qty_milli * lot_cost + 500) / 1000', '(new.qty_milli * lot_cost) / 1000')),
  s(SURPLUS2, 'v2-surplus-value-caller', mutate(GIVE, 'new.value_minor := (new.qty_milli * lot_cost + 500) / 1000;', 'new.value_minor := coalesce(new.value_minor, (new.qty_milli * lot_cost + 500) / 1000);')),
  s(SURPLUS2, 'v2-surplus-stamp-by', mutate(GIVE, 'new.created_by := move_by;', 'new.created_by := coalesce(new.created_by, move_by);')),
  s(SURPLUS2, 'v2-surplus-listing-audit', asOwner('drop trigger audit on ops.surplus_listing;')),
  s(SURPLUS9, 'v2-surplus-depth', mutate(KIND, ' or pg_trigger_depth() < 2', '')),
  s(SURPLUS9, 'v2-surplus-marker', mutate(KIND, "\n                                  or nullif(current_setting('munshi.surplus_move', true), '') is null", '')),
  s(SURPLUS3, 'v2-surplus-gives-once', mutate(GIVE, 'and m.decision_id = ctx_decision) then', 'and false) then')),
  s(SURPLUS3, 'v2-surplus-kind-command', mutate(KIND, "elsif (new.kind = 'donated') is distinct from (by_command = 'surplus.give') then", "elsif new.kind = 'donated' and by_command is distinct from 'surplus.give' then")),
  s(SURPLUS3, 'v2-surplus-stock-kind-trigger', asOwner('drop trigger b_stock_kind on books.stock_move;')),
  s(SURPLUS3, 'v2-surplus-payload', mutate(GIVE, "if give -> 'lotId' is distinct from to_jsonb(new.lot_id::text) or give -> 'qtyMilli' is distinct from to_jsonb(new.qty_milli)", "if false and (give -> 'lotId' is distinct from to_jsonb(new.lot_id::text) or give -> 'qtyMilli' is distinct from to_jsonb(new.qty_milli))")),
  s(SURPLUS3, 'v2-surplus-lot-size', mutate(GIVE, 'if new.qty_milli > lot_left then', 'if false then')),
  s(SURPLUS8, 'v2-surplus-lot-left', mutate(GIVE, 'if new.qty_milli > lot_left then', 'if new.qty_milli > lot_qty then')),
  s(SURPLUS8, 'v2-surplus-lot-expiry', mutate(GIVE, ' and pl.expires_on is not null', '')),
  s(SURPLUS8, 'v2-surplus-lot-reversed', mutate(GIVE, 'and x.reverses_id = p.id);', 'and false);')),
  s(SURPLUS8, 'v2-surplus-currency', mutate(GIVE, 'new.currency := lot_currency;', "new.currency := 'INR';")),
  s(SURPLUS2, 'v2-surplus-move-source', mutate(GIVE, "'donated', 'books.purchase_line', new.lot_id,", "'donated', 'books.purchase_line', new.recipient_id,")),
  s(SURPLUS4, 'v2-surplus-staff-approves', "insert into ref.command_authority (command, role) values ('surplus.give', 'staff');"),
  s(SURPLUS4, 'v2-surplus-acting-member', `${mutate(WRITE, 'and d.created_txid = txid_current() and d.decided_by = ctx_actor', 'and d.created_txid = txid_current()')}
    ${mutate(GIVE, 'and d.created_txid = txid_current() and d.decided_by = ctx_actor', 'and d.created_txid = txid_current()')}`),
  s(SURPLUS5, 'v2-surplus-rls-listing', 'drop policy tenant_isolation on ops.surplus_listing; create policy tenant_isolation on ops.surplus_listing using (true) with check (true);'),
  s(SURPLUS5, 'v2-surplus-rls-recipient', 'drop policy tenant_isolation on ops.surplus_recipient; create policy tenant_isolation on ops.surplus_recipient using (true) with check (true);'),
  s(SURPLUS6, 'v2-surplus-impact-reversed', mutate(IMPACT, '\n     and not exists (select 1 from books.stock_move r where r.tenant_id = l.tenant_id and r.reverses_id = l.stock_move_id)', '')),
  s(SURPLUS6, 'v2-surplus-impact-window', mutate(IMPACT, 'and l.created_at >= p_from ', '')),
  s(SURPLUS6, 'v2-surplus-reverse-command', mutate(KIND, "(new.kind = 'donated' and by_command is distinct from 'stock.reverse')", 'false')),
  s(SURPLUS7, 'v2-surplus-recipient-role', mutate('ops.surplus_recipient_guard()', " and m.role in ('owner', 'manager')", '')),
  s(SURPLUS7, 'v2-surplus-recipient-simulated', dropCheck('ops.surplus_recipient', 'simulated')),
  s(SURPLUS7, 'v2-surplus-recipient-update', 'grant update (simulated) on ops.surplus_recipient to munshi_app;'),
];

const SPEAK1 = 'every check that lists the model roles lists exactly the same ones, speak among them, on the role tables only';
const ROLES1 = 'the documents and shelf_video desks serve the document and video roles; a clip runs under photo; an owner chooses an allowed model for each';
const ROLES2 = 'the role checks of ai.usage and ai.spend admit document and video';
// A role check put back to the set without the document and video roles; NOT VALID, so rows the fixtures already wrote cannot stop it applying.
const BEFORE = "('router', 'reason', 'vision', 'segment', 'voice', 'narrate', 'speak')";
const narrow = (table: string) => `${dropCheck(table, "'video'")} alter table ${table} add check (role in ${BEFORE}) not valid;`;

const ROLES_CASES: Case[] = [
  r(SPEAK1, 'v2-roles-set-drops', narrow('ai.spend')),
  r(ROLES1, 'v2-roles-desk', "delete from ref.ai_agent where agent = 'shelf_video';"),
  r(ROLES1, 'v2-roles-desk-role', "update ref.ai_agent set role = 'vision' where agent = 'documents';"),
  r(ROLES1, 'v2-roles-allow-set', narrow('platform.model_allow')),
  r(ROLES1, 'v2-roles-choice-role', mutate('ops.model_choice_guard()', 'where ma.alias = new.alias and ma.role = a.role', 'where ma.alias = new.alias')),
  r(ROLES2, 'v2-roles-usage-set', narrow('ai.usage')),
  r(ROLES2, 'v2-roles-spend-set', narrow('ai.spend')),
];

const ROLE7 = "snoozing, waking early and dismissing a finding is an active owner's or manager's call: staff are refused, and nothing moves";
const MARK = "a campaign is marked written by AI when a run's text becomes its copy, and the mark never goes back: not by a person's edit, an erased text, or anyone's write";
const CAMPAIGN = 'ops.campaign_guard()';

const HARDENING_CASES: Case[] = [
  f(ROLE7, 'v2-role7-finding-role', mutate('ai.finding_flow()', " and m.active and m.role in ('owner', 'manager')) then", ' and m.active) then')),
  m(MARK, 'v2-mark-sticky', mutate(CAMPAIGN, "(tg_op = 'UPDATE' and old.ai_drafted) or ", '')),
  m(MARK, 'v2-mark-stamped', mutate(CAMPAIGN, "new.ai_drafted := (tg_op = 'UPDATE' and old.ai_drafted) or exists (", 'new.ai_drafted := new.ai_drafted or exists (')),
  m(MARK, 'v2-mark-run-author', mutate(CAMPAIGN, "and t.author = 'run')", "and t.author = 'template')")),
  m(MARK, 'v2-mark-grant', 'grant update (ai_drafted) on ops.campaign to munshi_app;'),
  m(MARK, 'v2-mark-jobs-read', 'revoke select (ai_drafted) on ops.campaign from munshi_jobs;'),
];

export const SURPLUS_CASES: Case[] = [...SURPLUS_GIFT_CASES, ...ROLES_CASES, ...HARDENING_CASES];
