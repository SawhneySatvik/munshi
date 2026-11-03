// Shared by the hero chain's tests (h1 shelf count, h2 bill reading, h3 voice): the synthetic media, a shop whose
// shelf the photo shows, a photo run with the app's port, and what its traces may hold. The media are drawn or spoken
// for these tests (packages/agent/fixtures/media: SVG sources beside the PNGs; the WAVs from macOS `say`), and the model
// turns are hand-written and replayed from packages/agent/fixtures/<suite> (packages/agent/test/script.ts).
import { readFileSync } from 'node:fs';
import { recordSale } from '@munshi/core';
import { expect } from 'vitest';
import { FLOW_LABELS } from '../../../../../packages/agent/src/photo.ts';
import type { TraceEvent } from '../../../../../packages/agent/src/port.ts';
import type { Deps } from '../../../../../packages/ai/src/providers/client.ts';
import { TRACE_LABELS } from '../../../../../packages/agent/src/run.ts';
import { env, json, noSleep, queueFetch, responsesBody } from '../../../../../packages/agent/test/helpers.ts';
import type { TestDb } from '../../db.ts';
import { agentPort, startRun, type Trigger } from '../agent-port.ts';
import { type Shop, smallShop } from '../shop.ts';

export const media = (name: string) => new Uint8Array(readFileSync(new URL(`../../../../../packages/agent/fixtures/media/${name}`, import.meta.url)));
export const pools = (db: TestDb) => ({ app: db.as('munshi_app'), agent: db.as('munshi_agent') });

// smallShop (48 packs of biscuits, 12 of butter on its first bill), after a counter sale of 24 packs of biscuits: the
// books say 24 packs of biscuits and 12 of butter. The shelf photo shows 18 and 12.
export async function shelfShop(db: TestDb, label: string): Promise<Shop> {
  const s = await smallShop(db.as('munshi_app'), label);
  await recordSale(db.as('munshi_app'), s.staff, { shopId: s.shopId, lines: [{ itemId: s.biscuits, qtyMilli: 24_000 }], payments: [{ method: 'cash', amountMinor: 24_000 }] });
  return s;
}

// The owner's run: every write of it (its evidence, a draft, its traces) is the owner's, as the app.
export async function photoRun(db: TestDb, s: Shop, trigger: Trigger = 'photo') {
  const runId = await startRun(pools(db), s.owner, trigger);
  return { runId, ...agentPort(pools(db), s.owner, runId) };
}

// What a run's traces hold, in memory and as stored: no untrusted text, every label a fixed one (a stored list joined
// by ':'), every id an id.
export async function expectCleanTraces(db: TestDb, runId: string, events: TraceEvent[], untrusted: string[]) {
  const stored = (await db.admin.query('select kind, label, ids from ai.trace where run_id = $1 order by seq', [runId])).rows;
  expect(stored.length).toBe(events.length);
  expect(events.length).toBeGreaterThan(0);
  const all = JSON.stringify([events, stored]);
  for (const text of untrusted) expect(all.includes(text), text).toBe(false);
  for (const e of events) for (const label of e.label.split(',')) expect(FLOW_LABELS.has(label) || TRACE_LABELS.has(label), label).toBe(true);
  for (const s of stored) for (const label of s.label.split(':')) expect(FLOW_LABELS.has(label) || TRACE_LABELS.has(label), label).toBe(true);
  for (const e of events) for (const id of e.ids) expect(id).toMatch(/^[0-9a-f-]{36}$/);
}

// The vision model answering one request with `answer` (and a tool call beside it, if asked) over a fake transport:
// nothing touches the network or a fixture, and the request it was sent is kept, as the provider would receive it.
export function visionOnce(answer: unknown, toolCall = false) {
  const message = { type: 'message', id: 'm1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(answer), annotations: [] }] };
  const call = { type: 'function_call', id: 'fc1', call_id: 'call_1', name: 'items_list', arguments: '{}', status: 'completed' };
  const { f, calls } = queueFetch(json(200, responsesBody({ output: toolCall ? [call, message] : [message] })));
  const deps: Deps = { mode: 'live', edition: 'meta', env, fetch: f, sleep: noSleep };
  return { deps, calls, sent: (n = 0) => JSON.parse(String(calls[n]?.init?.body)) as { tools?: unknown; input: { content: string | { type: string; text?: string }[] }[] } };
}
