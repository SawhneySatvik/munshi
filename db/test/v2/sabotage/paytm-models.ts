// P-5's red-proofs: model.choose's own checks (core, before the table's guard), modelFor dropping a disabled row, the
// deployment ceiling and sandbox-off in allow(), the next run using the chosen alias, and the live fallback chain.
import type { Case } from './case.ts';

const V2 = 'vitest.v2.config.ts';
const TEST = 'test/v2/core/platform/model-choice.test.ts';
const MODELS = 'packages/core/src/models.ts';
const ALLOW = 'packages/core/src/allow.ts';
const ts = (sabotage: string, test: string, file: string, from: string, to: string): Case => ({ sabotage, file: TEST, test, config: V2, ts: { file, from, to } });
// packages/agent's own config may not import db (B1), so its cases run under db's agent config, as packages.ts's do.
const agent = (sabotage: string, test: string, from: string, to: string): Case => ({
  sabotage,
  file: 'test/models.test.ts',
  test,
  dir: 'packages/agent',
  config: '../../db/test/v2/agent.vitest.config.ts',
  ts: { file: 'packages/ai/src/providers/generate.ts', from, to },
});

const OFF_LIST = 'MODELS1 an alias off the allow-list, or one the running build does not serve in the agent role, is refused';
const STAFF = 'MODELS2 a manager or staff member choosing a model is refused, and writes nothing';
const NEXT_RUN = "MODELS4 after the owner's pick, the next run's trace shows the chosen alias, and the call goes to its binding";
const OWN_ROLE = "MODELS6 a pick applies to the agent's own role only: the run's other calls keep the edition's default";
const DISABLED = 'MODELS5 a disabled allow-list row drops the choice for the default; with the default off too, the surface hides';
const CEILING = 'AICAP2 with the deployment ceiling at 3, the fourth call across two shops is refused and counted nowhere';
const SANDBOX = 'SANDBOXAI1 a sandbox reads AI off unless the default config turns sandbox AI on';
const FALLBACK1 = 'FALLBACK1 a 429 on the first binding (after its retries) moves to the second, which answers, allowed again first';
const FALLBACK2 = 'FALLBACK2 the trace names the alias that answered each call, and the one narrate fell back from';

export const PAYTM_MODELS_CASES: Case[] = [
  ts('v2-models-unknown-alias', OFF_LIST, MODELS, '    if (!alias || !serves(cat, alias, a.role) || !list.aliases.includes(alias))', '    if (!alias)'),
  ts('v2-models-staff', STAFF, MODELS, "    if (who[0]?.role !== 'owner') throw new CoreError('refused', { fields: ['member'] });\n", ''),
  ts('v2-models-choice-ignored', NEXT_RUN, MODELS, '  const chain = [...new Set([chosen, list.shopDefault, cat.defaults[r], ...allowed])]', '  const chain = [...new Set([list.shopDefault, cat.defaults[r], ...allowed])]'),
  ts('v2-models-choice-every-role', OWN_ROLE, MODELS, '  const chosen = r === a.role ? a.chosen : null;', '  const chosen = a.chosen;'),
  // The shop's list read without the deployment's enabled filter (ai.shop_models() holds it now): a disabled row is kept.
  ts(
    'v2-models-disabled-kept',
    DISABLED,
    MODELS,
    "    'select m.alias, m.is_default from ai.shop_models() m where m.role = $1 order by m.alias',",
    "    `select a.alias, false as is_default from (select distinct on (alias) alias from platform.model_allow where role = $1 order by alias, effective_from desc, id desc) a order by a.alias`,",
  ),
  ts('v2-ai-ceiling-skipped', CEILING, ALLOW, '  if (ceiling[0]?.ok !== true) {', '  if (false) {'),
  ts('v2-ai-ceiling-counts-shop', CEILING, ALLOW, "    await c.query('rollback to savepoint munshi_allow');\n", ''),
  ts('v2-ai-sandbox-on', SANDBOX, ALLOW, "  if (limits.sandbox && !limits.sandboxAiEnabled) return { ok: false, reason: 'off' };\n", ''),
  agent('agent-fallback-removed', FALLBACK1, '  const tries = mode === "live" ? chain : chain.slice(0, 1);', '  const tries = chain.slice(0, 1);'),
  agent('agent-fallback-removed-run', FALLBACK2, '  const tries = mode === "live" ? chain : chain.slice(0, 1);', '  const tries = chain.slice(0, 1);'),
];
