// Red-proofs of the packages' own gates (packages/core's boundary scan and pure modules, packages/agent's cite-or-abstain,
// the number detector and span parser): moved unchanged from v1's db/test/sabotage.ts at BP-FLIP. Each case runs in its
// package (`dir`); the agent's under db/test/agent.vitest.config.ts, since packages/agent's own config may not import db.
import type { Case } from './case.ts';

const B1 = 'packages/agent imports no app pool, no core writer and no db, and never names the app connection';
const B6 = 'packages/ai imports no @munshi package, no database driver and no app: only node, its libraries and its own files';
const B0 = 'the import scanner sees every form of import, follows them to their files, and lets the read entry point through';
const BOUNDARY_TEST = 'packages/core/test/boundary.test.ts';
const ANSWER = 'packages/agent/src/answer.ts';
const NUMBERS = 'packages/core/src/numbers.ts'; // the detector and its word lists, moved from answer.ts and words.ts (MS-22b)
const AGENT_CONFIG = '../../db/test/v2/agent.vitest.config.ts'; // packages/agent's own config may not import this file (B1)
const RUN_TS = 'packages/agent/src/run.ts';
const FC1_GLUE = 'FC1 two handles run together or joined only by glue are refused, and so is anything glued onto a handle';
const FC1_UNIT = 'FC1 a currency sign or a unit beside a handle is refused: the cell renders its own';
const FC1_NAME = "FC1 a text cell's digits render only when it is cited as a name, and a name never carries a currency sign";
const FC1_DATA = "RUN a read's names reach the model only inside a data block, without control characters, and an answer that obeys one abstains";
const MS8_HI = "MS8 Hindi numbers 1–100 are refused in CLDR's spelling and the review's, with their ordinal and plural endings, and the scales";
const MS8_LATN = "MS8 Hindi numbers in Latin letters are refused: every CLDR word romanised, long and short, with ordinal endings, and the review's";
const MS8_ROMAN = 'MS8 Roman numerals in any case, letters passing for digits, and number symbols are refused';
const MS8_SCRIPT = 'MS8 a letter outside the Latin and Devanagari scripts is refused, and so are Latin look-alikes outside ASCII';
const MS8_NAMES = "MS8 a text cell with no letter is no name, and a person's or firm's name may not carry a figure standing alone";
const MS8_PROBE = "MS8 every attack of the review's second probe is refused";
const MS12_CLEAN = 'MS12 the clean corpus: no ordinary answer abstains, in English, Hindi or Hinglish';
const MS12_ATTACKS = 'MS12 the attack corpus: every probe and probe2 attack and every homograph in a quantity context is refused';
const MS12_DROPPED = 'MS12 the sentences dropped from clean need a hole to pass, so they stay refused';
const MS12_RUN_NAMES = "RUN the names in a run's reads reach the validator: a homograph beside one abstains";
const B5_CORPUS = "the precision corpus passes unchanged through core's detector, line for line as through the agent's validator";
const EX2_REFUSED = "the span parser refuses what it cannot read, with the reason, and never guesses: 'बीस प्रतिशत' and '1,5' among them";
const EX2_HINDI = "every Hindi cardinal the detector lists reads to its value in the hand-written key and ICU's Hindi numerals";
const EX2_DATES = 'date words and forms read to the hand-written key, from Wednesday 28 Oct 2026';
const MS12_SHELF = 'MS12 shelf phrases (textRules) still read every homograph as a number: the context reading is for answers only';
export const BOUNDARY: [string, string][] = [
  ['b1-agent-imports-pool', B1],
  ['b1-agent-imports-command', B1],
  ['b1-agent-database-url', B1],
  // The MS-5 review's bypasses: a directory import of core, the app's pool, a computed import in a fixture, createRequire.
  ['b1-agent-dir-import', B1],
  ['b1-agent-via-app', B1],
  ['b1-agent-computed-import', B1],
  ['b1-agent-create-require', B1],
  // packages/ai (D-081): a planted file in it naming core (its types too), the agent, pg, the app or core by path, or a
  // computed import in a fixture.
  ['b6-ai-imports-core', B6],
  ['b6-ai-imports-core-types', B6],
  ['b6-ai-imports-agent', B6],
  ['b6-ai-imports-pg', B6],
  ['b6-ai-via-app', B6],
  ['b6-ai-via-core-path', B6],
  ['b6-ai-computed-import', B6],
  // Fix cycle 1: a relative path through the package's own node_modules (a link to another package), a URL beside the
  // module naming code, a worker, and @munshi/ai's manifest exporting core or depending on it.
  ['b1-agent-via-node-modules', B1],
  ['b1-agent-url-code', B1],
  ['b1-agent-worker', B1],
  ['b1-ai-exports-core', B1],
  ['b6-ai-via-node-modules', B6],
  ['b6-ai-url-code', B6],
  ['b6-ai-worker', B6],
  ['b6-ai-exports-core', B6],
  ['b6-ai-depends-core', B6],
  ['b2-read-imports-writer', '@munshi/core/read reaches only read.ts, money.ts and errors.ts, and none writes or sets context'],
  ['b3-actor-set-elsewhere', 'only withTx in packages/core/src/session.ts names the acting-member setting'],
  ['b4-snap-written-elsewhere', 'only mintSnapshot writes snap.*'],
  ['b4-jobs-insert', 'only mintSnapshot writes snap.*'],
];

