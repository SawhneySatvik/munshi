// The outbox sweep (packages/core/src/outbox.ts, run as the jobs role by jobs-messaging.ts): a delivery is sent at most
// once however many sweeps run at once (W6); the recorded sender writes ids and a hash, never a phone or words; with no
// senders wired the sweep touches nothing; a recorded delivery is never handed to a real adapter, even one wired beside
// it (W8); and a test send reaches the member's own phone and writes no book row. Red-proofs:
// test/v2/sabotage/core-messaging.ts.
import { createHash } from 'node:crypto';
import { addMember, createJobsPool, runCommand, runDueJobs, sendTest, writeCopy, createCampaign, wireChannels } from '@munshi/core';
import type pg from 'pg';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb } from '../../db.ts';
import { sabotageIs } from '../../sabotage/index.ts';
import { jobsUrl } from '../jobs/lib.ts';
import { type Shop, sessionOf, smallShop } from '../shop.ts';
import { bookCounts, deliveryOf, newPhone, type Outbox, raceForClaim, spySender, wireRecorded } from './lib.ts';

let db: TestDb;
let app: pg.Pool;
let jobs: pg.Pool;
let s: Shop;
let supplier: string;
let outbox: Outbox | undefined;

beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  jobs = createJobsPool(jobsUrl(db), 6);
  s = await smallShop(app, 'Outbox');
  supplier = ((await runCommand(app, s.owner, 'supplier.create', { name: 'Phone Traders (simulated)', phone: newPhone() })) as Record<string, string>)
    .supplierId as string;
  await db.sabotage();
});
afterEach(() => {
  outbox?.close();
  outbox = undefined;
});
afterAll(async () => {
  await jobs?.end();
  await db?.close();
});

const reorder = async () =>
  ((await runCommand(app, s.manager, 'reorder.place', { supplierId: supplier, lines: [{ itemId: s.biscuits, qtyMilli: 12_000 }] })) as Record<string, string>)
    .messageId as string;
// Slots are named by the minute: each sweep here gets a minute of its own, so the job claim never stops a second one.
let minute = 0;
const sweep = () => runDueJobs(jobs, new Date(Date.UTC(2031, 0, 1, 0, ++minute)), ['outbox']);

it('two sweeps at once send a delivery once: the second waits on the first’s claim, then finds it taken', async () => {
  const message = await reorder();
  outbox = wireRecorded();
  // Both sweeps select the delivery as queued and wait on its row; let go together, one claims it and the other finds
  // it taken.
  const runs = (await raceForClaim(db, (await deliveryOf(db, message)).id, () => [sweep(), sweep()])).flat();
  const d = await deliveryOf(db, message);
  expect(outbox.calls.map((m) => m.deliveryId)).toEqual([d.id]);
  expect(outbox.sent().filter((l) => l.delivery_id === d.id)).toHaveLength(1);
  expect(d).toMatchObject({ status: 'sent', mode: 'recorded', attempts: 1, provider_message_id: `recorded:${d.id}` });
  expect(runs.map((r) => JSON.stringify([r.outcome, r.removed])).sort()).toEqual(['["ok",{"sent":1}]', '["ok",{}]']);
});

it('the recorded sender writes ids, the channel and the body’s sha256: no phone and no words', async () => {
  const message = await reorder();
  outbox = wireRecorded();
  await sweep();
  const d = await deliveryOf(db, message);
  const { rows } = await db.admin.query<{ body: string }>(
    'select t.body from books.outbound_message m join ops.message_text t on t.tenant_id = m.tenant_id and t.id = m.text_id where m.id = $1',
    [message],
  );
  const line = outbox.sent().find((l) => l.delivery_id === d.id) as Record<string, string>;
  expect(Object.keys(line).sort()).toEqual(['at', 'body_sha256', 'channel', 'delivery_id', 'tenant_id']);
  expect(line.body_sha256).toBe(createHash('sha256').update(rows[0]?.body as string).digest('hex'));
  expect(JSON.stringify(outbox.sent())).not.toContain(d.to_address);
  expect(outbox.calls[0]?.body).toBe(rows[0]?.body); // the sender itself was handed the words
});

it('with no senders wired the sweep sends nothing and finishes ok; the delivery stays queued', async () => {
  wireChannels(null);
  const message = await reorder();
  const runs = await sweep();
  expect(runs.map((r) => [r.job, r.outcome, r.removed])).toEqual([['outbox', 'ok', {}]]);
  expect((await deliveryOf(db, message)).status).toBe('queued');
  outbox = wireRecorded();
  await sweep(); // leave nothing queued for the next test
});

it('a recorded delivery is handed only to the recorded sender, even with a WhatsApp adapter wired beside it', async () => {
  const whatsapp = spySender();
  outbox = wireRecorded({ whatsapp });
  const message = await reorder();
  await sweep();
  const d = await deliveryOf(db, message);
  expect(whatsapp.calls).toEqual([]);
  expect(outbox.calls.map((m) => m.deliveryId)).toEqual([d.id]);
  expect(d).toMatchObject({ status: 'sent', mode: 'recorded' });
});

it('a test send reaches the member’s own phone through the outbox and writes no book row', async () => {
  const phone = newPhone();
  const manager = await sessionOf(app, s.owner.tenantId, await addMember(app, s.owner, { name: 'Manager with a phone', role: 'manager', phone }));
  const campaign = await createCampaign(app, manager, { name: 'Weekend', channel: 'whatsapp', segment: 'bought_within_days', segmentDays: 30 });
  await writeCopy(app, { session: manager }, campaign, 'Aao, naye biscuit aaye hain!');
  outbox = wireRecorded();
  const before = await bookCounts(db);
  expect(Object.keys(before).length).toBeGreaterThan(0);
  const test = await sendTest(app, manager, campaign);
  await sweep();
  if (sabotageIs('v2-msg-test-send-book')) await runCommand(app, s.owner, 'customer.create', { name: 'A book row planted mid-test' });
  expect(await bookCounts(db)).toEqual(before);
  expect(await deliveryOf(db, test)).toMatchObject({ status: 'sent', mode: 'recorded', to_address: phone });
  expect(outbox.calls.map((m) => [m.deliveryId, m.to, m.body])).toEqual([[test, phone, 'Aao, naye biscuit aaye hain!']]);
});
