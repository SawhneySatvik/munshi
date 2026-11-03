// 23_memory.sql (W2-A, M3): MEM1 (an owner or manager notes a decision of their shop; its words in message_text, the
// note stamped and audited), MEM2 (a note's words: no digit character of any script, raw or under NFKC; 1 to 160
// characters, not only spaces, the writer's own new text; each id once; a window of at most a year, never backdated; a
// declined note cites a rejection), MEM3 (another shop's decision is refused), MEM4 (who may not write or end a note),
// MEM5 (append-only; one end per note), MEM6 (another shop cannot read, RLS forced), MEM7 (the in-force read: ended,
// expired and not-yet notes are out), MEM8 (an owner's erasure, E1 over ai.*; the jobs purge keeps an in-force note's
// words), MEM9 (an erasure the jobs runner completes, by contact or by customer and supplier id), MEM10 (forgetting is
// the owner's; superseding needs authority and a newer note in the same transaction) and MEM11 (valid_to's boundary in
// the read and the purge) and MEM12 (a note may name up to 32 parties, and erasing any one of them blanks it). Red-proofs:
// test/v2/sabotage/memory.ts and m6.ts.
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb, tx } from '../db.ts';
import { mintDisplay, plantProbeCommand, signUp, type Tenant } from './fixture.ts';
import { asOwner, plant, refused } from './lib.ts';

let db: TestDb;
let a: Tenant;
let b: Tenant;
let approvedA: string;
let rejectedA: string;
let ownerOnlyA: string;
let approvedB: string;

const app = () => db.as('munshi_app');
const as = (t: Tenant, actor: string) => ({ tenant_id: t.tenant, actor_id: actor });
const days = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

// A member's draft in one transaction, the verdict in the next (a draft is never decided in the transaction that made it).
async function decide(t: Tenant, command: string, verdict: 'approved' | 'rejected'): Promise<string> {
  const ref = { snapshotId: await mintDisplay(db, t, t.owner), row: 0, col: 'amount' };
  const draft = await tx(app(), as(t, t.owner), async (c) => {
    const d = await c.query<{ id: string }>(
      `insert into approval.draft (tenant_id, command, payload, based_on, payload_refs, source, created_txid)
       values ($1, $2, '{}', $3, '{}', 'member', 0) returning id`,
      [t.tenant, command, JSON.stringify([ref])],
    );
    return d.rows[0]?.id as string;
  });
  return tx(app(), as(t, t.owner), async (c) => {
    const d = await c.query<{ id: string }>(
      `insert into approval.decision (tenant_id, draft_id, verdict, decided_by, reason, created_txid) values ($1, $2, $3, $4, $5, 0) returning id`,
      [t.tenant, draft, verdict, t.owner, verdict === 'rejected' ? 'not_now' : null],
    );
    return d.rows[0]?.id as string;
  });
}

beforeAll(async () => {
  db = await openTestDb();
  await plantProbeCommand(db);
  // A command only an owner may decide, so a manager may not note its decision.
  await db.admin.query(`set role munshi_owner;
    insert into ref.command (command, draft_only) values ('probe.owner_only', true) on conflict do nothing;
    insert into ref.command_authority (command, role) values ('probe.owner_only', 'owner') on conflict do nothing;
    reset role;`);
  a = await signUp(db, 'memory-a');
  b = await signUp(db, 'memory-b');
  approvedA = await decide(a, 'probe.approve', 'approved');
  rejectedA = await decide(a, 'probe.approve', 'rejected');
  ownerOnlyA = await decide(a, 'probe.owner_only', 'approved');
  approvedB = await decide(b, 'probe.approve', 'approved');
  await db.sabotage();
});
afterAll(() => db?.close());

type Note = { kind?: string; body?: string; decision?: string; about?: string[]; validFrom?: string; validTo?: string };
const TEXT = `insert into ops.message_text (tenant_id, body, author, body_sha256) values ($1, $2, 'member', '\\x00') returning id`;
// valid_to defaults here to thirty days on; MEM2 writes a NULL one with its own statement.
const NOTE = `insert into ai.memory (tenant_id, kind, text_id, decision_id, about, created_by, created_txid, valid_from, valid_to)
              values ($1, $2, $3, $4, $5, $6, 0, coalesce($7::timestamptz, now()), coalesce($8::timestamptz, now() + interval '30 days'))
              returning id::text, created_by::text`;
const DIGIT = 'memory refused: a note holds no digit; memory never stores a number';
const OWN = "memory refused: a note's words are a text the writer wrote in this transaction";

