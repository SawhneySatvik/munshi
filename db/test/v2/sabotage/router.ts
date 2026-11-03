// Red-proofs of the superadmin's router per shop (D-079 §8) and AI spend (W1-C): apps/web/test/router.test.tsx (RT1-RT4,
// SP1-SP5) and apps/web/test/console-router.test.tsx (RT5). Each breaks one thing a gate guards, as a source-text
// mutation applied as vitest loads the module.
import type { Case } from './case.ts';

const WEB = { dir: 'apps/web', config: 'vitest.config.ts' } as const;
const at = (file: string) => (sabotage: string, test: string, src: string, from: string, to: string): Case => ({ sabotage, file, test, ...WEB, ts: { file: src, from, to } });
const router = at('test/router.test.tsx');
const consoleRouter = at('test/console-router.test.tsx');

const RT1 =
  "RT1 a model off the shop's list is never called: a run's chain holds only the shop's aliases, a call with no chain is moved onto the list, and a role whose list allows nothing calls no model";
const RT2 = 'RT2 narration off: the brief keeps its template lines with no model call, no spend and no second try';
const RT3 = 'RT3 memory off: the decision stands and no note is kept; the card says notes are off';
const RT4 = 'RT4 a feature switched off is labelled where it would be, and its direct action is refused with feature_off before any run';
const RT5 = "RT5 a shop's feature, model list and budget change only once a later request approves the change; each shows beside its change";
const RT5_ALIAS = 'RT5 an alias this build does not serve in the role, or a feature that does not exist, is refused before any change is written';
const RT6 = "RT6 a call with no chain takes the run's chain in AI staff's order, so the model AI staff names is the model called";
const RT7 = "RT7 the owner's pick of an alias off the shop's list is refused by core, field alias, and writes nothing";
const RT8 = "RT8 voice switched off: a spoken question is refused as off before any run, and the mic is gone";
const SP1 ="SP1 every model call writes one spend row, as the run's member, before the run ends; a recorded replay writes none";
const SP2 = 'SP2 the hard cap refuses a call before the model is called, and counts nothing';
const SP3 = 'SP3 the soft cap shows the owner the banner, and calls go on';
const SP4 = 'SP4 spend figures render only from stored cells: every digit in the spend section is a chip to its row';
const SP5 = 'SP5 no price is "Cannot verify", never zero: an unpriced alias\'s cost is null, stored and shown so';

const MODELS = 'packages/core/src/models.ts';
const CLIENT = 'packages/ai/src/providers/client.ts';
const PORT = 'apps/web/lib/server/agent-port.ts';

