// The inbox through core (packages/core/src/inbox.ts): a message lands in ops.inbound_message only through a number a
// shop listed (W4), once however often Meta retries it (W2), its `from` normalised so STOP and erasure match the contact
// (W8); a stop word is an opt-out, which drops the customer from the next audience and is handled only beside its
// withdrawal (STOP); a provider's statuses move the delivery forward. EX2 end to end: the figures of a text message or
// a voice note's transcript are read by core from the spans pointed at, and the database re-reads every digit span;
// a span neither can read fills nothing. Red-proofs: test/v2/sabotage/core-messaging.ts.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  addDays,
  businessDate,
  type CoreError,
  createCampaign,
  createJobsPool,
  DIGIT_ZEROS,
  decide,
  handleInbound,
  mintSnapshot,
  proposeDraft,
  receiveInbound,
  recordExtracts,
  recordProviderStatus,
  runCommand,
  runDueJobs,
  saveTranscript,
  writeReply,
} from '@munshi/core';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb, tx } from '../../db.ts';
import { sabotageIs } from '../../sabotage/index.ts';
import { jobsUrl } from '../jobs/lib.ts';
import { type Shop, smallShop } from '../shop.ts';
import { bookCounts, buys, consent, customer, grant, inbound, listed, newPhone, type Person, ROUTE_KEY, wireRecorded } from './lib.ts';

let db: TestDb;
let app: pg.Pool;
let pub: pg.Pool;
let jobs: pg.Pool;
let s: Shop;
let t: Shop; // a second shop: each grant lists at most five recipients

beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  pub = db.as('munshi_public');
  jobs = createJobsPool(jobsUrl(db), 4);
  s = await smallShop(app, 'Inbox');
  t = await smallShop(app, 'Inbox T');
  await grant(db, s.owner.tenantId, 'whatsapp');
  await grant(db, t.owner.tenantId, 'whatsapp');
  await db.sabotage();
});
afterAll(async () => {
  await jobs?.end();
  await db?.close();
});

// Slots are named by the minute: each sweep here gets a minute of its own.
let minute = 0;
const sweep = () => runDueJobs(jobs, new Date(Date.UTC(2031, 2, 1, 0, ++minute)), ['outbox']);
const rows = async <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) => (await db.admin.query<T>(sql, params)).rows;
const inboxCount = async () => (await rows<{ n: number }>('select count(*)::int as n from ops.inbound_message'))[0]?.n as number;
const routedCustomer = async (shop: Shop = s) => {
  const p = await customer(app, shop.owner);
  await listed(app, shop.owner, p);
  return p;
};

it('W2 W4 W8 a message is stored only through a listed number, once per provider id, its sender as the contact’s own E.164', async () => {
  const p = await routedCustomer();
  const before = await inboxCount();
  expect(await inbound(pub, newPhone().slice(1), 'Hello?'), 'a stranger').toBeNull();
  expect(await inboxCount()).toBe(before);
  const providerMessageId = `wamid.${randomUUID()}`;
  const first = await receiveInbound(pub, ROUTE_KEY, { providerMessageId, from: p.phone.slice(1), kind: 'text', text: 'Atta hai?' });
  const again = await receiveInbound(pub, ROUTE_KEY, { providerMessageId, from: p.phone.slice(1), kind: 'text', text: 'Atta hai?' });
  expect([typeof first, again]).toEqual(['string', null]);
  expect(await rows('select from_address, status, opt_out from ops.inbound_message where id = $1', [first])).toEqual([
    { from_address: p.phone, status: 'new', opt_out: false },
  ]);
  expect(await inboxCount()).toBe(before + 1);
});