// The writer's words and the note in one transaction, as the app writes them.
async function writeIn(c: pg.PoolClient, t: Tenant, n: Note = {}): Promise<{ id: string; created_by: string }> {
  const text = (await c.query<{ id: string }>(TEXT, [t.tenant, n.body ?? 'Ask before ordering sugar from the new supplier'])).rows[0]?.id;
  const r = await c.query<{ id: string; created_by: string }>(NOTE, [
    t.tenant,
    n.kind ?? 'preference',
    text,
    n.decision ?? (t === a ? approvedA : approvedB),
    JSON.stringify(n.about ?? []),
    t.manager, // a planted created_by the stamp must overwrite with the actor
    n.validFrom ?? null,
    n.validTo ?? null,
  ]);
  return r.rows[0] as { id: string; created_by: string };
}
const write = (t: Tenant, actor: string, n: Note = {}, pool: pg.Pool = app()) => tx(pool, as(t, actor), (c) => writeIn(c, t, n));
const END = `insert into ai.memory_end (tenant_id, memory_id, ended_by, reason) values ($1, $2, $3, $4)`;
const end = (t: Tenant, actor: string, memory: string, reason = 'forgotten') => tx(app(), as(t, actor), (c) => c.query(END, [t.tenant, memory, t.staff, reason]));
// A newer note and the old one's end, in one transaction, as an edit is made.
const supersede = (t: Tenant, actor: string, old: string, n: Note = {}) =>
  tx(app(), as(t, actor), async (c) => {
    const newer = await writeIn(c, t, n);
    await c.query(END, [t.tenant, old, t.staff, 'superseded']);
    return newer;
  });
const inForce = async (t: Tenant, pool: pg.Pool = app()) =>
  (await tx(pool, { tenant_id: t.tenant }, (c) => c.query<{ id: string; text: string }>('select id::text, text from ai.memory_in_force()'))).rows;
const textOf = async (id: string) => (await db.admin.query('select text_id::text as id from ai.memory where id = $1', [id])).rows[0].id as string;
const purgeAs = (t: Tenant, text: string) =>
  tx(db.as('munshi_jobs'), { tenant_id: t.tenant }, (c) => c.query('update ops.message_text set body = null, erased_at = now() where id = $1', [text]));

it('MEM1 an owner or manager notes a decision of their shop: stamped with the writer, audited by ids, read in force with its words', async () => {
  const byOwner = await write(a, a.owner, { body: 'Ravi prefers Sunday delivery' });
  expect(byOwner.created_by).toBe(a.owner);
  const byManager = await write(a, a.manager, { kind: 'declined', decision: rejectedA, body: 'Not this brand of rice; the shop sells its own' });
  expect(byManager.created_by).toBe(a.manager);
  const rows = await inForce(a);
  expect(rows.map((r) => r.id)).toEqual(expect.arrayContaining([byOwner.id, byManager.id]));
  expect(rows.find((r) => r.id === byOwner.id)?.text).toBe('Ravi prefers Sunday delivery');
  const audit = await db.admin.query<{ actor_id: string; payload: unknown }>(
    `select actor_id::text, payload from audit.audit_log where tenant_id = $1 and action = 'memory.write' and entity_id = $2`,
    [a.tenant, byOwner.id],
  );
  expect(audit.rows).toEqual([{ actor_id: a.owner, payload: { kind: 'preference', decision_id: approvedA } }]);
  // ai.memory holds no words: its only text columns are the kind code.
  const cols = await db.admin.query<{ col: string }>(
    `select attname::text as col from pg_attribute where attrelid = 'ai.memory'::regclass and attnum > 0 and atttypid = 'text'::regtype`,
  );
  expect(cols.rows.map((r) => r.col)).toEqual(['kind']);
});

// Every number character this Node knows: each Unicode decimal digit (Nd) and every other number (No), whether it
// survives NFKC (circled, dingbat, fraction and number signs of many scripts) or folds to ASCII digits (superscripts,
// subscripts, circled to fifty, ½, the mathematical digits). One sample per class names the class in a failure.
const NUMBER_CHARS = (() => {
  const out: string[] = [];
  for (let c = 0; c <= 0x10ffff; c++) {
    if (c >= 0xd800 && c <= 0xdfff) continue;
    const ch = String.fromCodePoint(c);
    if (/[\p{Nd}\p{No}]/u.test(ch)) out.push(ch);
  }
  return out;
})();
const CLASSES: [string, string][] = [
  ['ASCII', 'Order 5 bags'],
  ['Arabic-Indic', 'Bags ٥'],
  ['Extended Arabic-Indic', 'Bags ۵'],
  ['Devanagari', 'पाँच नहीं, ५ बोरी'],
  ['Bengali', 'বাজার ৩'],
  ['Gurmukhi', 'ਬੋਰੀ ੫'],
  ['Gujarati', 'થેલી ૫'],
  ['Oriya', 'ବସ୍ତା ୫'],
  ['Tamil', 'மூட்டை ௫'],
  ['Telugu', 'సంచి ౫'],
  ['Kannada', 'ಚೀಲ ೫'],
  ['Malayalam', 'ചാക്ക് ൫'],
  ['Sinhala', 'මලු ෫'],
  ['Thai', 'กระสอบ ๕'],
  ['Lao', 'ຖົງ ໕'],
  ['Tibetan', 'ཁུག ༥'],
  ['Myanmar', 'အိတ် ၅'],
  ['Khmer', 'បាវ ៥'],
  ['Ol Chiki', 'ᱵᱚᱥᱛᱟ ᱕'],
  ['Meetei Mayek', 'ꯈꯥꯎ ꯵'],
  ['full-width', 'Give ２ free'],
  ['mathematical', 'Give 𝟓 free'],
  ['superscript', 'Square ² metres'],
  ['subscript', 'Water H₂O'],
  ['circled', 'Shelf ①'],
  ['circled past twenty', 'Shelf ㉑'],
  ['negative circled', 'Shelf ⓫'],
  ['dingbat', 'Shelf ❶'],
  ['fraction', 'Take ½ kilo'],
  ['Bengali currency numerator', 'Price ৴'],
  ['Ethiopic number', 'Count ፲'],
  ['Tamil number', 'Count ௰'],
];

