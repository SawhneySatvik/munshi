// Red-proofs of the order gates (test/v2/gates/21-orders.test.ts): each breaks one rule of a 21 trigger, key, check or
// grant so that the named test goes RED.
import type { Case } from '../../sabotage.ts';
import { asOwner, dropCheck, mutate } from './sql.ts';

const V2 = 'vitest.v2.config.ts';
const FILE = 'test/v2/gates/21-orders.test.ts';
const t = (test: string, sabotage: string, sql: string): Case => ({ sabotage, file: FILE, test, config: V2, sql });
const FLOW = 'books.order_flow()';
const REQUEST = 'ops.order_request_flow()';
const HOLD = 'ops.contact_hold()';

const ORD2 = 'ORD2 an order’s steps follow ref.order_flow for its kind (MS019): confirmed first and once, each step its command’s, a reschedule from any open step, delivered only by its sale, nothing after the end; ops.order_state is always the latest step';
const ORD2_RACE = 'ORD2 two taps at once make one step and one refusal (23505); a direct write to ops.order_state is refused';
const ORD5 = 'ORD5 the public and webhook roles write no books.order*; a request becomes an order only in the order’s transaction, by a person; it holds a release and lines, or a message, and no personal data';
const REQUEST_ROLES = 'ROLE1 a request is the public’s or an active member’s, new; a member drafts it under its order.confirm draft or declines it with a decline reason; the jobs role expires it after expires_at';
const PRICE = 'b_order_price an order line’s unit price is its price row’s, or its taker’s own typed money quote (MS006)';
const M1 = 'M1 a contact is erased with its measurements and every value, in one transaction, and never while an order of theirs is open or its advance unapplied; an order line keeps the measurement id';
const RET1 = 'RET1 §2.6 holds: a contact is not erased while its credit, package, points, a staff advance or a booking ahead is open; the purge erases one only when every linked row has been idle a year, or the owner asked';
const TAINT = 'the taint list: a draft from a tainted run is only a recipe a person’s tap starts, order.confirm among them (MS002)';

const ORD5_LINES = 'ORD5 a site request’s lines name goods this shop sells: another shop’s item, a service or an item no longer sold is refused (MS007)';

