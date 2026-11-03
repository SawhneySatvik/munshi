// Red-proofs of W2-B's app side, surplus for good (test/v2/core/surplus/sur-app.test.ts and apps/web/test/surplus.test.tsx):
// each breaks one thing a SUR-APP gate guards, as a source-text mutation applied as vitest loads the module. The schema's
// own SURPLUS gates are red-proved in surplus.ts.
import type { Case } from './case.ts';

const CORE = 'test/v2/core/surplus/sur-app.test.ts';
const V2 = 'vitest.v2.config.ts';
const WEB = { dir: 'apps/web', config: 'vitest.config.ts', file: 'test/surplus.test.tsx' } as const;
const COMMAND = 'packages/core/src/commands-surplus.ts';
const RECIPES = 'packages/agent/src/recipes.ts';

const APP1 =
  'SUR-APP1 Offer it drafts a surplus.give from the expiry finding: what is at risk of the lot, to the chosen recipient, every number a cell; nothing moves before approval';
const APP2 =
  "SUR-APP2 approval writes the stock row and the listing together, under the approver (a manager, on the owner's draft), valued as the finding valued the lot";
const APP3 = "SUR-APP3 counter staff can neither read surplus, propose, approve nor list a recipient; their refused approval leaves the owner's draft waiting";
const APP5 = 'SUR-APP5 two gifts of one lot never exceed what is left: one held open, the other waits on the stock lock, then is refused; approved again, it is stale';
const APP4 = 'the impact tally renders only from cells: on the office and the surplus page every figure is a chip on its surplus.impact cell';
const APP6 = 'recipients are always labelled simulated on screen: the surplus page, Offer it on Home and the gift waiting in the tray';
const APP3WEB = 'counter staff get no surplus: the page is a 404, Home offers them no Offer it, and listing a recipient is refused';
const APP1WEB = "Offer it from Home leaves the gift waiting in the tray, filed under Tally's desk; nothing moves before an approval";
const COPY = 'the surplus words carry no digit, and the English ones no Devanagari: the page, Offer it, the tray and the drawer titles';
const LAND = "the landing page's sample tally sits inside its labelled example, in both languages, English with no Devanagari";
const APP7 =
  "SUR-APP7 a gift's cited rows are its own: naming one recipient while giving to another, or one lot's item while giving another's, is refused at proposal and stale at approval";
const APP8 =
  "once a gift is valued in another currency, the tally's three figures are Cannot verify and it says why; no figure counts only some gifts";
const APP9 = "a gift's card names only the payload's own item and recipient: a draft citing another recipient's name shows Cannot verify";
const OFFICE = "the office's brief offers the same choice as Home on an expiry line: each recipient labelled simulated, none picked silently";
const MIXED = '  if (!isZero(row.other_currency_gifts)) return { tally: { gifts: null, items: null, value: null, mixed: true }, snapshot: m.snapshot };\n';

const core = (sabotage: string, test: string, file: string, from: string, to: string): Case => ({ sabotage, file: CORE, test, config: V2, ts: { file, from, to } });
const web = (sabotage: string, test: string, file: string, from: string, to: string): Case => ({ sabotage, test, ...WEB, ts: { file, from, to } });