it("MEM2 a note holds no digit character of any script, raw or under NFKC; is 1 to 160 characters of the writer's own new text, not only spaces, naming each id once; holds at most a year from now; a declined note cites a rejection", async () => {
  for (const [what, body] of CLASSES) {
    const r = await refused(write(a, a.owner, { body }));
    expect([r.code, r.message], what).toEqual(['23514', DIGIT]);
  }
  // Every number character, one savepoint each, in one transaction; the list of any that got through must be empty.
  const through = await tx(app(), as(a, a.owner), async (c) => {
    const passed: string[] = [];
    for (const ch of NUMBER_CHARS) {
      await c.query('savepoint one');
      try {
        await writeIn(c, a, { body: `Bags ${ch}` });
        passed.push(`U+${ch.codePointAt(0)?.toString(16).toUpperCase()}`);
      } catch (err) {
        if ((err as Error).message !== DIGIT) passed.push(`U+${ch.codePointAt(0)?.toString(16).toUpperCase()}: ${(err as Error).message}`);
      }
      await c.query('rollback to savepoint one');
    }
    return passed;
  });
  console.log(`MEM2 ${NUMBER_CHARS.length} number characters (Unicode ${process.versions.unicode}) sent; ${through.length} got through`);
  expect(NUMBER_CHARS.length).toBeGreaterThan(1500);
  expect(through).toEqual([]);
  // Words with no digit in the same scripts are taken.
  await write(a, a.owner, { body: 'पाँच नहीं, दो बोरी — ਦੋ ਬੋਰੀਆਂ' });
  expect((await refused(write(a, a.owner, { body: 'x'.repeat(161) }))).message).toBe('memory refused: a note is 1 to 160 characters');
  await write(a, a.owner, { body: 'y'.repeat(160) });
  for (const body of [' ', '   \t ', String.fromCodePoint(0xa0, 0x3000, 0x2003), String.fromCodePoint(0x200b, 0x2060, 0x20, 0xfeff)]) {
    const r = await refused(write(a, a.owner, { body }));
    expect([r.code, r.message], JSON.stringify(body)).toEqual(['23514', 'memory refused: a note holds words, not only spaces']);
  }
  // Another member's text (even in this transaction), an older text, a run's text and an erased text are not the
  // writer's new words.
  const managers = await refused(
    tx(app(), as(a, a.manager), async (c) => {
      const text = (await c.query<{ id: string }>(TEXT, [a.tenant, 'Words of another member'])).rows[0]?.id;
      await c.query(`select set_config('munshi.actor_id', $1, true)`, [a.owner]);
      return c.query(NOTE, [a.tenant, 'note', text, approvedA, '[]', a.owner, null, null]);
    }),
  );
  expect([managers.code, managers.message], "another member's text, this transaction").toEqual(['23514', OWN]);
  const older = await tx(app(), as(a, a.owner), async (c) => (await c.query<{ id: string }>(TEXT, [a.tenant, 'Words of an earlier transaction'])).rows[0]?.id);
  const earlier = await refused(tx(app(), as(a, a.owner), (c) => c.query(NOTE, [a.tenant, 'note', older, approvedA, '[]', a.owner, null, null])));
  expect([earlier.code, earlier.message], "an earlier transaction's text").toEqual(['23514', OWN]);
  const erased = await refused(
    tx(app(), as(a, a.owner), async (c) => {
      const t = (await c.query<{ id: string }>(TEXT, [a.tenant, 'Soon gone'])).rows[0]?.id;
      await c.query('update ops.message_text set body = null, erased_at = now() where id = $1', [t]);
      return c.query(NOTE, [a.tenant, 'note', t, approvedA, '[]', a.owner, null, null]);
    }),
  );
  expect(erased.code, 'an erased text').toBe('23514');
  const byRun = await refused(
    tx(app(), as(a, a.owner), async (c) => {
      const run = (await c.query<{ id: string }>(`insert into ai.run (tenant_id, trigger, desk) values ($1, 'question', 'ask') returning id`, [a.tenant])).rows[0]?.id;
      const t = (
        await c.query<{ id: string }>(`insert into ops.message_text (tenant_id, body, author, run_id, body_sha256) values ($1, 'A model wrote this', 'run', $2, '\\x00') returning id`, [
          a.tenant,
          run,
        ])
      ).rows[0]?.id;
      return c.query(NOTE, [a.tenant, 'note', t, approvedA, '[]', a.owner, null, null]);
    }),
  );
  expect([byRun.code, byRun.message], "a run's text").toEqual(['23514', OWN]);
  // The window: never backdated, always ending, ending after it starts and within a year of it.
  const backdated = await refused(write(a, a.owner, { validFrom: '2020-01-01T00:00:00Z' }));
  expect([backdated.code, backdated.message]).toEqual(['23514', 'memory refused: a note holds from now or later, never backdated']);
  const open = await refused(
    tx(app(), as(a, a.owner), async (c) => {
      const t = (await c.query<{ id: string }>(TEXT, [a.tenant, 'Holds for ever'])).rows[0]?.id;
      return c.query(`insert into ai.memory (tenant_id, kind, text_id, decision_id, created_by, created_txid) values ($1, 'note', $2, $3, $4, 0)`, [
        a.tenant,
        t,
        approvedA,
        a.owner,
      ]);
    }),
  );
  expect(open.code, 'no valid_to').toBe('23502');
  const inverted = await refused(write(a, a.owner, { validFrom: '2099-01-02T00:00:00Z', validTo: '2099-01-01T00:00:00Z' }));
  expect(inverted.code, 'valid_to before valid_from').toBe('23514');
  const tooLong = await refused(write(a, a.owner, { validFrom: '2099-01-01T00:00:00Z', validTo: '2100-01-01T00:00:01Z' }));
  expect([tooLong.code, tooLong.message], 'a year and a second').toEqual(['23514', expect.stringContaining('memory_check')]);
  await write(a, a.owner, { validFrom: '2099-01-01T00:00:00Z', validTo: '2100-01-01T00:00:00Z' }); // 365 days exactly
  const declined = await refused(write(a, a.owner, { kind: 'declined', decision: approvedA }));
  expect([declined.code, declined.message]).toEqual(['23514', 'memory refused: a declined note cites a rejection']);
  for (const about of [['not-a-uuid'], Array.from({ length: 33 }, (_, i) => `00000000-0000-7000-8000-0000000000${String(i).padStart(2, "0")}`)]) {
    expect((await refused(write(a, a.owner, { about }))).code, JSON.stringify(about).slice(0, 40)).toBe('23514');
  }
  const twice = await refused(write(a, a.owner, { about: [approvedA, approvedA] }));
  expect([twice.code, twice.message]).toEqual(['23514', 'memory refused: a note names each id it is about once']);
});

