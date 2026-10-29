// Red-proofs of the chain, checkpoint, draft and decision gates (test/v2/gates/08-audit.test.ts).
import type { Case } from './case.ts';
import { asOwner, mutate } from './sql.ts';

const V2 = 'vitest.v2.config.ts';
const FILE = 'test/v2/gates/08-audit.test.ts';
const t = (test: string, sabotage: string, sql: string): Case => ({ sabotage, file: FILE, test, config: V2, sql });
const VERIFY = 'audit.verify_chain(uuid,boolean)';

const G7_VERIFY = 'G7 the chain verifies, then finds an edited entry and a deleted one at their seq';
const G7_STAMPS = 'G7 seq, prev_hash, hash and created_at are set by the chain, whatever the caller sent';
const G7_ENTRY = 'G7 an entry names the acting member; a book entry needs its row; an ops payload holds ids, codes and flags only';
const G7_CHECKPOINT = 'G7 a checkpoint names an entry’s own hash, past the last one; verification then walks only the tail, and a forged checkpoint is found';
const C4_DECISION = 'C4 a decision is the acting member’s, who may approve the command, a transaction after the proposal; one per draft; a rejection carries a decision code';
const C4_STATUS = 'C4 a draft leaves proposed once, as its decision or edit says, moved by a member who may approve it';
const C4_REFS = 'C4 a draft cites 1 to 50 refs of known shape, pins every snapshot it cites, and a draft for a finding writes its drafted event, one open per finding';

export const AUDIT_CASES: Case[] = [
  t(G7_VERIFY, 'v2-g7-verify-hash', mutate(VERIFY, ' or e.hash is distinct from audit.entry_hash(prev, e)', '')),
  t(G7_VERIFY, 'v2-g7-verify-tenant', mutate(VERIFY, "if p_tenant is distinct from nullif(current_setting('munshi.tenant_id', true), '')::uuid then", 'if false then')),
  t(G7_STAMPS, 'v2-g7-caller-seq', mutate('audit.chain()', 'new.seq := coalesce(last_seq, 0) + 1;', 'new.seq := coalesce(new.seq, coalesce(last_seq, 0) + 1);')),
  t(G7_ENTRY, 'v2-g7-actor', mutate('audit.chain()', 'if new.actor_id is distinct from ctx_actor then', 'if false then')),
  t(G7_ENTRY, 'v2-g7-payload', 'alter table audit.audit_log drop constraint audit_log_payload_check;'),
  t(G7_CHECKPOINT, 'v2-g7-checkpoint-hash', mutate('audit.checkpoint_guard()', ' and a.hash = new.hash', '')),
  t(G7_CHECKPOINT, 'v2-g7-checkpoint-head', mutate(VERIFY,
    'if not exists (select 1 from audit.audit_log a where a.tenant_id = p_tenant and a.seq = cp.seq and a.hash = cp.hash) then', 'if false then')),
  t(C4_DECISION, 'v2-c4-same-tx', mutate('approval.stamp_decision()', 'if draft_txid = txid_current() then', 'if false then')),
  t(C4_DECISION, 'v2-c4-authority', mutate('approval.stamp_decision()', 'join ref.command_authority ca on ca.role = m.role and ca.command = dr.command', '')),
  t(C4_STATUS, 'v2-c4-executed', mutate('approval.draft_status()',
    "if new.status = 'executed' and (verdict is distinct from 'approved' or decided_txid is distinct from txid_current()) then", 'if false then')),
  t(C4_REFS, 'v2-c4-ref-count', mutate('approval.stamp_draft()', 'or jsonb_array_length(new.based_on) not between 1 and 50', '')),
  t(C4_REFS, 'v2-c4-pin', asOwner('drop trigger pin on approval.draft;')),
];
