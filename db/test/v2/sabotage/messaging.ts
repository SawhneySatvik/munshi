// Red-proofs of the messaging gates (test/v2/gates/19-messaging.test.ts): each breaks one rule of a 19 trigger, key
// or grant so that the named test goes RED.
import type { Case } from '../../sabotage.ts';
import { mutate } from './sql.ts';

const V2 = 'vitest.v2.config.ts';
const FILE = 'test/v2/gates/19-messaging.test.ts';
const t = (test: string, sabotage: string, sql: string): Case => ({ sabotage, file: FILE, test, config: V2, sql });
const DERIVE = 'ops.delivery_derive()';
const STATUS = 'ops.delivery_status()';

const BOOK = 'an outbound message is a book: reorder.place by an owner or manager, never staff; its text unerased and of its hash (MS006); its recipient the shop’s, of its kind (MS007)';
const W6_DERIVE = 'W6 a delivery is derived in its message’s transaction, one per message, every field the database’s; a direct insert for an earlier message is refused, and a test send is a member’s own';
const W6_FORWARD = 'W6 a delivery moves forward only: claimed once by the jobs role (two sweeps at once claim it once), sent only from sending, later statuses from the webhook; nothing returns to queued; a recorded delivery stays recorded';
const MOVES = "if not (move in ('queued>sending', 'queued>blocked',";

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
];
