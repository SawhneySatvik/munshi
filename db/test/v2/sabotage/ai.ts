// Red-proofs of the finding, answer and brief gates (test/v2/gates/07-ai.test.ts).
import type { Case } from '../../sabotage.ts';
import { asOwner, mutate } from './sql.ts';

const V2 = 'vitest.v2.config.ts';
const FILE = 'test/v2/gates/07-ai.test.ts';
const t = (test: string, sabotage: string, sql: string): Case => ({ sabotage, file: FILE, test, config: V2, sql });
const FLOW = 'ai.finding_flow()';

const C5_KEY = 'C5 one open finding per key; a key dismissed in the last 30 days is not raised again; dismissed and resolved are final';
const C5_SNOOZE = 'C5 a member snoozes into the future; a watcher run wakes it only at snoozed_until and resolves it; each change is an event';
const C5_ROW = 'C5 a finding cites a row its snapshot has, and its impact is a money cell there';
const J2_RESEE = 'J2 a finding re-seen with the same cells keeps its snapshot and adds no pin or event; changed cells move it forward, pin and write seen; never back';
const J2_RELEASE = "J2 the jobs role releases only a finding's pin on a snapshot it no longer names; draft, answer and brief pins stay";
const J2_ANSWER = 'J2 an answer pins every snapshot its refs cite, refs carry ids and columns only; one brief per shop a day';

export const AI_CASES: Case[] = [
  t(C5_KEY, 'v2-c5-dismissed-rest', mutate(FLOW, "and f.status = 'dismissed' and f.closed_at > now() - interval '30 days') then", 'and false) then')),
  t(C5_KEY, 'v2-c5-final', mutate(FLOW, "if tg_op = 'UPDATE' and old.status in ('dismissed', 'resolved') then", 'if false then')),
  t(C5_SNOOZE, 'v2-c5-wake-time', mutate(FLOW, 'if old.snoozed_until > now() then', 'if false then')),
  t(C5_ROW, 'v2-c5-cited-row', mutate(FLOW, 'if snap_row is null or (new.impact_col is not null and not exists (', 'if false and (new.impact_col is not null and not exists (')),
  t(J2_RESEE, 'v2-j2-same-cells', mutate(FLOW, 'if new.row_sha256 = old.row_sha256 then', 'if false then')),
  t(J2_RESEE, 'v2-j2-never-back', mutate(FLOW, 'elsif (select s.created_at from snap.snapshot s', 'elsif false and (select s.created_at from snap.snapshot s')),
  // pin_release matching any holder
  t(J2_RELEASE, 'v2-j2-release-any', `drop policy pin_release on snap.pin; create policy pin_release on snap.pin as restrictive for delete to munshi_jobs
    using (not exists (select 1 from ai.finding f where f.tenant_id = pin.tenant_id and f.id = pin.holder_id and f.snapshot_id = pin.snapshot_id));`),
  t(J2_ANSWER, 'v2-j2-answer-pin', asOwner('drop trigger pin on ai.answer;')),
  t(J2_ANSWER, 'v2-j2-answer-refs', mutate('ai.answer_check()', " or r.v - array['snapshotId', 'row', 'col'] <> '{}'::jsonb", '')),
];
