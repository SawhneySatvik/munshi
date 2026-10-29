// Red-proofs of ROLE1 (test/v2/gates/role1.test.ts): each drops one `current_user` check from a role-shaped trigger.
import type { Case } from '../../sabotage.ts';
import { mutate } from './sql.ts';

const V2 = 'vitest.v2.config.ts';
const FILE = 'test/v2/gates/role1.test.ts';
const ROLE1 = 'ROLE1 every role-shaped transition of files 03–09 is refused for every role it does not belong to, and for a jobs or public session that names an actor';
const t = (sabotage: string, sql: string): Case => ({ sabotage, file: FILE, test: ROLE1, config: V2, sql });

export const ROLE_CASES: Case[] = [
  // the subject summary takes a direct write, not only its triggers' (the app could relabel an owner's identity)
  {
    sabotage: 'v2-role1-summary-direct',
    file: FILE,
    test: 'ROLE1 no role writes ops.subject_summary directly: only the login, reset and operator triggers do',
    config: V2,
    sql: mutate('ops.summary_guard()', 'if pg_trigger_depth() < 2 then', 'if false then'),
  },
  // the no-actor erasure no longer checks that it is the jobs role
  t('v2-role1-contact-purge', mutate('ops.contact_guard()', "elsif current_user <> 'munshi_jobs' then", 'elsif false then')),
  // a jobs session naming an actor mints a watch snapshot
  t('v2-role1-snapshot-actor', mutate('snap.snap_check()', "if new.purpose not in ('watch', 'evidence') or ctx_actor is not null then", "if new.purpose not in ('watch', 'evidence') then")),
  // a public session naming an actor stores a document
  t('v2-role1-public-actor', mutate('ops.document_check()', "if ctx_actor is not null and current_user <> 'munshi_app' then", 'if false then')),
  // a shape refused for its own role too: an over-tight guard is a broken feature, not a safe one
  {
    sabotage: 'v2-role1-own-refused',
    file: FILE,
    test: 'ROLE1 each shape is admitted for its own role',
    config: V2,
    sql: mutate('ops.document_check()', "if new.source <> 'inbound' or new.kind not in ('voice', 'image') or new.uploaded_by is not null then", 'if true then'),
  },
];
