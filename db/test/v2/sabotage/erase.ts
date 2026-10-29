// Red-proofs of OE1 (test/v2/gates/02-erase.test.ts): each lets one exploit path through ops.only_erase or
// ops.fill_once, or shortens an erase trigger's column list.
import type { Case } from './case.ts';
import { asOwner, mutate } from './sql.ts';

const V2 = 'vitest.v2.config.ts';
const FILE = 'test/v2/gates/02-erase.test.ts';

export const ERASE_CASES: Case[] = [
  {
    // a personal column may change outside the erasure
    sabotage: 'v2-oe1-change',
    file: FILE,
    test: 'OE1 an erasure nulls every personal column with erased_at = now() in one UPDATE, and the erased row never changes again',
    config: V2,
    sql: mutate('ops.only_erase()', 'elsif not erasing and (o -> col) is distinct from (n -> col) then', 'elsif false then'),
  },
  {
    // an erased row may change again
    sabotage: 'v2-oe1-unfrozen',
    file: FILE,
    test: 'OE1 an erasure nulls every personal column with erased_at = now() in one UPDATE, and the erased row never changes again',
    config: V2,
    sql: mutate('ops.only_erase()', "if o ->> 'erased_at' is not null then", 'if false then'),
  },
  {
    sabotage: 'v2-oe1-fill-null',
    file: FILE,
    test: 'OE1 a NULL personal column is never filled: a changed phone is a new contact',
    config: V2,
    sql: mutate('ops.only_erase()', 'elsif not erasing and (o -> col) is distinct from (n -> col) then', 'elsif not erasing and o ->> col is not null and (o -> col) is distinct from (n -> col) then'),
  },
  {
    // a fill-once column fills again once its stamp is set
    sabotage: 'v2-oe1-fill-twice',
    file: FILE,
    test: 'OE1 a fill-once column fills once, in the UPDATE that sets its stamp, never again even after a NULL; an erasure still nulls it and freezes the row',
    config: V2,
    sql: mutate('ops.fill_once()', 'if n ->> col is not null or o ->> \'erased_at\' is not null or n ->> \'erased_at\' is null then', 'if false then'),
  },
  {
    sabotage: 'v2-oe1-short-list',
    file: FILE,
    test: 'OE1 every erasable table lists exactly its personal and identity columns in its erase trigger',
    config: V2,
    sql: asOwner("drop trigger erase on ops.contact; create trigger erase before update on ops.contact for each row execute function ops.only_erase('name');"),
  },
];