export const SURPLUS_APP_CASES: Case[] = [
  // the recipe ignores the person's pick and offers to the first recipient listed
  core('v2-surapp-ignores-choice', APP1, RECIPES, 'const want = choice?.recipientId;', 'const want = undefined;'),
  // approval runs the gift without writing it: no listing, no stock row
  core(
    'v2-surapp-no-listing',
    APP2,
    COMMAND,
    '`insert into ops.surplus_listing (tenant_id, id, lot_id, qty_milli, recipient_id) values ($1, $2, $3, $4, $5)\n           returning stock_move_id::text`',
    '`select null::text as stock_move_id where $1::uuid is not null and $2::uuid is not null and $3::uuid is not null and $4::bigint is not null and $5::uuid is not null`',
  ),
  // the role map is not asked: counter staff may propose a gift
  core('v2-surapp-no-role-gate', APP3, COMMAND, "if (!(await mayReadIn(c, 'surplus.recipients'))) throw new CoreError('refused', { fields: ['command'] });", ''),
  // no stock lock: a second gift of the lot reads what is left while the first is still in flight
  core('v2-surapp-no-lock', APP5, COMMAND, 'await lockStock(ctx, i.itemId);', ''),
  // Offer it approves its own draft: the gift moves with no person's decision
  web(
    'v2-surapp-web-autoapprove',
    APP1WEB,
    'apps/web/lib/server/hero.ts',
    '      out.push(r.kind === "proposed" ? { kind: "proposed", draftId: r.draftId } : r);',
    '      if (r.kind === "proposed") await (await import("@munshi/core")).decide(await appPool(), session, r.draftId, "approved");\n      out.push(r.kind === "proposed" ? { kind: "proposed", draftId: r.draftId } : r);',
  ),
  // a figure typed into the words
  web('v2-surapp-copy-digit', COPY, 'apps/web/lib/i18n-surplus.ts', '  tallyNone: "Nothing given yet.",', '  tallyNone: "Nothing given yet: 0.",'),
  // the landing page's sample figures outside a labelled example
  web('v2-surapp-land-unlabelled', LAND, 'apps/web/components/site/ImpactExample.tsx', ' aria-labelledby="impact-k" data-example="">', ' aria-labelledby="impact-k">'),
  // the tally's figures typed as text beside the cells instead of Figures
  web(
    'v2-surapp-tally-typed',
    APP4,
    'apps/web/components/SurplusTally.tsx',
    'const fig = (cell: SourceRef | null) => (cell ? <Figure cell={cell} /> : <CannotVerify />);',
    'const fig = (cell: SourceRef | null) => (cell ? <b>₹300</b> : <CannotVerify />);',
  ),
  // a gift in another currency left out silently: the tally counts only the shop's own and shows them as the whole
  web('v2-surapp-mixed-hidden', APP8, 'apps/web/lib/server/surplus.ts', MIXED, ''),
  // Home's Offer it names a recipient without its simulated label
  web('v2-surapp-option-unlabelled', APP6, 'apps/web/components/FindingMoves.tsx', '{`$' + '{r.name} · $' + '{a.simulated}`}', '{r.name}'),
  // the gift's tray card names its recipient without the simulated sticker
  web('v2-surapp-tray-unlabelled', APP6, 'apps/web/components/TrayCard.tsx', '<Sticker tone="yellow">{a.simulated}</Sticker>', ''),
  // the tray card takes any cited recipient's name, not the payload's own recipient's
  web(
    'v2-surapp-card-any-name',
    APP9,
    'apps/web/lib/server/home.ts',
    'query === "surplus.recipients" && text(r, "id") === d.payload.recipientId',
    'query === "surplus.recipients"',
  ),
  // the office's brief offers expiry the bare Draft the fix: the first recipient, picked silently
  web(
    'v2-surapp-office-no-choice',
    OFFICE,
    'apps/web/lib/server/office.ts',
    '        ...(l.kind === "expiry" && RECIPE_KINDS.includes(l.kind) ? { offer: recipients } : {}),\n',
    '',
  ),
  // a decided gift's card borrows the reminder's note (a message recorded, not sent) instead of its own
  web(
    'v2-surapp-done-note',
    APP6,
    'apps/web/components/TrayCard.tsx',
    '{draft.command === "surplus.give" && draft.status === "executed" ? a.trayGiftApprovedNote : a[done[1]]}',
    '{a[done[1]]}',
  ),
  // core does not hold a gift's cited rows to its payload: another recipient's name rides on the draft
  core('v2-surapp-unbound-rows', APP7, COMMAND, '        bad.push(...(await offPayload(c, i, [...basedOn, ...Object.values(refs)])));\n', ''),
  // Offer it makes a read its RECIPE_READS does not name, hidden from the static check: R3's run of the recipe catches it
  {
    sabotage: 'v2-surapp-r3-hidden-read',
    file: 'test/v2/core/agent/d082-roles.test.ts',
    test: "R3 every named read has a role entry, and Ask's desks offer each role only reads it may make",
    config: V2,
    ts: {
      file: RECIPES,
      from: '  const atRisk = ref(f.snapshotId, f.row, "at_risk");',
      to: '  await read(["purchases", "last_price"].join("."), {});\n  const atRisk = ref(f.snapshotId, f.row, "at_risk");',
    },
  },
  // a recipient named on the surplus page without its simulated label
  web(
    'v2-surapp-unlabelled',
    APP6,
    'apps/web/components/Surplus.tsx',
    '<span data-name="">{r.name}</span> <Sticker tone="yellow">{t.simulated}</Sticker>',
    '<span data-name="">{r.name}</span>',
  ),
  // the role map gives surplus to every role: the page and the tally open to counter staff
  web(
    'v2-surapp-every-role',
    APP3WEB,
    'packages/core/src/read-roles.ts',
    "  'surplus.recipients': office('stock'),\n  'surplus.impact': office('stock'),",
    "  'surplus.recipients': all('stock'),\n  'surplus.impact': all('stock'),",
  ),
];