it("MEM3 a note citing another shop's decision is refused", async () => {
  const r = await refused(write(a, a.owner, { decision: approvedB }));
  expect([r.code, r.message]).toEqual(['23503', 'memory refused: a note cites a decision of this shop']);
  // The key itself is tenant-scoped: (tenant_id, decision_id) → approval.decision.
  const key = await db.admin.query<{ cols: string[] }>(
    `select array(select a.attname::text from unnest(c.conkey) with ordinality k(n, o) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n order by k.o) as cols
       from pg_constraint c where c.conrelid = 'ai.memory'::regclass and c.contype = 'f' and c.confrelid = 'approval.decision'::regclass`,
  );
  expect(key.rows.map((r) => r.cols)).toEqual([['tenant_id', 'decision_id']]);
});

it('MEM4 staff, an inactive or other-shop member, a member who may not decide the command, the app with no actor, the jobs role and the agent cannot write or end a note', async () => {
  const note = await write(a, a.owner);
  const words = await textOf(note.id);
  const writer = 'memory refused: an active owner or manager of the shop writes a note, through the app';
  // Staff can write the words, so the note's own guard is what refuses.
  expect((await refused(write(a, a.staff))).message).toBe(writer);
  // A writer that cannot write words at all (no actor, another shop's owner, an inactive member) is refused by the note's
  // guard before anything reads the words: here the note names existing words directly.
  const bare = (ctx: Record<string, string>, tenant: string) => tx(app(), ctx, (c) => c.query(NOTE, [tenant, 'note', words, approvedA, '[]', a.owner, null, null]));
  expect((await refused(bare({ tenant_id: a.tenant }, a.tenant))).message, 'the app with no actor').toBe(writer);
  expect((await refused(bare(as(a, b.owner), a.tenant))).message, "B's owner under A").toBe(writer);
  // B's owner under B's own context, writing A's row: B's members are visible there, so only the guard's tenant scope
  // refuses it, before the policy would.
  expect((await refused(bare(as(b, b.owner), a.tenant))).message, "B's owner under B, writing A's row").toBe(writer);
  expect((await refused(write(a, a.manager, { decision: ownerOnlyA }))).message).toBe('memory refused: the writer may not decide probe.owner_only drafts, so may not note one');
  await write(a, a.owner, { decision: ownerOnlyA });
  for (const role of ['munshi_jobs', 'munshi_agent', 'munshi_platform', 'munshi_public', 'munshi_idp']) {
    const r = await refused(tx(db.as(role), { tenant_id: a.tenant }, (c) => c.query(NOTE, [a.tenant, 'note', words, approvedA, '[]', a.owner, null, null])));
    expect(r.code, `${role} writes`).toBe('42501');
    const e = await refused(tx(db.as(role), { tenant_id: a.tenant }, (c) => c.query(END, [a.tenant, note.id, a.owner, 'forgotten'])));
    expect(e.code, `${role} ends`).toBe('42501');
  }
  const ender = 'memory refused: an active owner or manager of the shop ends a note, through the app';
  expect((await refused(end(a, a.staff, note.id))).message).toBe(ender);
  expect((await refused(end(a, b.owner, note.id))).message).toBe(ender);
  expect((await refused(tx(app(), { tenant_id: a.tenant }, (c) => c.query(END, [a.tenant, note.id, a.owner, 'forgotten'])))).message).toBe(ender);
  await plant(db.admin, 'update ops.member set active = false, deactivated_at = now() where tenant_id = $1 and id = $2', [a.tenant, a.manager]);
  try {
    expect((await refused(bare(as(a, a.manager), a.tenant))).message, 'an inactive manager writes').toBe(writer);
    expect((await refused(end(a, a.manager, note.id, 'superseded'))).message, 'an inactive manager ends').toBe(ender);
  } finally {
    await plant(db.admin, 'update ops.member set active = true, deactivated_at = null where tenant_id = $1 and id = $2', [a.tenant, a.manager]);
  }
  // A manager supersedes the owner's note with a newer one of their own, in one transaction.
  const newer = await supersede(a, a.manager, note.id, { body: 'Ask before ordering sugar from either supplier' });
  const row = await db.admin.query('select ended_by::text, reason from ai.memory_end where tenant_id = $1 and memory_id = $2', [a.tenant, note.id]);
  expect(row.rows).toEqual([{ ended_by: a.manager, reason: 'superseded' }]);
  expect((await inForce(a)).map((r) => r.id)).toEqual(expect.arrayContaining([newer.id]));
  expect((await inForce(a)).map((r) => r.id)).not.toContain(note.id);
});

