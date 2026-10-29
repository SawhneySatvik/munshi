// F4's expiry by jobs (BLUEPRINT §4.4): the `holds` job, run by runDueJobs as munshi_jobs with no actor, expires in every
// tenant each piece held past held_until and each slot held past expires_at, a positive count per tenant, and leaves
// live holds and open asks as they were; an expired slot hold frees its slot. Red-proofs: test/v2/sabotage/core-holds.ts.
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createJobsPool, runDueJobs } from '../../../../../packages/core/src/jobs.ts';
import { openTestDb, type TestDb, tx } from '../../db.ts';
import { fillTenant, plantProbeCommand, sha, signUp, slot } from '../../gates/fixture.ts';
import { plant, refused } from '../../gates/lib.ts';
import { dayAfter, jobsUrl } from '../jobs/lib.ts';

type Planted = { tenant: string; asked: string; lapsedPiece: string; livePiece: string; lapsedSlot: string; liveSlot: string; slotHold: () => Promise<string> };

let db: TestDb;
let pool: pg.Pool;
let planted: Planted[];

// One tenant with, beside its fixture rows (an asked piece, a requested booking at 10:00), a piece held and lapsed, a
// piece held and live, and two public slot holds of its stylist on the booking day, the 12:00 one lapsed.
async function plantTenant(slug: string): Promise<Planted> {
  const f = await fillTenant(db, await signUp(db, slug, { type: 'salon' }));
  const app = db.as('munshi_app');
  const pub = db.as('munshi_public');
  const piece = async () => {
    const id = randomUUID();
    await tx(pub, { tenant_id: f.tenant }, (c) =>
      c.query(
        `insert into ops.reservation (tenant_id, id, site_id, item_id, qty_milli, contact_name, contact_phone_e164, notice_version, consent_version)
         values ($1, $2, $3, $4, 1000, 'Someone', '+910000000000', 'v1', 'v1')`,
        [f.tenant, id, f.site, f.good],
      ),
    );
    await tx(app, { tenant_id: f.tenant, actor_id: f.owner }, (c) => c.query(`update ops.reservation set state = 'held' where id = $1`, [id]));
    return id;
  };
  const slotHold = (from = '12:00', to = '12:30') =>
    tx(pub, { tenant_id: f.tenant }, async (c) =>
      (
        await c.query<{ id: string }>(
          `insert into ops.booking (tenant_id, site_id, shop_id, staff_id, service_item_id, during, state, source, hold_token_sha256, ip_hash, device_hash, shift_pattern_id)
           values ($1, $2, $3, $4, $5, ${slot(from, to)}, 'held', 'site', $6, $7, $8, $9) returning id`,
          [f.tenant, f.site, f.shop, f.staffRow, f.service, sha(randomUUID()), sha(randomUUID()), sha(randomUUID()), f.pattern],
        )
      ).rows[0]?.id as string,
    );
  const lapsedPiece = await piece();
  const livePiece = await piece();
  const lapsedSlot = await slotHold('12:00', '12:30');
  const liveSlot = await slotHold('14:00', '14:30');
  await plant(db.admin, `update ops.reservation set held_until = now() - interval '1 minute' where id = $1`, [lapsedPiece]);
  await plant(db.admin, `update ops.booking set expires_at = now() - interval '1 minute' where id = $1`, [lapsedSlot]);
  return { tenant: f.tenant, asked: f.reservation, lapsedPiece, livePiece, lapsedSlot, liveSlot, slotHold: () => slotHold() };
}

beforeAll(async () => {
  db = await openTestDb();
  await plantProbeCommand(db);
  planted = [await plantTenant('holds-expiry-a'), await plantTenant('holds-expiry-b')];
  pool = createJobsPool(jobsUrl(db));
  await db.sabotage();
});
afterAll(async () => {
  await pool?.end();
  await db?.close();
});

const states = async (p: Planted) => {
  const { rows } = await db.admin.query<{ id: string; state: string }>(
    `select id::text, state from ops.reservation where tenant_id = $1 union all select id::text, state from ops.booking where tenant_id = $1`,
    [p.tenant],
  );
  const by = new Map(rows.map((r) => [r.id, r.state]));
  return { asked: by.get(p.asked), lapsedPiece: by.get(p.lapsedPiece), livePiece: by.get(p.livePiece), lapsedSlot: by.get(p.lapsedSlot), liveSlot: by.get(p.liveSlot) };
};

it("F4 the holds job expires every tenant's piece held past held_until and slot held past expires_at, a positive count each, and leaves live holds held", async () => {
  for (const p of planted) {
    expect(await states(p), p.tenant).toEqual({ asked: 'requested', lapsedPiece: 'held', livePiece: 'held', lapsedSlot: 'held', liveSlot: 'held' });
    // Stored as held, the lapsed slot hold still takes its slot.
    expect((await refused(p.slotHold())).code).toBe('23P01');
  }
  const runs = await runDueJobs(pool, dayAfter(1), ['holds']);
  for (const p of planted) {
    expect(runs.filter((r) => r.tenantId === p.tenant).map((r) => [r.job, r.outcome, r.removed]), p.tenant).toEqual([['holds', 'ok', { reservations: 1, slot_holds: 1 }]]);
    expect(await states(p), p.tenant).toEqual({ asked: 'requested', lapsedPiece: 'expired', livePiece: 'held', lapsedSlot: 'expired', liveSlot: 'held' });
    await p.slotHold(); // the expired hold freed its slot
  }
  // Nothing left to expire: the next run's counts are zero.
  const again = await runDueJobs(pool, dayAfter(2), ['holds']);
  expect(planted.map((p) => again.filter((r) => r.tenantId === p.tenant).map((r) => r.removed))).toEqual(planted.map(() => [{ reservations: 0, slot_holds: 0 }]));
});
