// Red-proofs of the messaging gates (test/v2/gates/19-messaging.test.ts): each breaks one rule of a 19 trigger, key
// or grant so that the named test goes RED.
import type { Case } from '../../sabotage.ts';
import { asOwner, mutate } from './sql.ts';

const V2 = 'vitest.v2.config.ts';
const FILE = 'test/v2/gates/19-messaging.test.ts';
const t = (test: string, sabotage: string, sql: string): Case => ({ sabotage, file: FILE, test, config: V2, sql });
const t14 = (test: string, sabotage: string, sql: string): Case => ({ sabotage, file: 'test/v2/gates/14-sites.test.ts', test, config: V2, sql });
const DERIVE = 'ops.delivery_derive()';
const STATUS = 'ops.delivery_status()';

const BOOK = 'an outbound message is a book: reorder.place by an owner or manager, never staff; its text unerased and of its hash (MS006); its recipient the shop’s, of its kind (MS007)';
const W6_DERIVE = 'W6 a delivery is derived in its message’s transaction, one per message, every field the database’s; a direct insert for an earlier message is refused, and a test send is a member’s own';
const W6_FORWARD = 'W6 a delivery moves forward only: claimed once by the jobs role (two sweeps at once claim it once), sent only from sending, later statuses from the webhook; nothing returns to queued; a recorded delivery stays recorded';
const K2 = 'K2 a campaign reaches a customer only with marketing consent given through their current, unerased contact: of five planted recipients exactly one gets a message; a reminder needs service consent';
const STOP = 'STOP a bare STOP is an opt-out whatever the webhook says; it is handled only beside its withdrawal, never ignored, and never erased before it; other messages are purged 30 days after they arrive';
const X1 = 'X1 an extract’s span lies inside its live message and hashes to its sha256; a digit span in any script re-parses to its number (paise, thousandths); a word span is core’s';
const E1 = 'E1 after an inbox message is purged, and with it the texts made from it, no name or phone from it is left in ops.*, ai.*, approval.*, snap.*, audit.* or platform.*';
const RET1 = 'RET1 the purge erases a sent text 30 days after its last delivery is final, never while one is open or sooner';
const R1 = 'R1 an active owner lists test recipients only under a live WhatsApp grant and within its cap, each with its route in one transaction; a number routes to one shop (first come); routes are erased with their removed recipient';
const CH1 = 'CH1 a delivery is real (pending) only on a live deployment, from a real session, to a real recipient, with the shop’s live grant and, on WhatsApp, a listed recipient; otherwise recorded, a demo always';
const CAMPAIGN = 'ROLE1 a campaign is composed by an active owner or manager and moves composing → proposed → approved or rejected (or back), approved → sent; its copy changes only while composing; its card is a card';
const INBOX = 'ROLE1 an inbox message is stored by the webhook with no actor, its media filled once by the webhook, its transcript once by a member’s run, handled once by an active member; the jobs role only erases';
const BOOKING = 'ROLE1 a booking moves by role: the public its own hold, a member a request or a confirmed booking (confirmed only in booking.confirm, done only with its sale), the jobs role an expiry';
const OUTBOUND = 'books.outbound_derive()';
const FLOW = 'ops.inbound_flow()';
const SPAN = 'ops.extract_span()';
const MOVES = "if not (move in ('queued>sending', 'queued>blocked',";

const RET1_ORPHAN = 'RET1 a text nothing names is purged 30 days after it was written, never sooner, nor while a message, test send, answer, open campaign or order line names it';
const R1_ERASED = 'R1 a contact’s erasure removes the test recipient it was and erases its route, in the same update';
const TEXT_GUARD = 'ops.message_text_guard()';

