// The messaging contract: a person's own direct command sends only a fixed template, composed by code; a
// member's or a run's own words reach a customer only as an approved draft's message. And the direct commands that may
// write a message are exactly these, each its own command's fixed update. Red-proofs: test/v2/sabotage/messaging.ts.
import { runCommand } from '@munshi/core';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openTestDb, type TestDb, tx } from '../../db.ts';
import { refused } from '../../gates/lib.ts';
import { type Shop, smallShop } from '../shop.ts';

let db: TestDb;
let app: pg.Pool;
let s: Shop;

beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  s = await smallShop(app, 'Contract');
  await db.sabotage();
});
afterAll(() => db?.close());

// One message, written as the owner under a direct command, with its text by `author`.
const send = (author: 'member' | 'template', template: string | null) =>
  tx(app, { tenant_id: s.owner.tenantId, actor_id: s.owner.memberId, command: 'reorder.place' }, async (c) => {
    const { rows } = await c.query<{ id: string; body_sha256: Buffer }>(`insert into ops.message_text (tenant_id, body, author) values ($1, 'Please send 10 more', $2) returning id, body_sha256`, [
      s.owner.tenantId,
      author,
    ]);
    const t = rows[0] as { id: string; body_sha256: Buffer };
    return c.query(
      `insert into books.outbound_message (tenant_id, channel, recipient_kind, recipient_id, template_code, text_id, body_sha256) values ($1, 'whatsapp', 'supplier', $2, $3, $4, $5)`,
      [s.owner.tenantId, s.supplier, template, t.id, t.body_sha256],
    );
  });

it('a direct command sends only a fixed template: a member’s own words, or a template code over them, are refused (MS002)', async () => {
  expect((await refused(send('member', null))).code).toBe('MS002');
  expect((await refused(send('member', 'reorder'))).code).toBe('MS002');
  expect((await refused(send('template', null))).code).toBe('MS002');
  await send('template', 'reorder');
  // And through core, the reorder's update is its template.
  await runCommand(app, s.manager, 'reorder.place', { supplierId: s.supplier, lines: [{ itemId: s.biscuits, qtyMilli: 12_000 }] });
});

it('the direct commands that may write a message are exactly the fixed updates: a reorder, a booking, an order’s steps and its delivery', async () => {
  const { rows } = await db.admin.query<{ command: string }>(
    `select t.command from ref.command_table t join ref.command c on c.command = t.command where t.rel = 'books.outbound_message' and not c.draft_only order by 1`,
  );
  expect(rows.map((r) => r.command)).toEqual(['booking.confirm', 'order.cancel', 'order.confirm', 'order.reschedule', 'order.step', 'reorder.place', 'sale.record']);
});