it('MEM5 no role updates or deletes a note or its end, and a note ends once', async () => {
  const note = await write(a, a.owner);
  await end(a, a.owner, note.id);
  expect((await refused(end(a, a.owner, note.id))).code, 'a second end').toBe('23505');
  for (const role of ['munshi_app', 'munshi_jobs', 'munshi_agent', 'munshi_platform']) {
    const ctx = role === 'munshi_app' ? as(a, a.owner) : { tenant_id: a.tenant };
    for (const sql of ["update ai.memory set kind = 'note'", 'delete from ai.memory', "update ai.memory_end set reason = 'forgotten'", 'delete from ai.memory_end']) {
      expect((await refused(tx(db.as(role), ctx, (c) => c.query(sql)))).code, `${role}: ${sql}`).toBe('42501');
    }
  }
});

it("MEM6 another shop cannot read a shop's notes or ends, the tables' owner included (RLS forced)", async () => {
  const note = await write(a, a.owner, { body: 'Shop A keeps this' });
  await end(a, a.owner, (await write(a, a.owner)).id);
  for (const role of ['munshi_app', 'munshi_jobs']) {
    const seen = await tx(db.as(role), { tenant_id: b.tenant }, (c) =>
      c.query<{ n: number; e: number }>(
        'select (select count(*)::int from ai.memory where tenant_id = $1) as n, (select count(*)::int from ai.memory_end where tenant_id = $1) as e',
        [a.tenant],
      ),
    );
    expect(seen.rows[0], role).toEqual({ n: 0, e: 0 });
    expect((await inForce(b, db.as(role))).map((r) => r.id), role).not.toContain(note.id);
  }
  expect(await inForce(a, db.as('munshi_jobs'))).toEqual(expect.arrayContaining([expect.objectContaining({ id: note.id, text: 'Shop A keeps this' })]));
  const owned = await asOwner(
    db.admin,
    [`select count(*)::int as n from ai.memory where tenant_id = '${a.tenant}'`, `select count(*)::int as n from ai.memory_end where tenant_id = '${a.tenant}'`],
    b.tenant,
  );
  expect(
    owned.map((r) => r.rows[0].n),
    "the owner role under B's context",
  ).toEqual([0, 0]);
  // With no shop in context the read is empty.
  expect((await tx(app(), {}, (c) => c.query('select * from ai.memory_in_force()'))).rows).toEqual([]);
});

it('MEM7 the in-force read lists live notes newest first; an ended note, a note past valid_to and a note not yet valid are not in force', async () => {
  const t = await signUp(db, 'memory-c');
  const decision = await decide(t, 'probe.approve', 'approved');
  const first = await write(t, t.owner, { decision, body: 'First standing wish' });
  const second = await write(t, t.owner, { decision, body: 'Second standing wish' });
  const later = await write(t, t.owner, { decision, body: 'Holds from next year', validFrom: '2099-01-01T00:00:00Z', validTo: '2099-06-01T00:00:00Z' });
  const bounded = await write(t, t.owner, { decision, body: 'Holds a while', validTo: days(200) });
  expect((await inForce(t)).map((r) => r.id)).toEqual([bounded.id, second.id, first.id]);
  await end(t, t.owner, second.id);
  expect((await inForce(t)).map((r) => r.id)).toEqual([bounded.id, first.id]);
  // A note whose window has passed, planted (no writer may backdate one).
  await plant(db.admin, `update ai.memory set valid_from = now() - interval '2 days', valid_to = now() - interval '1 day' where tenant_id = $1 and id = $2`, [
    t.tenant,
    bounded.id,
  ]);
  expect((await inForce(t)).map((r) => r.id)).toEqual([first.id]);
  expect((await inForce(t)).map((r) => r.id)).not.toContain(later.id);
});