it('STOP every stop word is an opt-out, a mention of one is not; an opt-out drops its customer from the next audience at once', async () => {
  const words = ['UNSUBSCRIBE', 'band karo', 'बंद करो', '  Stop. ', 'STOP'];
  const flags: boolean[] = [];
  const people: Person[] = [];
  for (const w of words.slice(0, 3)) {
    const p = await routedCustomer();
    await buys(app, s, p);
    await consent(app, s.owner, p, true);
    people.push(p);
    const id = await inbound(pub, p.phone.slice(1), w);
    flags.push((await rows<{ opt_out: boolean }>('select opt_out from ops.inbound_message where id = $1', [id]))[0]?.opt_out as boolean);
  }
  for (const w of [...words.slice(3), 'Please stop the delivery tomorrow']) {
    const id = await inbound(pub, (people[0] as Person).phone.slice(1), w);
    flags.push((await rows<{ opt_out: boolean }>('select opt_out from ops.inbound_message where id = $1', [id]))[0]?.opt_out as boolean);
  }
  expect(flags).toEqual([true, true, true, true, true, false]);
  const campaign = await createCampaign(app, s.owner, { name: 'After STOP', channel: 'whatsapp', segment: 'bought_within_days', segmentDays: 30 });
  const audience = (await mintSnapshot(app, { kind: 'member', session: s.owner }, 'campaign.audience', { campaign_id: campaign })).rows.map(
    (r) => (r.customer_id as { txt: string }).txt,
  );
  for (const p of people) expect(audience).not.toContain(p.customer);
});

it('STOP an opt-out is handled only by the withdrawal naming it, from the same contact, in one transaction', async () => {
  const p = await routedCustomer();
  const stop = (await inbound(pub, p.phone.slice(1), 'STOP')) as string;
  for (const status of ['handled', 'ignored'] as const) {
    const e = (await handleInbound(app, s.manager, stop, status).catch((err) => err)) as CoreError;
    expect([e.code, e.sqlstate], status).toEqual(['refused', 'MS007']);
  }
  const other = await customer(app, s.owner);
  const wrong = (await consent(app, s.owner, other, false, 'marketing', stop).catch((err) => err)) as CoreError;
  expect([wrong.code, wrong.fields]).toEqual(['invalid', ['evidenceMessageId']]);
  await consent(app, s.staff, p, false, 'marketing', stop); // staff may record a withdrawal
  expect(await rows('select status, handled_by::text from ops.inbound_message where id = $1', [stop])).toEqual([{ status: 'handled', handled_by: s.staff.memberId }]);
  expect(
    await rows(`select granted, source, evidence_rel, evidence_id::text from books.customer_consent where customer_id = $1 order by created_at desc limit 1`, [p.customer]),
  ).toEqual([{ granted: false, source: 'whatsapp_reply', evidence_rel: 'ops.inbound_message', evidence_id: stop }]);
  // An ordinary message is handled by a member as an ops change.
  const plain = (await inbound(pub, p.phone.slice(1), 'Shukriya')) as string;
  await handleInbound(app, s.staff, plain, 'ignored');
  expect((await rows<{ status: string }>('select status from ops.inbound_message where id = $1', [plain]))[0]?.status).toBe('ignored');
});

it('a provider’s statuses move a sent delivery forward and never back', async () => {
  const p = await routedCustomer(t);
  // A reply to their message, approved, sent through the recorded sender (which still returns a provider id).
  const msg = (await inbound(pub, p.phone.slice(1), 'Kitna baaki hai?')) as string;
  const extract = await mintSnapshot(app, { kind: 'member', session: t.owner }, 'inbox.extract', { message_id: msg });
  const text = await writeReply(app, { session: t.owner }, 'Abhi dekh ke batate hain.');
  const sha = (await rows<{ sha: string }>(`select encode(body_sha256, 'hex') as sha from ops.message_text where id = $1`, [text]))[0]?.sha;
  const draft = await proposeDraft(app, { session: t.owner }, {
    command: 'message.reply',
    payload: { messageId: msg, customerId: p.customer, textId: text, textSha256: sha },
    basedOn: [{ snapshotId: extract.id, row: 0, col: '_count' }],
  });
  await decide(app, t.owner, draft, 'approved');
  const outbox = wireRecorded();
  await sweep();
  outbox.close();
  const [d] = await rows<{ id: string; provider_message_id: string }>(
    'select d.id, d.provider_message_id from ops.delivery d join books.outbound_message m on m.id = d.message_id where m.reply_to_id = $1',
    [msg],
  );
  const status = (st: 'delivered' | 'read' | 'failed') =>
    recordProviderStatus(pub, ROUTE_KEY, { providerMessageId: d?.provider_message_id as string, status: st, recipient: p.phone.slice(1), errorCode: null });
  expect([await status('delivered'), await status('read'), await status('delivered')]).toEqual([true, true, false]);
  expect((await rows<{ status: string }>('select status from ops.delivery where id = $1', [d?.id]))[0]?.status).toBe('read');
});

