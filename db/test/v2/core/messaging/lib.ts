// Shared by the messaging tests (test/v2/core/messaging/): customers with phones made by core's own commands, consent,
// a sale to put a customer in a segment, a WhatsApp grant planted as the superadmin would leave it, recipients listed
// with their routes, and the recorded sender wired into a temp folder whose lines the tests count. Senders are the
// system boundary: a test may wrap one (to count calls or hold a send open), never the database.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { listTestRecipient, receiveInbound, runCommand, type Session, wireChannels } from '@munshi/core';
import type pg from 'pg';
import type { Channels, Outbound, Sender } from '../../../../../packages/adapters/channels/index.ts';
import { recordedSender } from '../../../../../packages/adapters/channels/index.ts';
import type { TestDb } from '../../db.ts';
import { plant } from '../../gates/lib.ts';
import type { Shop } from '../shop.ts';

export const ROUTE_KEY = randomBytes(32);

let phones = 0;
// A fresh synthetic number per call, unique across the test files that run at once.
export const newPhone = () => `+9198${String(Math.floor(Math.random() * 9000) + 1000)}${String(++phones).padStart(4, '0')}`;

export type Person = { customer: string; contact: string; phone: string };

export async function customer(app: pg.Pool, s: Session, phone = newPhone()): Promise<Person> {
  const r = (await runCommand(app, s, 'customer.create', { name: 'Synthetic customer', phone })) as Record<string, string>;
  return { customer: r.customerId as string, contact: r.contactId as string, phone };
}

export const consent = (app: pg.Pool, s: Session, p: Person, granted: boolean, purpose: 'marketing' | 'service' = 'marketing', evidenceMessageId?: string) =>
  runCommand(app, s, 'consent.record', {
    customerId: p.customer,
    purpose,
    granted,
    source: evidenceMessageId ? 'whatsapp_reply' : 'in_person',
    ...(granted ? { noticeVersion: 'v1' } : {}),
    ...(evidenceMessageId ? { evidenceMessageId } : {}),
  });

// One counter sale for the customer today: they "bought within the last N days".
export const buys = (app: pg.Pool, shop: Shop, p: Person) =>
  runCommand(app, shop.staff, 'sale.record', {
    shopId: shop.shopId,
    customerId: p.customer,
    lines: [{ itemId: shop.biscuits, qtyMilli: 1000 }],
    payments: [{ method: 'cash', amountMinor: 1000 }],
  });

// The superadmin's WhatsApp grant (a platform change in the console; planted here past its triggers).
export const grant = (db: TestDb, tenantId: string, channel: 'whatsapp' | 'instagram', granted = true, accountRef: string | null = null) =>
  plant(
    db.admin,
    `insert into platform.channel_grant (tenant_id, channel, granted, max_test_recipients, account_ref, change_id, effective_from)
     values ($1, $2, $3, $4, $5, $6, clock_timestamp())`,
    [tenantId, channel, granted, channel === 'whatsapp' ? 5 : 0, accountRef, randomUUID()],
  );

export const listed = (app: pg.Pool, owner: Session, p: Person) => listTestRecipient(app, owner, { contactId: p.contact }, ROUTE_KEY);

// A WhatsApp message from a number, through the webhook's core path.
export const inbound = (pub: pg.Pool, from: string, text: string) =>
  receiveInbound(pub, ROUTE_KEY, { providerMessageId: `wamid.${randomUUID()}`, from, kind: 'text', text });

// The recorded sender in a temp folder, wired as the deploy wires it. `wrap` sees each send first.
export type Outbox = { dir: string; calls: Outbound[]; sent: () => { delivery_id: string; body_sha256: string; channel: string }[]; close: () => void };
export function wireRecorded(extra: Omit<Channels, 'recorded'> = {}, wrap?: (m: Outbound) => Promise<void>): Outbox {
  const dir = mkdtempSync(path.join(tmpdir(), 'munshi-outbox-'));
  const calls: Outbound[] = [];
  const recorded = recordedSender(dir);
  const watched: Sender = async (m) => {
    calls.push(m);
    await wrap?.(m);
    return recorded(m);
  };
  wireChannels({ recorded: watched, ...extra });
  return {
    dir,
    calls,
    sent: () => {
      try {
        return readFileSync(path.join(dir, 'sent.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
      } catch {
        return [];
      }
    },
    close: () => {
      wireChannels(null);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

// A real sender's stand-in at the boundary: it records each call and answers as the provider would.
export function spySender(answer: (m: Outbound) => { ok: true; providerMessageId: string } | { ok: false; errorCode: string | null } = (m) => ({
  ok: true,
  providerMessageId: `wamid.${m.deliveryId}`,
})): Sender & { calls: Outbound[] } {
  const calls: Outbound[] = [];
  const s = (async (m: Outbound) => {
    calls.push(m);
    return answer(m);
  }) as Sender & { calls: Outbound[] };
  s.calls = calls;
  return s;
}

export const deliveryOf = async (db: TestDb, messageOrTest: string) =>
  (
    await db.admin.query(
      `select id, status, mode, to_address, attempts, provider_message_id, error_code from ops.delivery where message_id = $1 or id = $1`,
      [messageOrTest],
    )
  ).rows[0];

// Every books table's row count (as the superuser, past RLS): a write that leaves the books untouched leaves this equal.
export async function bookCounts(db: TestDb): Promise<Record<string, number>> {
  const { rows } = await db.admin.query<{ rel: string }>(
    `select n.nspname || '.' || c.relname as rel from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'books' and c.relkind = 'r' order by 1`,
  );
  const out: Record<string, number> = {};
  for (const { rel } of rows) out[rel] = (await db.admin.query<{ n: number }>(`select count(*)::int as n from ${rel}`)).rows[0]?.n as number;
  return out;
}

/**
 * Two sweeps (or more) racing for one delivery's claim: the superuser holds the row's lock while `start` begins them,
 * until `n` munshi_jobs backends wait on it (each selected the row as queued and is trying to claim it), then lets them
 * go. The claim, committed before any provider is called (outbox.ts), is what lets only one of them on.
 */
export async function raceForClaim<T>(db: TestDb, deliveryId: string, start: () => Promise<T>[], n = 2): Promise<T[]> {
  const c = await db.admin.connect();
  try {
    await c.query('begin');
    await c.query('select 1 from ops.delivery where id = $1 for update', [deliveryId]);
    const running = start();
    for (let i = 0; ; i++) {
      const { rows } = await db.admin.query<{ n: number }>(
        `select count(*)::int as n from pg_stat_activity where datname = $1 and usename = 'munshi_jobs' and wait_event_type = 'Lock'`,
        [db.name],
      );
      if ((rows[0]?.n ?? 0) >= n) break;
      if (i === 400) throw new Error(`raceForClaim: ${n} munshi_jobs backends never waited on the row`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await c.query('commit');
    return await Promise.all(running);
  } finally {
    c.release();
  }
}
