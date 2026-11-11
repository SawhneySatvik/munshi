// The demo build's seed (db/src/dev.ts's reseed, which `pnpm dev` and the hosted seed run) lands the PayPal order walk
// on the kirana as it provisions it (through the owner connection, not sign-up): Kavya R.'s message became an order whose
// PayPal link was approved, made in recorded mode, messaged on its own approval and reported paid, with no book row for
// the payment; and Irfan M.'s fresh message waits in the inbox for "Draft order". Never a mocked database.
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { PAYPAL_ORDER_DEMO } from '../../../../seed/kirana-paypal-order.ts';
import { reseed } from '../../../../src/dev.ts';
import { openTestDb, type TestDb } from '../../db.ts';
import { SECRETS } from '../platform/fixture.ts';

let db: TestDb;
let owner: pg.Client;
let dir: string;
let tenantId: string;

beforeAll(async () => {
  db = await openTestDb();
  owner = await db.migrator();
  dir = mkdtempSync(path.join(tmpdir(), 'munshi-paypal-seed-'));
  const r = await reseed(db.as('munshi_app'), db.as('munshi_jobs'), { pub: db.as('munshi_public'), platform: db.as('munshi_platform'), owner }, {
    ...SECRETS,
    out: path.join(dir, 'dev-operator.json'),
    displayName: 'Dev operator',
  });
  tenantId = r.tenantId;
  await db.sabotage();
}, 600_000);
afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await owner?.end();
  await db?.close();
});

it('the demo build seeds the PayPal order walk on the kirana: a paid order link not yet in the books, and a fresh message for the agent', async () => {
  const q = async (sql: string, values: unknown[] = []) => (await db.admin.query(sql, [tenantId, ...values])).rows;
  const [walk] = await q(
    `select l.purpose, l.status, l.mode, o.code is not null as ordered,
            (select count(*)::int from ops.payment_event e where e.tenant_id = l.tenant_id and e.link_id = l.id) as notices,
            (select count(*)::int from books.payment p where p.tenant_id = l.tenant_id and p.reference = l.paypal_id) as recorded,
            (select count(*)::int from books.outbound_message m where m.tenant_id = l.tenant_id and m.template_code = 'paypal_link' and m.recipient_id = l.customer_id) as messaged
       from ops.paypal_link l join books.order o on o.tenant_id = l.tenant_id and o.id = l.order_id
      where l.tenant_id = $1`,
  );
  expect(walk).toEqual({ purpose: 'order', status: 'sent', mode: 'recorded', ordered: true, notices: 1, recorded: 0, messaged: 1 });
  const fresh = await q(
    `select m.status, (select count(*)::int from ops.order_request r where r.tenant_id = m.tenant_id and r.inbound_message_id = m.id) as requests
       from ops.inbound_message m where m.tenant_id = $1 and m.text = $2`,
    [PAYPAL_ORDER_DEMO.freshText],
  );
  expect(fresh).toEqual([{ status: 'new', requests: 0 }]);
});