export const PACKAGE_CASES: Case[] = [
  // packages/core: source-scanning gates (harness-level: a planted file joins the scan) and the pure modules.
  ...BOUNDARY.map(([sabotage, test]) => ({ sabotage, file: 'test/boundary.test.ts', test, dir: 'packages/core' })),
  // B0's own proof of the walk and the follow: the scanner is mutated as vitest loads the gate.
  {
    sabotage: 'b0-walk-skips-fixtures',
    file: 'test/boundary.test.ts',
    dir: 'packages/core',
    test: B0,
    ts: { file: BOUNDARY_TEST, from: "const AGENT_SKIP = ['node_modules'];", to: "const AGENT_SKIP = ['node_modules', 'fixtures'];" },
  },
  {
    sabotage: 'b0-walk-no-mts',
    file: 'test/boundary.test.ts',
    dir: 'packages/core',
    test: B0,
    ts: { file: BOUNDARY_TEST, from: 'const CODE = /\\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;', to: 'const CODE = /\\.(ts|tsx|js|jsx|mjs)$/;' },
  },
  {
    sabotage: 'b0-no-follow',
    file: 'test/boundary.test.ts',
    dir: 'packages/core',
    test: B0,
    ts: { file: BOUNDARY_TEST, from: 'else queue.push(found);', to: 'else continue;' },
  },
  {
    sabotage: 'b0-no-follow-read',
    file: 'test/boundary.test.ts',
    dir: 'packages/core',
    test: B0,
    ts: { file: BOUNDARY_TEST, from: "if (spec === '@munshi/core/read') queue.push(READ_ENTRY);", to: "if (spec === '@munshi/core/read') void 0;" },
  },
  {
    sabotage: 'u-money-rounding',
    file: 'test/money.test.ts',
    dir: 'packages/core',
    test: 'money: a line amount rounds half away from zero, once',
    ts: { file: 'packages/core/src/money.ts', from: 'Math.floor((Math.abs(exact) + 500) / 1000)', to: 'Math.floor(Math.abs(exact) / 1000)' },
  },
  {
    sabotage: 'u-time-zone',
    file: 'test/time.test.ts',
    dir: 'packages/core',
    test: 'time: a business date is the Asia/Kolkata calendar date',
    ts: { file: 'packages/core/src/time.ts', from: "export const DEFAULT_TIME_ZONE = 'Asia/Kolkata';", to: "export const DEFAULT_TIME_ZONE = 'UTC';" },
  },
  // ---- MS-6 fix cycle 1: cite-or-abstain in packages/agent (a handle is one whole number; units and currency belong to
  // the cell; numbers in words; ids and names), the data blocks and the hard time budget --------------------------------
  ...(
    [
      ['fc1-handles-joined', FC1_GLUE, NUMBERS, 'if (!/\\p{L}/u.test(gap) && !(GAP_MARK.test(gap) && LIST_GAP.test(gap))) out.add("handle_glue");', 'void gap;'],
      ['fc1-glue-after', FC1_GLUE, NUMBERS, 'if (!CLOSERS.test(gluedAfter)) {', 'if (false) {'],
      ['fc1-scale-beside', 'FC1 a scale or magnitude word or symbol beside a handle is refused, in any case, width or script', NUMBERS, '    if (SCALE.has(w)) out.add("scale_word");\n', ''],
      ['fc1-unit-beside', FC1_UNIT, NUMBERS, '    if (UNIT.has(w)) out.add("unit_or_currency");\n', ''],
      ['fc1-currency-beside', FC1_UNIT, NUMBERS, '    if (/\\p{Sc}/u.test(ch)) out.add("unit_or_currency");\n', ''],
      [
        'fc1-unit-not-rendered',
        'FC1 a money cell renders with its currency sign and a quantity cell with its unit',
        'packages/core/src/read.ts',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: the source text of read.ts, not a template
        "return counted ? `${n} ${cell.unit}${Number(cell.num) === 1000 ? '' : 's'}` : n;",
        'return n;',
      ],
      [
        'fc1-number-words',
        'FC1 English number words are refused: cardinals, ordinals, fractions, multiplicatives, compounds, Roman numerals',
        NUMBERS,
        '  if (numberWord(text, names)) out.add("number_word");\n',
        '',
      ],
      ['fc1-hindi-nukta', 'FC1 Hindi number words are refused, with or without the nukta and either nasal mark', NUMBERS, '.replace(/\\u093c/g, "")', ''],
      ['fc1-cjk', 'FC1 CJK numerals are refused', NUMBERS, '  if (CJK.test(plain)) return true;\n', ''],
      ['fc1-id-ref', "FC1 a ref to an id column or a uuid-shaped text cell is refused, unless it is a person's id cited as their name", ANSWER, '      if (idRef(ref)) failures.push({ segment: i, rule: "id_ref", ref: k });\n', ''],
      ['fc1-name-digits', FC1_NAME, NUMBERS, '  if (!NAME_COLUMNS.includes(ref.col) && (NUMBERISH.test(t) || numberWord(t))) return "not_a_name";\n', ''],
      [
        'fc1-name-currency',
        FC1_NAME,
        NUMBERS,
        '  if (/\\p{Sc}/u.test(cell.txt + t) || (fold(t).match(WORD) ?? []).some((w) => CURRENCY.has(w))) return "not_a_name";\n',
        '',
      ],
      ['fc1-data-unescaped', FC1_DATA, 'packages/agent/src/tools.ts', '.replace(/[<>⟦⟧]/g, (c) =>', '.replace(/[⟦⟧]/g, (c) =>'],
      ['fc1-data-controls', FC1_DATA, 'packages/agent/src/tools.ts', '    .replace(/\\p{Cf}/gu, "")\n', ''],
      ['fc1-no-deadline', "RUN a model that hangs is cut off at the run's deadline", RUN_TS, 'const r = await generate({ ...req, signal: AbortSignal.timeout(left) }, run.o.deps);', 'const r = await generate(req, run.o.deps);'],
      ['fc1-narrate-overrun', 'RUN narrate is given the time left and no more', RUN_TS, '    run.deadline,\n  );', '    run.deadline + 60_000,\n  );'],
    ] as const
  ).map(([sabotage, test, file, from, to]) => ({ sabotage, file: `test/${file === RUN_TS || file.endsWith('tools.ts') ? 'run' : 'answer'}.test.ts`, test, dir: 'packages/agent', config: AGENT_CONFIG, ts: { file, from, to } })),
  // ---- MS-8 fix cycle 1 (the fa53b7d review failed clause 2): number words checked against independent tables, other
  // scripts, Roman numerals in any case, look-alike letters, number symbols, signs and decimals beside a handle, names
  // with no letter ----------------------------------------------------------------------------------------------------
  ...(
    [
      ['ms8-hindi-word', MS8_HI, NUMBERS, '"छत्तीस", ', ''],
      ['ms8-hindi-endings', MS8_HI, NUMBERS, '  if (HINDI_ENDS.some((e) => w.endsWith(e) && HINDI.has(w.slice(0, -e.length)))) return true;\n', ''],
      ['ms8-latin-word', MS8_LATN, NUMBERS, '"chalis", ', ''],
      ['ms8-latin-skeleton', MS8_LATN, NUMBERS, '  const s = skeleton(w);\n', '  const s = w;\n'],
      ['ms8-latin-endings', MS8_LATN, NUMBERS, ' || HINDI_LATIN_ENDINGS.some((e) => s.endsWith(e) && LATIN_CARDINAL.has(skeleton(s.slice(0, -e.length))))', ''],
      ['ms8-accents', MS8_LATN, NUMBERS, 'shown(text).normalize("NFD").replace(/([A-Za-z])\\p{M}+/gu, "$1")', 'shown(text)'],
      ['ms8-roman-any-case', MS8_ROMAN, NUMBERS, '    if (!elided && ROMAN.test(w.toUpperCase()) && !ROMAN_WORDS.includes(w)) return true;\n', '    if (w.length > 1 && w === w.toUpperCase() && ROMAN.test(w)) return true;\n'],
      ['ms8-digit-like', MS8_ROMAN, NUMBERS, ' && [...w].every((c) => DIGIT_LIKE.includes(c)) && ', ' && false && '],
      ['ms8-number-symbols', MS8_ROMAN, NUMBERS, 'const NUMBERISH = /[\\p{N}%‰‱\\p{So}\\p{Extended_Pictographic}]|\\u20e3/u;', 'const NUMBERISH = /[\\p{N}%‰‱]/u;'],
      ['ms8-number-symbols-probe', MS8_PROBE, NUMBERS, 'const NUMBERISH = /[\\p{N}%‰‱\\p{So}\\p{Extended_Pictographic}]|\\u20e3/u;', 'const NUMBERISH = /[\\p{N}%‰‱]/u;'],
      ['ms8-other-script', MS8_SCRIPT, NUMBERS, '  if (otherScript(text)) out.add("other_script");\n', ''],
      ['ms8-other-script-probe', MS8_PROBE, NUMBERS, '  if (otherScript(text)) out.add("other_script");\n', ''],
      ['ms8-signs-beside', 'MS8 a sign, a decimal or a fraction word beside a handle is refused as a scale', NUMBERS, '  if (!/\\p{L}/u.test(chunk) && [...chunk].some((ch) => SIGNS.includes(ch))) out.add("scale_word");\n', ''],
      ['ms8-scale-words', 'MS8 a sign, a decimal or a fraction word beside a handle is refused as a scale', NUMBERS, '  "minus", "negative", "neg", "point", "decimal", "dot", "ऋण", "दशमलव", "बिंदु", "माइनस", "नेगेटिव", "पॉइंट",\n', ''],
      ['ms8-name-no-letter', MS8_NAMES, NUMBERS, '  if (!/\\p{L}/u.test(t)) return "not_a_name"; // "15000" is no name\n', ''],
      ['ms8-name-lone-figure', MS8_NAMES, NUMBERS, '  if (PARTY_COLUMNS.includes(ref.col) && loneFigure(t)) return "not_a_name";\n', ''],
    ] as const
  ).map(([sabotage, test, file, from, to]) => ({ sabotage, file: 'test/answer.test.ts', test, dir: 'packages/agent', config: AGENT_CONFIG, ts: { file, from, to } })),
  // ---- MS-12: homographs are numbers only in a quantity context (the precision corpus flips both ways: a homograph read
  // as a number anywhere fails clean; each context switched off lets an attack through), and the run's names reach the
  // validator ---------------------------------------------------------------------------------------------------------
  ...(
    [
      ['ms12-homograph-anywhere', MS12_CLEAN, '  if (!names) return words.some((w) => isNumber(w) || HOMOGRAPH.has(w));', '  return words.some((w) => isNumber(w) || HOMOGRAPH.has(w));'],
      ['ms12-no-do-not', MS12_CLEAN, '    if (w === "do" && n !== null && toks[n]?.w === "not" && SPACED.test(after(i))) continue;\n', ''],
      ['ms12-no-light-verb', MS12_CLEAN, ' && LIGHT_VERB.has(verb.w) && ', ' && false && '],
      ['ms12-no-abbreviation', MS12_CLEAN, '(_, i) => (i ? "ie" : "eg")', '(m) => m'],
      ['ms12-no-tin-container', MS12_CLEAN, ' && (COLLECTIVE.has(w) || !DETERMINER.has(toks[p ?? -1]?.w ?? ""))', ''],
      ['ms12-no-context', MS12_ATTACKS, ' || quantityContext(text, names);', ';'],
      ['ms12-ctx-beside', MS12_ATTACKS, '    if ((p !== null && amount(p)) || (n !== null && amount(n)) || signIn(before(i)) || signIn(after(i))) return true;\n', ''],
      ['ms12-ctx-beside-dropped', MS12_DROPPED, '    if ((p !== null && amount(p)) || (n !== null && amount(n)) || signIn(before(i)) || signIn(after(i))) return true;\n', ''],
      ['ms12-ctx-count-noun', MS12_ATTACKS, '    if (target !== null && (COUNT.has(toks[target]?.w ?? "") || amount(target))) return true;\n', ''],
      ['ms12-ctx-count-noun-dropped', MS12_DROPPED, '    if (target !== null && (COUNT.has(toks[target]?.w ?? "") || amount(target))) return true;\n', ''],
      ['ms12-ctx-modifiers', MS12_ATTACKS, '      while (chained(j) && MODIFIER.has(toks[j]?.w ?? "")) j++;\n', ''],
      ['ms12-ctx-of', MS12_ATTACKS, '        if (chained(j) && OF_PRONOUN.has(toks[j]?.w ?? "")) return true;\n', ''],
      ['ms12-ctx-label', MS12_ATTACKS, '    if (/[:=\\-–—]\\s*$/u.test(before(i)) && /^\\s*(?:[.!?;।॥…,]|$)/u.test(after(i))) return true;\n', ''],
      ['ms12-ctx-quantifier', MS12_ATTACKS, '    if (QUANTIFIED.has(w) && p !== null && QUANTIFIER.has(toks[p]?.w ?? "")) return true;\n', ''],
      ['ms12-ctx-mein-se', MS12_ATTACKS, '    if (w === EK && p !== null && toks[p]?.w === "से" && /में$/u.test(toks[p - 1]?.w ?? "")) return true;\n', ''],
      ['ms12-ctx-after-ek', MS12_ATTACKS, '    if (w === EK && n !== null && AFTER_ONE.has(toks[n]?.w ?? "")) return true;\n', ''],
      ['ms12-ctx-hindi', MS12_ATTACKS, '    if (w === DO || (LATIN_HOMOGRAPH.has(w) && hindi[sentenceOf[i] as number])) return true;\n', ''],
      ['ms12-ctx-hindi-dropped', MS12_DROPPED, '    if (w === DO || (LATIN_HOMOGRAPH.has(w) && hindi[sentenceOf[i] as number])) return true;\n', ''],
      ['ms12-ctx-light-verb-follow', MS12_ATTACKS, '      if (n !== null && SPACED.test(after(i)) && (amount(n) || COUNT.has(toks[n]?.w ?? ""))) return true;\n', ''],
      ['ms12-names-dropped', MS12_ATTACKS, '    for (const w of fold(name).match(WORD) ?? []) {', '    for (const w of [] as string[]) {'],
      ['ms12-ctx-glued', MS12_ATTACKS, '  if (words.some(glued)) return true;\n', ''],
      ['ms12-ctx-alone', MS12_ATTACKS, '    if (p === null && n === null) return true;\n', ''],
      ['ms12-shelf-contextual', MS12_SHELF, 'export const textRules = (text: string): Rule[] => rulesOf(text);', 'export const textRules = (text: string): Rule[] => rulesOf(text, new Set());'],
    ] as const
  ).map(([sabotage, test, from, to]) => ({ sabotage, file: 'test/corpus.test.ts', test, dir: 'packages/agent', config: AGENT_CONFIG, ts: { file: NUMBERS, from, to } })),
  {
    sabotage: 'ms12-run-names',
    file: 'test/run.test.ts',
    dir: 'packages/agent',
    config: AGENT_CONFIG,
    test: MS12_RUN_NAMES,
    ts: { file: RUN_TS, from: '(ref) => run.o.port.resolve(ref), namesRead(run));', to: '(ref) => run.o.port.resolve(ref));' },
  },
  // ---- MS-22b: one number detector for core and the agent (B5), and the span parser (EX2) ----------------------------
  ...(
    [
      ['ms22b-core-number-word', B5_CORPUS, '"चौबीस", ', ''],
      ['ms22b-core-numberish', B5_CORPUS, 'const NUMBERISH = /[\\p{N}%‰‱\\p{So}\\p{Extended_Pictographic}]|\\u20e3/u;', 'const NUMBERISH = /[\\p{N}%‰‱]/u;'],
      ['ex2-percent', EX2_REFUSED, '  if (/[%‰‱٪]/u.test(folded) || (folded.match(WORD) ?? []).some((w) => PERCENT.has(wordKey(w)))) return refuse("percent");\n', ''],
      ['ex2-grouping', EX2_REFUSED, '  if (ascii.includes(",") && !/^(?:\\d{1,3}(?:,\\d{3})+|\\d{1,2}(?:,\\d{2})+,\\d{3})(?:\\.\\d+)?$/.test(ascii)) return refuse("grouping");\n', ''],
      ['ex2-mixed-script', EX2_REFUSED, '    if (zero !== undefined && z !== zero) return { refusal: "mixed_script" };\n', ''],
      ['ex2-hindi-value', EX2_HINDI, '36 छत्तीस chhattis', '37 छत्तीस chhattis'],
      ['ex2-falling-scales', EX2_REFUSED, ' || scale >= above || q * scale >= above * 4', ''],
      ['ex2-weekday-today', EX2_DATES, 'ahead === 0 ? refuse("ambiguous") : ', ''],
      ['ex2-year-roll', EX2_DATES, '  if (!c && sign * (day < ask.today ? -1 : day > ask.today ? 1 : 0) < 0) day = on(thisYear + sign);\n', ''],
    ] as const
  ).map(([sabotage, test, from, to]) => ({ sabotage, file: 'test/numbers.test.ts', test, dir: 'packages/core', ts: { file: NUMBERS, from, to } })),
];