it('W3 the webhook’s core path writes no book row: the books are unchanged across text, audio, a STOP, a replay, a stranger and statuses', async () => {
  const p = await routedCustomer(t);
  // A delivery sent before the run, for the statuses to name: a reorder to a supplier, through the recorded sender.
  const supplier = ((await runCommand(app, t.owner, 'supplier.create', { name: 'Webhook Traders (simulated)', phone: newPhone() })) as Record<string, string>).supplierId;
  const message = ((await runCommand(app, t.manager, 'reorder.place', { supplierId: supplier, lines: [{ itemId: t.biscuits, qtyMilli: 1000 }] })) as Record<string, string>)
    .messageId;
  const outbox = wireRecorded();
  await sweep();
  outbox.close();
  const [sent] = await rows<{ provider_message_id: string }>('select provider_message_id from ops.delivery where message_id = $1', [message]);
  expect(sent?.provider_message_id).toMatch(/^recorded:/);
  const before = await bookCounts(db);
  expect(Object.keys(before).length).toBeGreaterThan(0);
  const stored = await inboxCount();
  const replayed = `wamid.${randomUUID()}`;
  for (const m of [
    { providerMessageId: `wamid.${randomUUID()}`, from: p.phone.slice(1), kind: 'text' as const, text: 'Doodh hai?' },
    { providerMessageId: `wamid.${randomUUID()}`, from: p.phone.slice(1), kind: 'audio' as const, text: null },
    { providerMessageId: `wamid.${randomUUID()}`, from: p.phone.slice(1), kind: 'text' as const, text: 'STOP' },
    { providerMessageId: replayed, from: p.phone.slice(1), kind: 'image' as const, text: 'Yeh wala' },
    { providerMessageId: replayed, from: p.phone.slice(1), kind: 'image' as const, text: 'Yeh wala' },
    { providerMessageId: `wamid.${randomUUID()}`, from: newPhone().slice(1), kind: 'text' as const, text: 'A stranger' },
  ]) {
    await receiveInbound(pub, ROUTE_KEY, m);
  }
  for (const status of ['delivered', 'read', 'failed'] as const) {
    await recordProviderStatus(pub, ROUTE_KEY, { providerMessageId: sent?.provider_message_id as string, status, recipient: p.phone.slice(1), errorCode: null });
  }
  await recordProviderStatus(pub, ROUTE_KEY, { providerMessageId: 'wamid.unknown', status: 'delivered', recipient: p.phone.slice(1), errorCode: null });
  if (sabotageIs('v2-f3a-w3-books')) await runCommand(app, t.owner, 'customer.create', { name: 'A book row planted mid-test' });
  expect(await inboxCount()).toBe(stored + 4);
  expect(await bookCounts(db)).toEqual(before);
});