// The sweep of MEM8 (E1's, narrowed): every text and jsonb column of ai.*, audit.* and the words' table.
async function sweep(needle: string): Promise<{ cols: string[]; found: string[] }> {
  const { rows } = await db.admin.query<{ rel: string; col: string }>(
    `select n.nspname || '.' || c.relname as rel, a.attname::text as col
       from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
      where (n.nspname in ('ai', 'audit') or (n.nspname || '.' || c.relname) = 'ops.message_text') and c.relkind = 'r'
        and a.attnum > 0 and not a.attisdropped and a.atttypid in ('text'::regtype, 'jsonb'::regtype)`,
  );
  const found: string[] = [];
  for (const { rel, col } of rows) {
    const r = await db.admin.query(`select count(*)::int as n from ${rel} where strpos(${col}::text, $1) > 0`, [needle]);
    if (r.rows[0].n > 0) found.push(`${rel}.${col}`);
  }
  return { cols: rows.map((r) => `${r.rel}.${r.col}`), found };
}

it("MEM8 an owner's erasure (the contact first, then the words) leaves the name nowhere in ai.* and the note out of force; the jobs purge keeps an in-force note's words and takes them once it ends", async () => {
  const t = await signUp(db, 'memory-d');
  const decision = await decide(t, 'probe.approve', 'approved');
  const contact = await tx(app(), as(t, t.owner), async (c) =>
    (await c.query<{ id: string }>(`insert into ops.contact (tenant_id, name, phone_e164) values ($1, 'Kavita Rao', '+919800012345') returning id`, [t.tenant])).rows[0]?.id as string,
  );
  const about = await write(t, t.owner, { decision, body: 'Kavita Rao wants calls after lunch only', about: [contact] });
  const other = await write(t, t.owner, { decision, body: 'Keep the shutter half open in the rain' });
  // The positive control: before the erasure the sweep finds the name where it is.
  const before = await sweep('Kavita');
  expect(before.cols).toEqual(expect.arrayContaining(['ops.message_text.body', 'ai.memory.about', 'audit.audit_log.payload']));
  expect(before.found).toEqual(['ops.message_text.body']);
  // The contact's erasure, as core runs it in its own transaction: the contact, then the words of every note about an
  // erased person.
  const erased = await tx(app(), as(t, t.owner), async (c) => {
    await c.query(`update ops.contact set name = null, phone_e164 = null, erased_at = now(), erased_by = $2, erase_reason = 'request' where id = $1`, [contact, t.owner]);
    return c.query(
      `update ops.message_text x set body = null, erased_at = now() from ai.memory n
        where n.tenant_id = x.tenant_id and n.text_id = x.id and x.erased_at is null and ai.memory_names_erased(n.tenant_id, n.about)`,
    );
  });
  expect(erased.rowCount).toBe(1);
  expect((await inForce(t)).map((r) => r.id)).toEqual([other.id]);
  expect((await sweep('Kavita')).found).toEqual([]);
  expect((await db.admin.query('select count(*)::int as n from ai.memory where id = $1', [about.id])).rows[0].n, 'the note row stays').toBe(1);
  // A staff member erases no note's words (the owner's erasure only).
  const byStaff = await refused(
    tx(app(), as(t, t.staff), (c) =>
      c.query('update ops.message_text set body = null, erased_at = now() from ai.memory n where n.text_id = ops.message_text.id and n.id = $1', [other.id]),
    ),
  );
  expect(byStaff.code).toBe('MS007');
  // The owner may blank any note's words, in force and about no erased person.
  const third = await write(t, t.owner, { decision, body: 'A note the owner takes back' });
  const byOwner = await tx(app(), as(t, t.owner), async (c) =>
    c.query('update ops.message_text set body = null, erased_at = now() where id = $1', [await textOf(third.id)]),
  );
  expect(byOwner.rowCount, "the owner's erasure of an in-force note's words").toBe(1);
  // The jobs purge, 31 days on: the in-force note's words stay; once it ends they go.
  const words = await textOf(other.id);
  await plant(db.admin, `update ops.message_text set created_at = now() - interval '31 days' where id = $1`, [words]);
  const kept = await refused(purgeAs(t, words));
  expect([kept.code, kept.message]).toEqual(['MS007', 'message text refused: the purge keeps the words of a note still in force']);
  await end(t, t.owner, other.id);
  expect((await purgeAs(t, words)).rowCount).toBe(1);
});

