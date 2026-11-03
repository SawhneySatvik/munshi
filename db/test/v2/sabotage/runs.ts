// Red-proofs of the run, trace, message-text and usage gates (test/v2/gates/05-runs.test.ts).
import type { Case } from './case.ts';
import { mutate } from './sql.ts';

const V2 = 'vitest.v2.config.ts';
const FILE = 'test/v2/gates/05-runs.test.ts';
const t = (test: string, sabotage: string, sql: string): Case => ({ sabotage, file: FILE, test, config: V2, sql });

const A1_RUN = 'a run ends once, at now(); a tainted run stays tainted; model calls only rise; an ended run never changes';
const PII2 = 'a trace holds ids and labels only: free text in a label, an id that is not a uuid, or more than 16 ids is refused';
const RET1 = 'an Ask answer text is purged 30 days after the answer, not a day sooner; its hash outlives it; the purge erases no other text';
const A1_USAGE = 'a usage count only rises';

export const RUNS_CASES: Case[] = [
  t(A1_RUN, 'v2-a1-untaint', mutate('ai.run_flow()', ' or (old.tainted and not new.tainted)', '')),
  t(PII2, 'v2-pii2-label', 'alter table ai.trace drop constraint trace_label_check;'),
  t(RET1, 'v2-ret1-answer-age', mutate('ops.message_text_guard()', "and a.created_at < now() - interval '30 days'", '')),
  t(A1_USAGE, 'v2-a1-usage-falls', mutate('ai.usage_rises()', 'if new.calls < old.calls or ', 'if ')),
];
