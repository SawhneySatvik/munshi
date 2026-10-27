// Shared by the hero chain's tests (h1 shelf count, h2 bill reading, h3 voice): the synthetic media, a shop whose
// shelf the photo shows, a photo run with the app's port, and what its traces may hold. The media are drawn or spoken
// for these tests (packages/agent/fixtures/media: SVG sources beside the PNGs; the WAVs from macOS `say`), and the model
// turns are hand-written and replayed from packages/agent/fixtures/<suite> (packages/agent/test/script.ts).
import { readFileSync } from 'node:fs';
import { recordSale } from '@munshi/core';
import { expect } from 'vitest';
import { FLOW_LABELS } from '../../packages/agent/src/photo.ts';
import type { TraceEvent } from '../../packages/agent/src/port.ts';
import { TRACE_LABELS } from '../../packages/agent/src/run.ts';
import { agentPort, startRun } from './agent-port.ts';
import type { TestDb } from './db.ts';
import { type Shop, smallShop } from './shop.ts';

export const media = (name: string) => new Uint8Array(readFileSync(new URL(`../../packages/agent/fixtures/media/${name}`, import.meta.url)));

// smallShop (48 packs of biscuits, 12 of butter on its first bill), after a counter sale of 24 packs of biscuits: the
// books say 24 packs of biscuits and 12 of butter. The shelf photo shows 18 and 12.
export async function shelfShop(db: TestDb, label: string): Promise<Shop> {
  const s = await smallShop(db.app, label);
  await recordSale(db.app, s.staff, { shopId: s.shopId, lines: [{ itemId: s.biscuits, qtyMilli: 24_000 }], payments: [{ method: 'cash', amountMinor: 24_000 }] });
  return s;
}

export async function photoRun(db: TestDb, s: Shop, trigger: 'question' | 'photo' = 'photo') {
  const runId = await startRun(db, s.owner.tenantId, s.owner.memberId, trigger);
  return { runId, ...agentPort(db, s.owner.tenantId, runId) };
}

// What a run's traces hold, in memory and as stored: no untrusted text, every label a fixed one, every id an id.
export async function expectCleanTraces(db: TestDb, runId: string, events: TraceEvent[], untrusted: string[]) {
  const stored = (await db.admin.query('select kind, label, refs from ops.run_trace where run_id = $1 order by seq', [runId])).rows;
  expect(stored.length).toBe(events.length);
  expect(events.length).toBeGreaterThan(0);
  const all = JSON.stringify([events, stored]);
  for (const text of untrusted) expect(all.includes(text), text).toBe(false);
  for (const e of events) for (const label of e.label.split(',')) expect(FLOW_LABELS.has(label) || TRACE_LABELS.has(label), label).toBe(true);
  for (const e of events) for (const id of e.ids) expect(id).toMatch(/^[0-9a-f-]{36}$/);
}
