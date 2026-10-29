// W7, the send-time recheck (packages/core/src/outbox.ts): what changed between a campaign's approval and its send can
// only stop a delivery. A STOP, an erased contact, a withdrawn consent or a customer re-linked to a new phone ends it
// `blocked`; a deadline passed ends it `expired`; an erased address freezes it unsent. Only the untouched one is sent.
// Red-proofs: test/v2/sabotage/core-messaging.ts.
import { createCampaign, createJobsPool, decide, proposeCampaign, runDueJobs, writeCopy } from '@munshi/core';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb, tx } from '../../db.ts';
import { plant } from '../../gates/lib.ts';
import { jobsUrl } from '../jobs/lib.ts';
import { type Shop, smallShop } from '../shop.ts';
import { buys, consent, customer, grant, inbound, listed, newPhone, type Person, wireRecorded } from './lib.ts';

let db: TestDb;
let app: pg.Pool;
let pub: pg.Pool;
let jobs: pg.Pool;
let s: Shop;

beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  pub = db.as('munshi_public');
  jobs = createJobsPool(jobsUrl(db), 4);
  s = await smallShop(app, 'Recheck');
  await grant(db, s.owner.tenantId, 'whatsapp');
  await db.sabotage();
});
afterAll(async () => {
  await jobs?.end();
  await db?.close();
});

const owner = () => ({ tenant_id: s.owner.tenantId, actor_id: s.owner.memberId });

it('W7 a STOP, an erasure, a withdrawal or a re-link between approval and send ends the delivery blocked, a passed deadline expired, an erased address frozen; only the untouched one is sent', async () => {
  const names = ['untouched', 'stops', 'erased', 'withdrew', 'relinked', 'late', 'frozen'] as const;
  const p = {} as Record<(typeof names)[number], Person>;
  for (const n of names) {
    p[n] = await customer(app, s.owner);
    await buys(app, s, p[n]);
    await consent(app, s.owner, p[n], true);
  }
  await listed(app, s.owner, p.stops);
  const campaign = await createCampaign(app, s.owner, { name: 'Recheck', channel: 'whatsapp', segment: 'bought_within_days', segmentDays: 30 });
  await writeCopy(app, { session: s.owner }, campaign, 'Naya stock aa gaya hai.');
  expect((await decide(app, s.owner, await proposeCampaign(app, s.owner, campaign), 'approved')).status).toBe('executed');
  const delivery = async (who: Person) =>
    (
      await db.admin.query<{ id: string; status: string }>(
        'select d.id, d.status from ops.delivery d join books.outbound_message m on m.tenant_id = d.tenant_id and m.id = d.message_id where m.campaign_id = $1 and m.recipient_id = $2',
        [campaign, who.customer],
      )
    ).rows[0] as { id: string; status: string };
  for (const n of names) expect((await delivery(p[n])).status, n).toBe('queued');

  // Between approval and send:
  expect(await inbound(pub, p.stops.phone.slice(1), 'stop')).not.toBeNull();
  await tx(app, owner(), (c) =>
    c.query(`update ops.contact set name = null, phone_e164 = null, erased_at = now(), erased_by = $2, erase_reason = 'request' where id = $1`, [
      p.erased.contact,
      s.owner.memberId,
    ]),
  );
  await consent(app, s.owner, p.withdrew, false);
  await tx(app, { ...owner(), command: 'contact.link' }, async (c) => {
    const k = (await c.query<{ id: string }>(`insert into ops.contact (tenant_id, name, phone_e164) values ($1, 'Synthetic customer', $2) returning id`, [s.owner.tenantId, newPhone()]))
      .rows[0]?.id;
    await c.query('insert into books.party_contact (tenant_id, customer_id, contact_id, effective_from) values ($1, $2, $3, now())', [s.owner.tenantId, p.relinked.customer, k]);
  });
  await plant(db.admin, `update ops.delivery set not_after = now() - interval '1 minute' where id = $1`, [(await delivery(p.late)).id]);
  const frozen = (await delivery(p.frozen)).id;
  await tx(app, owner(), (c) => c.query('update ops.delivery set to_address = null, erased_at = now() where id = $1', [frozen]));

  const outbox = wireRecorded();
  try {
    const runs = await runDueJobs(jobs, new Date(), ['outbox']);
    expect(runs.map((r) => [r.outcome, r.removed])).toEqual([['ok', { sent: 1, blocked: 4, expired: 1 }]]);
    const statuses = Object.fromEntries(await Promise.all(names.map(async (n) => [n, (await delivery(p[n])).status])));
    expect(statuses).toEqual({ untouched: 'sent', stops: 'blocked', erased: 'blocked', withdrew: 'blocked', relinked: 'blocked', late: 'expired', frozen: 'queued' });
    expect(outbox.calls.map((m) => m.to)).toEqual([p.untouched.phone]);
    // The frozen one is never taken again.
    await runDueJobs(jobs, new Date(Date.now() + 60_000), ['outbox']);
    expect([(await delivery(p.frozen)).status, outbox.calls.length]).toEqual(['queued', 1]);
  } finally {
    outbox.close();
  }
});