it('MEM9 an erasure the jobs runner completes (no actor, after an open balance) blanks the words of in-force notes about the erased person, by contact, customer or supplier id, and only theirs', async () => {
  const t = await signUp(db, 'memory-e');
  const decision = await decide(t, 'probe.approve', 'approved');
  const person = (name: string, phone: string) =>
    tx(app(), as(t, t.owner), async (c) =>
      (await c.query<{ id: string }>(`insert into ops.contact (tenant_id, name, phone_e164) values ($1, $2, $3) returning id`, [t.tenant, name, phone])).rows[0]?.id as string,
    );
  const gone = await person('Meena Shah', '+919800023456');
  const live = await person('Arjun Mehta', '+919800034567');
  // A customer and a supplier, each named by a contact that is then erased; the notes name the party, not the contact.
  const goneCustomer = await person('Rohit Jain', '+919800045678');
  const goneSupplier = await person('Fatima Traders', '+919800056789');
  const customer = await tx(app(), { ...as(t, t.owner), command: 'customer.create' }, async (c) => {
    const id = (await c.query<{ id: string }>('insert into books.customer (tenant_id) values ($1) returning id', [t.tenant])).rows[0]?.id as string;
    await c.query(`insert into books.customer_terms (tenant_id, customer_id, credit_limit_minor, currency, effective_from) values ($1, $2, 0, 'INR', now())`, [t.tenant, id]);
    await c.query('insert into books.party_contact (tenant_id, customer_id, contact_id, effective_from) values ($1, $2, $3, now())', [t.tenant, id, goneCustomer]);
    return id;
  });
  const supplier = await tx(app(), { ...as(t, t.owner), command: 'supplier.create' }, async (c) => {
    const id = (await c.query<{ id: string }>('insert into books.supplier (tenant_id, is_simulated) values ($1, true) returning id', [t.tenant])).rows[0]?.id as string;
    await c.query('insert into books.party_contact (tenant_id, supplier_id, contact_id, effective_from) values ($1, $2, $3, now())', [t.tenant, id, goneSupplier]);
    return id;
  });
  const aboutGone = await write(t, t.owner, { decision, body: 'Meena Shah takes the late delivery slot', about: [gone] });
  const aboutCustomer = await write(t, t.owner, { decision, body: 'Rohit Jain pays on the first of the month', about: [customer] });
  const aboutSupplier = await write(t, t.owner, { decision, body: 'Fatima Traders deliver on Mondays', about: [supplier] });
  const aboutLive = await write(t, t.owner, { decision, body: 'Arjun Mehta pays at month end', about: [live] });
  const aboutLiveOld = await write(t, t.owner, { decision, body: 'Arjun Mehta likes the loose tea', about: [live] });
  // Each erasure: the owner asks; the runner completes it later, with no actor, the contact first.
  for (const contact of [gone, goneCustomer, goneSupplier]) {
    await tx(app(), as(t, t.owner), (c) => c.query('update ops.contact set erase_requested_at = now() where id = $1', [contact]));
    await tx(db.as('munshi_jobs'), { tenant_id: t.tenant }, (c) =>
      c.query(`update ops.contact set name = null, phone_e164 = null, erased_at = now(), erase_reason = 'retention' where id = $1`, [contact]),
    );
  }
  for (const [what, note] of [
    ['by contact id', aboutGone],
    ['by customer id', aboutCustomer],
    ['by supplier id', aboutSupplier],
  ] as const) {
    expect((await purgeAs(t, await textOf(note.id))).rowCount, what).toBe(1);
  }
  expect((await inForce(t)).map((r) => r.id)).toEqual([aboutLiveOld.id, aboutLive.id]);
  // A note about a live contact: a new text is no purge's (19), and an old one is kept while the note is in force (23).
  const recent = await refused(purgeAs(t, await textOf(aboutLive.id)));
  expect([recent.code, recent.message], 'a live contact, a new text').toEqual([
    'MS007',
    'message text refused: the purge erases a text 30 days after its Ask answer or its last final delivery, with its source message, or 30 days after it was written if nothing names it',
  ]);
  const old = await textOf(aboutLiveOld.id);
  await plant(db.admin, `update ops.message_text set created_at = now() - interval '31 days' where id = $1`, [old]);
  const kept = await refused(purgeAs(t, old));
  expect([kept.code, kept.message], 'a live contact, an old text').toEqual(['MS007', 'message text refused: the purge keeps the words of a note still in force']);
});

it('MEM10 only the owner forgets a note; superseding needs a member who may decide its command and a newer note of theirs in the same transaction', async () => {
  const forget = await write(a, a.owner, { body: 'Forget me later' });
  const r = await refused(end(a, a.manager, forget.id, 'forgotten'));
  expect([r.code, r.message], "a manager's forgetting").toEqual(['MS007', "memory refused: forgetting a note is the owner's command"]);
  await end(a, a.owner, forget.id, 'forgotten');
  const audit = await db.admin.query<{ actor_id: string; payload: unknown }>(
    `select actor_id::text, payload from audit.audit_log where tenant_id = $1 and action = 'memory.end' and entity_id = $2`,
    [a.tenant, forget.id],
  );
  expect(audit.rows).toEqual([{ actor_id: a.owner, payload: { reason: 'forgotten' } }]);

  const newerRule = 'memory refused: a note is superseded by a newer note the member wrote in this transaction';
  const old = await write(a, a.owner, { body: 'Old wish' });
  expect((await refused(end(a, a.owner, old.id, 'superseded'))).message, 'no newer note').toBe(newerRule);
  const earlier = await write(a, a.owner, { body: 'A newer note, but from an earlier transaction' });
  expect(earlier.id > old.id).toBe(true);
  expect((await refused(end(a, a.owner, old.id, 'superseded'))).message, 'a newer note of an earlier transaction').toBe(newerRule);
  const othersNote = await refused(
    tx(app(), as(a, a.manager), async (c) => {
      await writeIn(c, a, { body: "The manager's newer note" });
      await c.query(`select set_config('munshi.actor_id', $1, true)`, [a.owner]);
      return c.query(END, [a.tenant, old.id, a.staff, 'superseded']);
    }),
  );
  expect(othersNote.message, "another member's newer note").toBe(newerRule);
  // An owner-only decision's note: a manager may not supersede it, even with a newer note; the owner may.
  const ownerOnly = await write(a, a.owner, { decision: ownerOnlyA, body: 'An owner-only matter' });
  const managers = await refused(supersede(a, a.manager, ownerOnly.id));
  expect([managers.code, managers.message]).toEqual(['MS007', 'memory refused: the member may not decide probe.owner_only drafts, so may not supersede a note of one']);
  await supersede(a, a.owner, ownerOnly.id, { decision: ownerOnlyA, body: 'An owner-only matter, restated' });
  await supersede(a, a.owner, old.id);
});