// What the webhook route imports from core: inbox.ts, followed through every relative import. It may set a tenant's
// context (session.ts) to store with no actor; it may not reach a command runner (commands*.ts, approvals.ts, whose
// decide() runs them), the app pool, core's entry point, or any @munshi value.
const SRC = path.join(import.meta.dirname, '..', '..', '..', '..', '..', 'packages', 'core', 'src');
const FORBIDDEN = /^(commands(-[a-z]+)?|approvals|pool|index)\.ts$/;
const valueImports = (text: string) =>
  [
    /\bimport\s+(type\s+)?(?:[\w*{}\s,$]+?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bexport\s+(type\s+)?(?:\*|\{[^}]*\})\s*(?:as\s+\w+\s+)?from\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*()['"]([^'"]+)['"]\s*\)/g,
  ].flatMap((re) => [...text.matchAll(re)].filter((m) => !m[1]).map((m) => m[2] as string));

it('W3 inbox.ts, which the webhook imports, reaches no command runner, no app pool and no @munshi value, directly or through another file', () => {
  const violations: string[] = [];
  const seen = new Set<string>();
  for (const queue = ['inbox.ts']; queue.length; ) {
    const file = queue.shift() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    let text = readFileSync(path.join(SRC, file), 'utf8');
    if (sabotageIs('v2-f3a-w3-scan') && file === 'inbox.ts') text = `import { runCommand } from './commands.ts';\n${text}`;
    if (/\bimport\s*\(\s*(?!['"])|\brequire\s*\(/.test(text)) violations.push(`${file}: a computed import or a require`);
    for (const spec of valueImports(text)) {
      if (spec.startsWith('@munshi/')) violations.push(`${file}: imports ${spec}`);
      if (!spec.startsWith('.')) continue;
      const target = path.relative(SRC, path.join(SRC, path.dirname(file), spec));
      if (target.startsWith('..') || target.includes(path.sep) || FORBIDDEN.test(target)) violations.push(`${file}: imports ${spec}`);
      else queue.push(target);
    }
  }
  expect([...seen]).toEqual(expect.arrayContaining(['inbox.ts', 'session.ts', 'numbers.ts']));
  expect(violations).toEqual([]);
});

it('EX2 a text message’s figures are read by core from their spans and re-read by the database; what neither can read fills nothing', async () => {
  const p = await routedCustomer(t);
  const body = 'Bhaiya ₹1,500 bhej diye, Rs. 250.50 baaki. 3 packet chahiye, ५०० wala bhi, paanch sau ka. Kal aaunga.';
  const msg = (await inbound(pub, p.phone.slice(1), body)) as string;
  const at = (s: string) => {
    const i = [...body].join('').indexOf(s);
    const start = [...body.slice(0, i)].length;
    return { start, end: start + [...s].length };
  };
  const runId = randomUUID();
  await tx(app, { tenant_id: t.owner.tenantId, actor_id: t.manager.memberId }, (c) =>
    c.query(`insert into ai.run (tenant_id, id, trigger, desk) values ($1, $2, 'inbox', 'customers')`, [t.owner.tenantId, runId]),
  );
  const out = await recordExtracts(app, { session: t.manager, runId }, msg, [
    { field: 'amount', ...at('₹1,500') },
    { field: 'amount', ...at('Rs. 250.50') },
    { field: 'quantity', ...at('3') },
    { field: 'amount', ...at('५००') },
    { field: 'amount', ...at('paanch sau') },
    { field: 'date', ...at('Kal') },
    { field: 'amount', ...at('packet') },
  ]);
  expect(out.map((o) => ('refusal' in o ? o.refusal : 'filled'))).toEqual(['filled', 'filled', 'filled', 'filled', 'filled', 'filled', 'unreadable']);
  const tomorrow = addDays(businessDate(new Date(), 'Asia/Kolkata'), 1);
  const stored = await rows<{ field: string; num: string | null; day: string | null; parsed_as: string; span: string }>(
    `select e.field, e.num::text, e.day::text, e.parsed_as, substr(i.text, e.span_start + 1, e.span_end - e.span_start) as span
       from ops.inbound_extract e join ops.inbound_message i on i.id = e.message_id where e.message_id = $1 order by e.span_start`,
    [msg],
  );
  expect(stored).toEqual([
    { field: 'amount', num: '150000', day: null, parsed_as: 'digits', span: '1,500' },
    { field: 'amount', num: '25050', day: null, parsed_as: 'digits', span: '250.50' },
    { field: 'quantity', num: '3000', day: null, parsed_as: 'digits', span: '3' },
    { field: 'amount', num: '50000', day: null, parsed_as: 'digits', span: '५००' },
    { field: 'amount', num: '50000', day: null, parsed_as: 'words', span: 'paanch sau' },
    { field: 'date', num: null, day: tomorrow, parsed_as: 'words', span: 'Kal' },
  ]);
  const cells = (await mintSnapshot(app, { kind: 'member', session: t.manager }, 'inbox.extract', { message_id: msg })).rows;
  expect(cells.map((r) => [r.field, r.amount, r.quantity, r.day])).toEqual([
    [{ kind: 'text', txt: 'amount' }, { kind: 'money', num: '150000', currency: 'INR' }, { kind: 'null' }, { kind: 'null' }],
    [{ kind: 'text', txt: 'amount' }, { kind: 'money', num: '25050', currency: 'INR' }, { kind: 'null' }, { kind: 'null' }],
    [{ kind: 'text', txt: 'quantity' }, { kind: 'null' }, { kind: 'integer', num: '3' }, { kind: 'null' }],
    [{ kind: 'text', txt: 'amount' }, { kind: 'money', num: '50000', currency: 'INR' }, { kind: 'null' }, { kind: 'null' }],
    [{ kind: 'text', txt: 'amount' }, { kind: 'money', num: '50000', currency: 'INR' }, { kind: 'null' }, { kind: 'null' }],
    [{ kind: 'text', txt: 'date' }, { kind: 'null' }, { kind: 'null' }, { kind: 'date', day: tomorrow }],
  ]);
});

it('EX2 a voice note’s transcript, stored once, is read the same way; a digit script the database does not re-read fills nothing, never a wrong figure', async () => {
  const p = await routedCustomer(t);
  const note = (await receiveInbound(pub, ROUTE_KEY, { providerMessageId: `wamid.${randomUUID()}`, from: p.phone.slice(1), kind: 'audio', text: null })) as string;
  const runId = randomUUID();
  await tx(app, { tenant_id: t.owner.tenantId, actor_id: t.owner.memberId }, (c) =>
    c.query(`insert into ai.run (tenant_id, id, trigger, desk) values ($1, $2, 'inbox', 'customers')`, [t.owner.tenantId, runId]),
  );
  // One amount per digit script core reads: 750 in each.
  const figures = DIGIT_ZEROS.map((z) => String.fromCodePoint(z + 7, z + 5, z));
  const transcript = figures.map((f) => `${f} rupaye`).join(', ');
  await saveTranscript(app, t.owner, note, transcript);
  const again = (await saveTranscript(app, t.owner, note, 'another').catch((err) => err)) as CoreError;
  expect([again.code, again.sqlstate]).toEqual(['refused', 'MS011']);
  const spans = figures.map((f) => {
    const start = [...transcript.slice(0, transcript.indexOf(f))].length;
    return { field: 'amount' as const, start, end: start + [...f].length + ' rupaye'.length };
  });
  const out = await recordExtracts(app, { session: t.owner, runId }, note, spans);
  const filled = out.flatMap((o, i) => ('extractId' in o ? [figures[i]] : []));
  const notReread = out.flatMap((o, i) => ('refusal' in o && o.refusal === 'not_reread' ? [(DIGIT_ZEROS[i] as number).toString(16)] : []));
  console.log(`EX2 ${filled.length} of ${figures.length} digit scripts filled; not re-read by the database: ${notReread.join(', ') || 'none'}`);
  expect(filled.length + notReread.length).toBe(figures.length); // core read every one; nothing else refused
  expect(filled.length).toBeGreaterThanOrEqual(12);
  const nums = await rows<{ num: string }>('select num::text from ops.inbound_extract where message_id = $1', [note]);
  expect(nums.map((r) => r.num)).toEqual(filled.map(() => '75000'));
});
