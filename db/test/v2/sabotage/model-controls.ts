import type { Case } from './case.ts';
import { mutate } from './sql.ts';

const V2 = 'vitest.v2.config.ts';
const TEST = 'test/v2/core/platform/model-controls.test.ts';

export const MODEL_CONTROLS_CASES: Case[] = [
  {
    sabotage: 'v2-ai-deployment-cap',
    file: TEST,
    test: 'the deployment call count is shared across tenants and never exceeds the approved cap',
    config: V2,
    sql: mutate(
      'platform.count_ai_call(date,integer)',
      'where platform.ai_usage_total.calls < p_cap',
      'where true',
    ),
  },
  {
    sabotage: 'v2-model-choice-command',
    file: TEST,
    test: 'only an active owner running model.choose may choose an enabled alias for an agent',
    config: V2,
    sql: mutate(
      'ops.model_choice_guard()',
      "ctx_command is distinct from 'model.choose' or ctx_actor is null",
      'ctx_actor is null',
    ),
  },
  {
    sabotage: 'v2-model-allow-diff',
    file: TEST,
    test: 'only an active owner running model.choose may choose an enabled alias for an agent',
    config: V2,
    sql: mutate(
      'ops.model_choice_guard()',
      ") is true\n          -- The shop's own list",
      ") is not null\n          -- The shop's own list",
    ),
  },
  {
    sabotage: 'v2-import-file-role',
    file: TEST,
    test: 'settlement imports are tenant-scoped, unique by file hash, audited, and limited to owners and managers',
    config: V2,
    sql: mutate(
      'ops.import_file_guard()',
      "m.role in ('owner', 'manager') and m.active",
      "m.role in ('owner', 'manager', 'staff') and m.active",
    ),
  },
];