export const ROUTER_CASES: Case[] = [
  // ---- RT1: core's chain reads the deployment's allow-list again, as before the router: the shop's list is ignored.
  router(
    'rt-chain-ignores-shop',
    RT1,
    MODELS,
    "'select m.alias, m.is_default from ai.shop_models() m where m.role = $1 order by m.alias',",
    "`select a.alias, false as is_default from (select distinct on (alias) alias, enabled from platform.model_allow where role = $1 order by alias, effective_from desc, id desc) a where a.enabled order by a.alias`,",
  ),
  // A call with no chain keeps the edition's binding whatever the shop's list says.
  router('rt-no-chain-unheld', RT1, CLIENT, '  if (list === null) return b;', '  if (list === null || list) return b;'),
  // A list that allows nothing for a role reads as no list: the deployment's aliases answer.
  router('rt-empty-list-open', RT1, MODELS, "source: listed[0]?.shop ? 'shop' : 'deployment'", "source: rows.length ? 'shop' : 'deployment'"),

  // ---- RT2: the brief narrates with narration switched off (the narrator is called; its model call is made).
  router('rt-narration-unchecked', RT2, 'packages/core/src/brief.ts', 'if (opts.narrate && made.narration && made.lines.length) {', 'if (opts.narrate && made.lines.length) {'),

  // ---- RT3: the note is written with memory switched off (the database refuses it, and the decision with it).
  router('rt-memory-unchecked', RT3, 'packages/core/src/approvals.ts', "const keepNotes = words !== undefined && (await featureOn(c, 'memory'));", 'const keepNotes = words !== undefined;'),
  // The card offers the words field whatever the switch.
  router('rt-notefield-unlabelled', RT3, 'apps/web/components/NoteField.tsx', '  if (!memory) {', '  if (!memory && false) {'),

  // ---- RT4: every surface reads every feature as on.
  router('rt-features-ignored', RT4, 'apps/web/components/AiFeatures.tsx', '  return !useContext(Ctx).includes(feature);', '  return useContext(Ctx) !== null;'),
  // The ask action hides the refusal as a general failure.
  router('rt-ask-off-hidden', RT4, 'apps/web/app/app/ask/actions.ts', 'return { error: isFeatureOff(err) ? "off" : "other" };', 'return { error: "other" as const };'),
  // The layout is told of no switched-off feature.
  router('rt-layout-told-nothing', RT4, PORT, '  return (Object.keys(switches) as AiFeature[]).filter((f) => !switches[f].on);', '  return (Object.keys(switches) as AiFeature[]).filter(() => false);'),

  // ---- RT5: the shop's page shows every feature as on, whatever its switch.
  consoleRouter('rt-console-feature-state', RT5, 'apps/web/components/platform/ShopRouter.tsx', 'data-enabled={f.enabled ? "on" : "off"}', 'data-enabled="on"'),
  // Core has no spec for the shop_features kind: the switch cannot be proposed.
  consoleRouter(
    'rt-console-no-feature-spec',
    RT5,
    'packages/core/src/platform.ts',
    "  shop_features: { table: 'shop_feature',",
    "  shop_features_gone: { table: 'shop_feature',",
  ),
  // The console proposes an alias this build does not serve.
  consoleRouter(
    'rt-console-unknown-alias',
    RT5_ALIAS,
    'apps/web/app/platform/actions.ts',
    '      if (!Object.hasOwn(KNOWN_ALIASES, alias) || !(KNOWN_ALIASES[alias] as readonly string[]).includes(role)) return null;',
    '',
  ),

  // The budget's form drops the line that the cap counts priced calls only.
  consoleRouter('rt-console-cap-unqualified', RT5, 'apps/web/components/platform/ShopRouter.tsx', 'The cap counts priced calls only:', 'The cap counts every call:'),

  // ---- RT6: a call with no chain keeps the edition's binding while it is on the list, whatever AI staff names first.
  router('rt-chainless-binding-first', RT6, CLIENT, '  const first = keyed ?? usable[0];', '  const first = list.includes(aliasOf(b, role) ?? "") ? b : (keyed ?? usable[0]);'),
  // ---- RT7: core's own check of the shop's list is gone (the table's guard still refuses, without naming the field).
  router('rt-choose-off-list', RT7, MODELS, 'if (alias === null ? allowed.length === 0 : !allowed.includes(alias))', 'if (alias === null ? allowed.length === 0 : !serves(cat, alias, a.role))'),
  // ---- RT8: a spoken question is not held to the voice switch.
  router('rt-voice-unchecked', RT8, 'apps/web/lib/server/hero.ts', '    if (input.via === "voice") await refuseFeatureOff(c, "voice");\n', ''),
  // ---- SP3: Home shows no banner.
  router('sp-home-banner-dropped', SP3, 'apps/web/components/OwnerHome.tsx', '{data.spendState ? (', '{false ? ('),

  // ---- SP1: the port writes no spend row.
  router('sp-spend-unwritten', SP1, PORT, '    if (call.replayed) return;\n    await recordSpend(', '    if (call.replayed || call) return;\n    await recordSpend('),
  // A replayed fixture is written as spend.
  router('sp-replay-written', SP1, PORT, '    if (call.replayed) return;\n', ''),
  // The model layer tells the caller of no call.
  router('sp-usage-untold', SP1, CLIENT, '  if (d.onUsage) await d.onUsage(call);', '  void call;'),
  // A speak request (no token usage of its own) is not told.
  router('sp-speak-untold', SP1, 'packages/ai/src/providers/sarvam-speak.ts', '    await told(d, { role: "speak",', '    void (d, { role: "speak",'),

  // ---- SP2: allow() ignores the budget.
  router('sp-hard-cap-ignored', SP2, 'packages/core/src/allow.ts', "  if ((await spendState(c)) === 'hard') return { ok: false, reason: 'budget' };\n  const media", '  const media'),

  // ---- SP3: no banner.
  router('sp-banner-dropped', SP3, 'apps/web/app/app/settings/ai/AiStaffView.tsx', '{data.spend && data.spend.state !== "under" ? (', '{false ? ('),

  // ---- SP4: a spend figure as bare text, not a chip to its cell.
  router('sp-figure-bare', SP4, 'apps/web/app/app/settings/ai/AiStaffView.tsx', '<Row title={r.calls} amt={<Figure cell={spend.calls} />} />', '<Row title={r.calls} amt={<span>{spend.desks.length}</span>} />'),

  // ---- SP5: an alias with no price costs zero.
  router('sp-unpriced-zero', SP5, 'packages/ai/src/prices.ts', '  if (!p || !usage) return null;', '  if (!p || !usage) return { costMinorE6: 0, currency: "USD" };'),
  // The screen shows a figure for a cost with no price.
  router('sp-unpriced-shown', SP5, 'apps/web/app/app/settings/ai/AiStaffView.tsx', '{d.cost ? <Figure cell={d.cost} /> : <CannotVerify />}', '{d.cost ? <Figure cell={d.cost} /> : <span>0.00</span>}'),
  // The month's total leaving unpriced calls out reads as the whole month's spend.
  router('sp-partial-total', SP5, 'apps/web/app/app/settings/ai/data.ts', '        partial: [', '        partial: false && ['),
];