// valid_to = now(), set in the reading transaction itself (the superuser plants it, then becomes the role).
async function atBoundary<T>(t: Tenant, note: string, role: string, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await db.admin.connect();
  try {
    await c.query('begin');
    await c.query('set local session_replication_role = replica');
    await c.query(`update ai.memory set valid_from = now() - interval '1 day', valid_to = now() where id = $1`, [note]);
    await c.query('set local session_replication_role = origin');
    await c.query(`set local role ${role}`);
    await c.query(`select set_config('munshi.tenant_id', $1, true)`, [t.tenant]);
    return await fn(c);
  } finally {
    await c.query('rollback');
    c.release();
  }
}

it('MEM11 at valid_to a note is out of force and the purge takes its words, as it takes an expired note', async () => {
  const t = await signUp(db, 'memory-f');
  const decision = await decide(t, 'probe.approve', 'approved');
  const edge = await write(t, t.owner, { decision, body: 'Ends exactly now' });
  const expired = await write(t, t.owner, { decision, body: 'Ended yesterday' });
  for (const note of [edge, expired]) await plant(db.admin, `update ops.message_text set created_at = now() - interval '31 days' where id = $1`, [await textOf(note.id)]);
  const ids = await atBoundary(t, edge.id, 'munshi_app', async (c) => (await c.query<{ id: string }>('select id::text from ai.memory_in_force()')).rows.map((r) => r.id));
  expect(ids, 'valid_to = now() is out of force').not.toContain(edge.id);
  expect(ids, 'the other note is read in the same transaction').toContain(expired.id);
  const words = await textOf(edge.id);
  const purged = await atBoundary(t, edge.id, 'munshi_jobs', (c) => c.query('update ops.message_text set body = null, erased_at = now() where id = $1', [words]));
  expect(purged.rowCount, 'valid_to = now(): the purge takes the words').toBe(1);
  await plant(db.admin, `update ai.memory set valid_from = now() - interval '2 days', valid_to = now() - interval '1 day' where id = $1`, [expired.id]);
  expect((await purgeAs(t, await textOf(expired.id))).rowCount, 'an expired note: the purge takes the words').toBe(1);
});

it('MEM12 a note naming many parties keeps every one: twelve are accepted (up to 32), and erasing any one of them blanks its words', async () => {
  const t = await signUp(db, 'memory-many');
  const decision = await decide(t, 'probe.approve', 'approved');
  const people = await tx(app(), as(t, t.owner), async (c) => {
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) {
      const phone = `+91980007${String(i).padStart(4, '0')}`;
      ids.push((await c.query<{ id: string }>(`insert into ops.contact (tenant_id, name, phone_e164) values ($1, 'Party', $2) returning id`, [t.tenant, phone])).rows[0]?.id as string);
    }
    return ids;
  });
  const note = await write(t, t.owner, { decision, body: 'The wedding party collects together on the Sunday', about: people });
  expect((await db.admin.query('select jsonb_array_length(about) as n from ai.memory where id = $1', [note.id])).rows).toEqual([{ n: 12 }]);
  // The twelfth, past the old cap of eight, is erased: the note's words go with it.
  const last = people[11] as string;
  const blanked = await tx(app(), as(t, t.owner), async (c) => {
    await c.query(`update ops.contact set name = null, phone_e164 = null, erased_at = now(), erased_by = $2, erase_reason = 'request' where id = $1`, [last, t.owner]);
    return c.query(
      `update ops.message_text x set body = null, erased_at = now() from ai.memory n
        where n.tenant_id = x.tenant_id and n.text_id = x.id and x.erased_at is null and ai.memory_names_erased(n.tenant_id, n.about)`,
    );
  });
  expect(blanked.rowCount).toBe(1);
  expect((await db.admin.query('select body from ops.message_text where id = $1', [await textOf(note.id)])).rows).toEqual([{ body: null }]);
  // Thirty-two is the cap.
  const many = Array.from({ length: 32 }, (_, i) => `00000000-0000-7000-8000-0000000001${String(i).padStart(2, '0')}`);
  await write(t, t.owner, { decision, body: 'A note about everyone at the counter', about: many });
});