export const ORDERS_CASES: Case[] = [
  t(ORD2, 'v2-ord2-flow', mutate(FLOW, 'if latest is not null and not exists (select 1 from ref.order_flow f', 'if false and not exists (select 1 from ref.order_flow f')),
  t(ORD2, 'v2-ord2-first', mutate(FLOW, "if (latest is null) <> (new.step = 'confirmed') then", 'if false then')),
  t(ORD2, 'v2-ord2-command', mutate(FLOW, 'if by_command is distinct from wants then', 'if false then')),
  t(ORD2, 'v2-ord2-delivered-sale', mutate(FLOW, "if new.step = 'delivered' and not exists (", "if false and not exists (")),
  t(ORD2, 'v2-ord2-trial', mutate(FLOW, "if new.trial_on is not null and o.kind = 'goods' then", 'if false then')),
  t(ORD2, 'v2-ord2-message', mutate(FLOW, 'if new.message_id is not null and not exists (', 'if false and not exists (')),
  t(ORD2, 'v2-ord2-voided', mutate(FLOW, 'if o.reverses_id is not null or exists (', 'if false and exists (')),
  // the projection forgets a due date a later step did not set
  t(ORD2, 'v2-ord2-carry-over', mutate('books.order_state()', 'due_on = coalesce(excluded.due_on, s.due_on)', 'due_on = excluded.due_on')),
  t(ORD2, 'v2-ord2-confirmed-step', asOwner('drop trigger z_order_confirmed on books.order;')),
  // ORD2's two named red-proofs
  t(ORD2_RACE, 'v2-ord2-step-key', asOwner('drop index books.order_step_no;')),
  t(ORD2_RACE, 'v2-ord2-state-guard', asOwner('drop trigger order_state_guard on ops.order_state;')),
  t(ORD5, 'v2-ord5-public-grant', 'grant insert on books.order to munshi_public;'),
  t(ORD5, 'v2-ord5-confirm-alone', mutate(REQUEST, '      if new.order_id is null then', '      if false then')),
  t(ORD5, 'v2-ord5-expiry', mutate(REQUEST, "and new.state = 'expired' and old.expires_at <= now())", "and new.state = 'expired')")),
  t(ORD5, 'v2-ord5-lines', dropCheck('ops.order_request', 'jsonb_array_length(lines)')),
  t(REQUEST_ROLES, 'v2-request-actor', mutate(REQUEST, "raise exception 'order request refused: an actor is set only by munshi_app' using errcode = 'MS018';", 'null;')),
  t(REQUEST_ROLES, 'v2-request-draft', mutate(REQUEST, "and d.id = new.draft_id and d.command = 'order.confirm') then", 'and d.id = new.draft_id) then')),
  t(PRICE, 'v2-order-price-row', mutate('books.order_price()', 'and p.amount_minor = new.unit_price_minor and p.currency = new.currency))', 'and p.currency = new.currency))')),
  t(PRICE, 'v2-order-price-own-quote', mutate('books.order_price()', 'and i.member_id = new.created_by)) then', ')) then')),
  t(M1, 'v2-m1-with-measurements', asOwner('drop trigger z_contact_measurements on ops.contact;')),
  t(M1, 'v2-m1-open-order', mutate(HOLD, 'and o.reverses_id is null and not r.terminal', 'and false')),
  t(M1, 'v2-m1-unapplied-advance', mutate(HOLD, 'where p.tenant_id = o.tenant_id and p.order_id = o.id), 0)', 'where false), 0)')),
  t(M1, 'v2-m1-measurement-first', mutate('ops.measurement_guard()',
    "exists (select 1 from ops.contact c where c.tenant_id = new.tenant_id and c.id = new.contact_id and c.erased_at is not null)\n       and (", '(')),
  t(M1, 'v2-m1-value-first', mutate('ops.measurement_value_guard()', 'or (old.erased_at is null and new.erased_at is not null and not exists (', 'or (false and not exists (')),
  t(M1, 'v2-m1-value-late', mutate('ops.measurement_value_guard()', 'and x.created_txid = txid_current() and x.taken_by', 'and x.taken_by')),
  t(M1, 'v2-m1-taker', mutate('ops.measurement_guard()', '    new.taken_by := ctx_actor;\n', '')),
  t(RET1, 'v2-ret1-staff-advance', mutate(HOLD, '     or exists (select 1 from books.staff s', '     or false and exists (select 1 from books.staff s')),
  t(RET1, 'v2-ret1-credit', mutate(HOLD, "if coalesce((select sum(e.amount_minor) from books.credit_entry e where e.tenant_id = new.tenant_id and e.customer_id = any (customers)), 0) <> 0",
    'if false')),
  t(RET1, 'v2-ret1-idle-year', mutate(HOLD, "if current_user = 'munshi_jobs' and old.erase_requested_at is null and (", 'if false and (')),
  t(TAINT, 'v2-taint', asOwner('drop trigger taint on approval.draft;')),
  t(ORD5_LINES, 'v2-ord5-lines-good', mutate(REQUEST, "and i.kind = 'good'\n", '\n')),
  t(ORD5_LINES, 'v2-ord5-lines-sellable', mutate(REQUEST, 'and coalesce((select r.sellable from books.item_revision r', 'and coalesce((select true from books.item_revision r')),
];

// The W2-close schema batch (test/v2/core/orders/status.test.ts).
const STATUS_FILE = 'test/v2/core/orders/status.test.ts';
const s = (test: string, sabotage: string, sql: string): Case => ({ sabotage, file: STATUS_FILE, test, config: V2, sql });
ORDERS_CASES.push(
  // the public reads every order, not only the one whose code it holds
  s('the status page reads an order’s steps only under its own code: never another order, never a list', 'v2-ord-status-list', asOwner('drop policy order_code_public on books.order;')),
  // an Instagram message cannot be stored
  s(
    'an Instagram message is an order’s intake: the inbox stores it on its channel and its request is read as received',
    'v2-inbound-instagram',
    asOwner("alter table ops.inbound_message drop constraint inbound_message_channel_check, add constraint inbound_message_channel_check check (channel = 'whatsapp');"),
  ),
  // the advance kept as credit counted with the wrong sign: the erasure is held for ever
  s(
    'a contact whose order advance was kept as credit, and that credit then used, is erased: the hold counts the kept advance with its sign',
    'v2-contact-hold-sign',
    mutate(HOLD, '+ coalesce((select sum(e.amount_minor) from books.credit_entry e join books.payment p', '- coalesce((select sum(e.amount_minor) from books.credit_entry e join books.payment p'),
  ),
);
