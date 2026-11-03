// Shared by the inbox flows' tests (chat → order, the agent's messaging copy, the injection and cross-tenant suites):
// a run a person's tap starts and its port as the app builds it (agent-port.ts), a model's pick of words written out
// from the phrase it names, the synthetic media, and what a run's traces may hold. Model turns are hand-written and
// replayed from packages/agent/fixtures/<suite> (packages/agent/test/script.ts).
import { readFileSync } from 'node:fs';
import type { Session } from '@munshi/core';
import { expect } from 'vitest';
import { INBOX_LABELS, wordsIn } from '../../../../../packages/agent/src/intake.ts';
import type { TraceEvent } from '../../../../../packages/agent/src/port.ts';
import type { TestDb } from '../../db.ts';
import { inboxPort, startRun, type Trigger } from '../agent-port.ts';

export const media = (name: string) => new Uint8Array(readFileSync(new URL(`../../../../../packages/agent/fixtures/media/${name}`, import.meta.url)));
export const pools = (db: TestDb) => ({ app: db.as('munshi_app'), agent: db.as('munshi_agent') });

/** The member's tap: a run of theirs and its inbox port; every write of the run is theirs, as the app. */
export async function inboxRun(db: TestDb, session: Session, trigger: Trigger = 'inbox') {
  const runId = await startRun(pools(db), session, trigger);
  return { runId, ...inboxPort(pools(db), session, runId) };
}

/** The words of `text` that `phrase` (its `nth` occurrence) covers, as the model picks them: first and last word numbers. */
export function pick(text: string, phrase: string, nth = 0): { from: number; to: number } {
  let at = -1;
  for (let i = 0; i <= nth; i++) at = text.indexOf(phrase, at + 1);
  if (at < 0) throw new Error(`"${phrase}" is not in the message`);
  const start = [...text.slice(0, at)].length;
  const end = start + [...phrase].length;
  const words = wordsIn(text);
  const from = words.findIndex((w) => w.start === start);
  const to = words.findIndex((w) => w.end === end);
  if (from < 0 || to < 0) throw new Error(`"${phrase}" does not start and end on a word`);
  return { from, to };
}

/** A run's traces, in memory and as stored: no untrusted text, every label a fixed one, every id an id. */
export async function expectCleanTraces(db: TestDb, runId: string, events: TraceEvent[], untrusted: string[]) {
  const stored = (await db.admin.query('select kind, label, ids from ai.trace where run_id = $1 order by seq', [runId])).rows;
  expect(stored.length).toBe(events.length);
  expect(events.length).toBeGreaterThan(0);
  const all = JSON.stringify([events, stored]);
  for (const text of untrusted) expect(all.includes(text), text).toBe(false);
  for (const e of events) for (const label of e.label.split(',')) expect(INBOX_LABELS.has(label), label).toBe(true);
  for (const s of stored) for (const label of s.label.split(':')) expect(INBOX_LABELS.has(label), label).toBe(true);
  for (const e of events) for (const id of e.ids) expect(id).toMatch(/^[0-9a-f-]{36}$/);
}