export const MESSAGING_CASES: Case[] = [
  t(BOOK, 'v2-outbound-hash', mutate('books.outbound_derive()', 'and t.body_sha256 = new.body_sha256) then', ') then')),
  t(BOOK, 'v2-outbound-recipient', mutate('books.outbound_derive()', 'if not (case new.recipient_kind', 'if false and not (case new.recipient_kind')),
  t(W6_DERIVE, 'v2-w6-earlier-message', mutate(DERIVE, 'if msg.created_txid is distinct from txid_current() then', 'if false then')),
  // the caller's mode, status and address kept
  t(W6_DERIVE, 'v2-w6-caller-fields', [
    mutate(DERIVE, "new.mode := case when real then 'pending' else 'recorded' end;", 'new.mode := coalesce(new.mode, \'recorded\');'),
  ].join('\n')),
  t(W6_DERIVE, 'v2-w6-test-send-own', mutate(DERIVE, 'if new.test_member_id is distinct from ctx_actor or not exists (', 'if not exists (')),
  // a second claim admitted: sending → sending, and the attempt not counted
  t(W6_FORWARD, 'v2-w6-claim-twice', [
    mutate(STATUS, MOVES, "if not (move in ('queued>sending', 'sending>sending', 'queued>blocked',"),
    mutate(STATUS, 'if old.attempts <> 0 then', 'if false then'),
  ].join('\n')),
  t(W6_FORWARD, 'v2-w6-requeue', mutate(STATUS, MOVES, "if not (move in ('queued>sending', 'sending>queued', 'queued>blocked',")),
  t(W6_FORWARD, 'v2-w6-recorded-adapter', mutate(STATUS, 'if new.mode is distinct from old.mode and not (', 'if false and not (')),
  t(W6_FORWARD, 'v2-w6-webhook-early', mutate(STATUS, "if not (move in ('sent>delivered', 'sent>read',", "if not (move in ('sending>delivered', 'sent>delivered', 'sent>read',")),
  // no delivery derived at all
  t(BOOK, 'v2-outbound-no-delivery', asOwner('drop trigger z_outbound_delivery on books.outbound_message;')),
  t(K2, 'v2-k2-consent', mutate(OUTBOUND, "if wanted is not null and new.recipient_kind = 'customer' then", 'if false then')),
  t(K2, 'v2-k2-erased-contact', mutate(OUTBOUND, 'c.id = current_contact and c.erased_at is null)', 'c.id = current_contact)')),
  t(STOP, 'v2-stop-withdrawal', mutate(FLOW, "if new.opt_out and (new.status <> 'handled' or not exists (", "if false and (new.status <> 'handled' or not exists (")),
  t(STOP, 'v2-stop-erased', mutate(FLOW, "if old.opt_out and old.status <> 'handled' then", 'if false then')),
  t(STOP, 'v2-stop-word', mutate(FLOW, "new.opt_out := new.opt_out or upper(btrim(coalesce(new.text, ''))) = 'STOP';", '')),
  t(STOP, 'v2-stop-age', mutate(FLOW, "elsif old.received_at > now() - interval '30 days' then", 'elsif false then')),
  t(X1, 'v2-x1-number', mutate(SPAN, "or digits::numeric * (case new.field when 'amount' then 100 else 1000 end) is distinct from new.num then", 'then')),
  t(X1, 'v2-x1-hash', mutate(SPAN, "if sha256(convert_to(span, 'UTF8')) <> new.span_sha256 then", 'if false then')),
  t(X1, 'v2-x1-bounds', mutate(SPAN, 'if source is null or new.span_end > char_length(source) then', 'if source is null then')),
  // Devanagari digits left unread
  t(X1, 'v2-x1-scripts', mutate(SPAN, "'०१२३४५६७८९০১২৩৪৫৬৭৮৯", "'0123456789০১২৩৪৫৬৭৮৯")),
  t(E1, 'v2-e1-with-source', mutate('ops.message_text_guard()',
    '\n        or exists (select 1 from ai.answer a join ops.inbound_message i on i.tenant_id = a.tenant_id and i.id = a.inbound_message_id\n                    where a.tenant_id = new.tenant_id and a.text_id = new.id and i.erased_at is not null)', '')),
  t(RET1, 'v2-ret1-final-age', mutate('ops.message_text_guard()', "(d.final_at is null or d.final_at > now() - interval '30 days')", '(d.final_at is null)')),
  t(R1, 'v2-r1-cap', mutate('ops.recipient_guard()', 'if coalesce(cap, 0) <= (', 'if false and coalesce(cap, 0) <= (')),
  t(R1, 'v2-r1-route-with-recipient', mutate('ops.route_guard()', 'and r.created_txid = txid_current() and r.removed_at is null) then', 'and r.removed_at is null) then')),
  t(R1, 'v2-r1-first-come', asOwner('drop index ops.phone_route_hmac;')),
  t(R1, 'v2-r1-own-routes', asOwner(`drop policy route_own on ops.phone_route;
    create policy route_own on ops.phone_route to munshi_app, munshi_jobs using (true) with check (true);`)),
  t(R1, 'v2-r1-erase-removed', mutate('ops.route_guard()', 'r.id = new.recipient_id and r.removed_at is not null) then', 'r.id = new.recipient_id) then')),
  t(CH1, 'v2-ch1-live', mutate(DERIVE, "real := coalesce((select d.kind from ops.deployment d), 'demo') = 'live'", 'real := true')),
  t(CH1, 'v2-ch1-via', mutate(DERIVE, "and nullif(current_setting('munshi.via', true), '') is not distinct from 'real'", '')),
  t(CH1, 'v2-ch1-simulated', mutate(DERIVE, '          and not simulated\n', '')),
  t(CH1, 'v2-ch1-no-grant', mutate(DERIVE, 'order by g.effective_from desc, g.id desc limit 1), false)', 'order by g.effective_from desc, g.id desc limit 1), true)')),
  t(CH1, 'v2-ch1-withdrawn', mutate(DERIVE, 'where g.tenant_id = new.tenant_id and g.channel = case', 'where g.granted and g.tenant_id = new.tenant_id and g.channel = case')),
  t(CH1, 'v2-ch1-listed', mutate(DERIVE, "and (new.channel = 'instagram' or exists (", 'and (true or exists (')),
  t(CH1, 'v2-ch1-sms', mutate(DERIVE, "          and new.channel <> 'sms'\n", '')),
  t(CAMPAIGN, 'v2-campaign-who', mutate('ops.campaign_guard()', "m.role in ('owner', 'manager') and m.active) then", 'm.active) then')),
  t(CAMPAIGN, 'v2-campaign-moves', mutate('ops.campaign_guard()', "(old.status = 'composing' and new.status = 'proposed')", "(old.status = 'composing' and new.status in ('proposed', 'approved'))")),
  t(CAMPAIGN, 'v2-campaign-copy', mutate('ops.campaign_guard()', "       and old.status <> 'composing' then", "       and false then")),
  t(INBOX, 'v2-inbox-actor', mutate(FLOW, "if current_user <> 'munshi_public' or ctx_actor is not null then", "if current_user <> 'munshi_public' then")),
  t(INBOX, 'v2-inbox-once', mutate(FLOW, "if current_user <> 'munshi_app' or old.status <> 'new' or not exists (", "if current_user <> 'munshi_app' or not exists (")),
  t14(BOOKING, 'v2-booking-message', asOwner('drop trigger z_booking_message on ops.booking;')),
  t14(BOOKING, 'v2-booking-message-customer', mutate('ops.booking_message()', ' and m.recipient_id = new.customer_id', '')),
  t(RET1_ORPHAN, 'v2-ret1-orphan-age', mutate(TEXT_GUARD, "or (old.created_at < now() - interval '30 days'", 'or (true')),
  t(RET1_ORPHAN, 'v2-ret1-orphan-campaign', mutate(TEXT_GUARD, "and c.status in ('composing', 'proposed', 'approved'))", ')')),
  t(RET1_ORPHAN, 'v2-ret1-orphan-order-note', mutate(TEXT_GUARD,
    '\n            and not exists (select 1 from books.order_line l where l.tenant_id = new.tenant_id and l.note_text_id = new.id))) then', ')) then')),
  t(R1_ERASED, 'v2-r1-erase-removes', asOwner('drop trigger recipients on ops.contact;')),
];
