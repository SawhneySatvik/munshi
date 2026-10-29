// Red-proofs of the 04_ops_infra.sql gates (test/v2/gates/04-ops.test.ts).
import type { Case } from './case.ts';
import { mutate } from './sql.ts';

const V2 = 'vitest.v2.config.ts';
const FILE = 'test/v2/gates/04-ops.test.ts';
const t = (test: string, sabotage: string, sql: string): Case => ({ sabotage, file: FILE, test, config: V2, sql });

const IDEM1 = 'IDEM1 a key is taken once: a concurrent duplicate waits for the first and then fails; the result is filled once, in the key’s own transaction, ids only';
const IDEM_PURGE = 'SWEEP1 the jobs role purges idempotency keys older than 7 days, in its tenant only, and nothing newer';
const BUCKET1 = "BUCKET1 a document whose storage_key names another tenant's bucket is refused; art is SVG of at most 200 KB, a card a JPEG";
const CLAIMS = 'SWEEP1 a job slot is claimed once; an unfinished claim is taken over only after 5 minutes; a finished one never changes, and is swept only after 7 days';
const RET1 = 'RET1 the contact purge is refused one day short of a year and accepted one day past, or at once once the owner asked; an owner asks once';

const G7_CONTACT = 'G7 a contact’s add, erase request and erasure each chain one entry under the acting member, ids only; the jobs purge chains none';
const C4_INPUT = 'C4 a typed number is the acting member’s own: stamped with the actor whatever was sent, refused with no actor and for any role but the app';

export const OPS_CASES: Case[] = [
  t(IDEM1, 'v2-idem1-no-key', 'alter table ops.idempotency drop constraint idempotency_pkey;'),
  t(IDEM1, 'v2-idem1-own-tx', mutate('ops.idempotency_guard()', ' or old.created_txid <> txid_current()', '')),
  t(IDEM1, 'v2-idem1-ids-only', 'alter table ops.idempotency drop constraint idempotency_result_check;'),
  t(IDEM_PURGE, 'v2-sweep1-idem-age',
    'drop policy idempotency_purge on ops.idempotency; create policy idempotency_purge on ops.idempotency as restrictive for delete to munshi_jobs using (true);'),
  t(BUCKET1, 'v2-bucket1-prefix', mutate('ops.document_check()',
    "if left(new.storage_key, 39) is distinct from 't-' || new.tenant_id::text || '/' or char_length(new.storage_key) < 40 then", 'if false then')),
  t(CLAIMS, 'v2-sweep1-lease', mutate('ops.job_claim_guard()', "old.claimed_at >= now() - interval '5 minutes' or ", '')),
  t(CLAIMS, 'v2-sweep1-claim-age',
    'drop policy job_claim_purge on ops.job_claim; create policy job_claim_purge on ops.job_claim as restrictive for delete to munshi_jobs using (finished_at is not null);'),
  t(RET1, 'v2-ret1-contact-age', mutate('ops.contact_guard()', "elsif old.erase_requested_at is null and old.created_at > now() - interval '1 year' then", 'elsif false then')),
  t(RET1, 'v2-ret1-request-owner', mutate('ops.contact_guard()', "or actor_role is distinct from 'owner') then", 'or actor_role is null) then')),
  t(G7_CONTACT, 'v2-g7-contact-audit', mutate('ops.contact_audit()', "    act := 'contact.erase_request';\n", '')),
  t(C4_INPUT, 'v2-c4-input-actor', mutate('ops.input_guard()', '  new.member_id := ctx_actor;\n', '')),
];
