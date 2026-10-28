// MS-22b: one number detector for core and the agent (review finding B5), and the span parser (0016) with gate EX2.
// The precision corpus is the agent's (packages/agent/test/corpus): core's own functions judge it here, line by line,
// and must agree with the agent's validator. EX2 checks the parser against keys written by hand in this file and the
// ICU-generated Hindi list, never against the parser's own tables.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { corpus, type Line, NAMES, rendered, toRef, WORLD } from '../../agent/test/corpus/world.ts';
import { CLDR_HI, CLDR_HI_SCALES, REVIEW_HI } from '../../agent/test/hindi-tables.ts';
import {
  answerRules,
  type Cell,
  cellRule,
  DIGIT_ZEROS,
  HINDI_CARDINALS,
  HINDI_LATIN_CARDINALS,
  idRef,
  readSpan,
  SPAN_ADDS,
  SPAN_ENGLISH_TENS,
  SPAN_ENGLISH_UNITS,
  SPAN_HINDI,
  SPAN_SCALES,
  SPAN_WHOLES,
  type SpanAsk,
  type SpanRead,
  textRules,
} from '../src/read.ts';

// Core's verdict on a corpus line: the text rules with the names of the run's reads, then the rule of each cited cell.
const refusedByCore = (l: Line) =>
  answerRules(l.text, NAMES).length > 0 || l.refs.map(toRef).some((ref) => idRef(ref) || cellRule(ref, WORLD[ref.row]?.[ref.col] as Cell) !== null);

it("B5 the precision corpus passes unchanged through core's detector, line for line as through the agent's validator", async () => {
  const clean = corpus('clean');
  const attacks = corpus('attacks');
  const dropped = corpus('dropped');
  expect(clean.length).toBeGreaterThanOrEqual(150);
  expect(attacks.filter((l) => l.from === 'probe')).toHaveLength(11);
  expect(attacks.filter((l) => l.from === 'probe2')).toHaveLength(31);
  expect(attacks.filter((l) => l.from === 'ms12').length).toBeGreaterThanOrEqual(50);
  expect(dropped.length).toBeGreaterThan(0);
  const all = [...clean, ...attacks, ...dropped];
  // Every cited cell exists, so each refusal below is the detector's, never a missing cell.
  expect(all.flatMap((l) => l.refs.map(toRef)).filter((r) => !WORLD[r.row]?.[r.col])).toEqual([]);
  const cleanRefused = clean.filter(refusedByCore).map((l) => l.text);
  const attacksPassed = attacks.filter((l) => !refusedByCore(l)).map((l) => l.text);
  const droppedPassed = dropped.filter((l) => !refusedByCore(l)).map((l) => l.text);
  const disagree: string[] = [];
  for (const l of all) if ((await rendered(l)) === null !== refusedByCore(l)) disagree.push(l.text);
  console.log(
    `B5 core: ${cleanRefused.length}/${clean.length} clean refused, ${attacks.length - attacksPassed.length}/${attacks.length} attacks refused, ` +
      `${dropped.length - droppedPassed.length}/${dropped.length} dropped refused; ${all.length - disagree.length}/${all.length} lines judged as the agent judges them`,
  );
  expect(cleanRefused).toEqual([]);
  expect(attacksPassed).toEqual([]);
  expect(droppedPassed).toEqual([]);
  expect(disagree).toEqual([]);
});

it('B5 packages/agent keeps no copy of the detector or its word lists: it imports them from @munshi/core/read', () => {
  const dir = path.join(import.meta.dirname, '..', '..', 'agent', 'src');
  const files = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts'));
  const own = /\b(?:const|let|var|function)\s+(NUMBERISH|HANDLE|fold|skeleton|numberWord|isNumber|quantityContext|rulesOf|cellRule|HINDI_CARDINALS|HINDI_LATIN_CARDINALS|NUMBER_WORDS|SCALE_WORDS|UNIT_WORDS|CURRENCY_WORDS|HOMOGRAPHS)\b/g;
  const copies = files.flatMap((f) => [...readFileSync(path.join(dir, f), 'utf8').matchAll(own)].map((m) => `${f}: ${m[1]}`));
  expect(files.length).toBeGreaterThan(5);
  expect(copies).toEqual([]);
  for (const f of ['answer.ts', 'words.ts']) expect(readFileSync(path.join(dir, f), 'utf8')).toContain('from "@munshi/core/read"');
});

// ---- The span parser -------------------------------------------------------------------------------------------------

const whole = (t: string, ask: SpanAsk = { field: 'quantity' }): SpanRead => readSpan(t, { start: 0, end: [...t].length }, ask);
const count = (t: string) => {
  const r = whole(t);
  return r.ok && r.field === 'quantity' ? r.count : r.ok ? null : r.refusal;
};
const paise = (t: string) => {
  const r = whole(t, { field: 'amount' });
  return r.ok && r.field === 'amount' ? r.minor : r.ok ? null : r.refusal;
};
const date = (t: string, direction: 'next' | 'last' = 'next', today = '2026-10-28') => {
  const r = whole(t, { field: 'date', today, direction });
  return r.ok && r.field === 'date' ? r.day : r.ok ? null : r.refusal;
};

// EX2's key for Devanagari spellings outside the two independent 1–100 lists: each variant and the spelling it is.
const DEVANAGARI_KEY = `छः छह · छे छह · छ छह · अट्ठारह अठारह · सताईस सत्ताईस · अठाईस अट्ठाईस · उन्तीस उनतीस · इकत्तीस इकतीस ·
तेंतीस तैंतीस · तेतीस तैंतीस · चौतीस चौंतीस · पेंतीस पैंतीस · सेंतीस सैंतीस · उन्तालीस उनतालीस · बियालीस बयालीस · तेंतालीस तैंतालीस ·
चव्वालीस चौवालीस · पेंतालीस पैंतालीस · छयालीस छियालीस · सेंतालीस सैंतालीस · उन्चास उनचास · इकावन इक्यावन · तरेपन तिरेपन ·
चव्वन चौवन · सतावन सत्तावन · अठावन अट्ठावन · उन्सठ उनसठ · तरेसठ तिरेसठ · चौसठ चौंसठ · पेंसठ पैंसठ · छयासठ छियासठ ·
सरसठ सड़सठ · छियत्तर छिहत्तर · सत्तत्तर सतहत्तर · उनयासी उनासी · बिरासी बयासी · तिरयासी तिरासी · सतासी सत्तासी ·
अठासी अट्ठासी · बयानवे बानबे · तिरान्वे तिरानबे · पंचानवे पंचानबे · पचानबे पंचानबे`;
// EX2's key for Hindi in Latin letters: each romanised word and the Devanagari word it spells.
const LATIN_KEY = `shunya शून्य · ek एक · do दो · teen तीन · chaar चार · paanch पाँच · panch पाँच · chhah छह · chhe छे · chheh छह ·
saat सात · aath आठ · nau नौ · das दस · dus दस · gyarah ग्यारह · barah बारह · terah तेरह · chaudah चौदह · chaudha चौदह ·
pandrah पन्द्रह · pandhra पन्द्रह · solah सोलह · satrah सत्रह · atharah अठारह · unnis उन्नीस · bees बीस · ikkis इक्कीस ·
baais बाईस · teis तेईस · teyis तेईस · chaubis चौबीस · chobis चौबीस · pachchis पच्चीस · chhabbis छब्बीस · sattais सत्ताईस ·
atthais अट्ठाईस · untis उनतीस · unatis उनतीस · tees तीस · iktis इकतीस · ikattis इकत्तीस · battis बत्तीस · taintis तैंतीस ·
tetis तेतीस · tentis तेंतीस · chauntis चौंतीस · chautis चौतीस · chontis चौंतीस · paintis पैंतीस · pentis पेंतीस · chhattis छत्तीस ·
saintis सैंतीस · sentis सेंतीस · adtis अड़तीस · artis अड़तीस · untalis उनतालीस · unchalis उनतालीस · chalis चालीस ·
iktalis इकतालीस · ikatalis इकतालीस · bayalis बयालीस · bialis बियालीस · biyalis बियालीस · taintalis तैंतालीस · tentalis तेंतालीस ·
chavalis चवालीस · chauvalis चौवालीस · chaualis चौवालीस · paintalis पैंतालीस · pentalis पेंतालीस · chhiyalis छियालीस ·
chhayalis छयालीस · chhialis छियालीस · saintalis सैंतालीस · sentalis सेंतालीस · adtalis अड़तालीस · artalis अड़तालीस ·
unchas उनचास · pachaas पचास · ikyavan इक्यावन · ikkyavan इक्यावन · bavan बावन · tirpan तिरपन · tirepan तिरेपन · tarepan तरेपन ·
chauvan चौवन · chavvan चव्वन · pachpan पचपन · chhappan छप्पन · sattavan सत्तावन · atthavan अट्ठावन · unsath उनसठ · saath साठ ·
iksath इकसठ · ikasath इकसठ · basath बासठ · tirsath तिरसठ · tiresath तिरेसठ · taresath तरेसठ · chausath चौंसठ ·
chaunsath चौंसठ · chonsath चौंसठ · chosath चौसठ · painsath पैंसठ · pensath पेंसठ · chhiyasath छियासठ · chhayasath छयासठ ·
sadsath सड़सठ · sarsath सरसठ · adsath अड़सठ · arsath अड़सठ · unhattar उनहत्तर · sattar सत्तर · ikhattar इकहत्तर ·
ikahattar इकहत्तर · bahattar बहत्तर · behattar बहत्तर · tihattar तिहत्तर · tehattar तिहत्तर · chauhattar चौहत्तर ·
chohattar चौहत्तर · pachhattar पचहत्तर · chhihattar छिहत्तर · chhiyattar छियत्तर · sathattar सतहत्तर · satattar सत्तत्तर ·
athhattar अठहत्तर · unasi उनासी · unyasi उन्यासी · assi अस्सी · ikyasi इक्यासी · bayasi बयासी · biyasi बयासी · birasi बिरासी ·
tirasi तिरासी · chaurasi चौरासी · chorasi चौरासी · pachasi पचासी · chhiyasi छियासी · sattasi सत्तासी · atthasi अट्ठासी ·
navasi नवासी · nabbe नब्बे · ikyanave इक्यानवे · ikyanabe इक्यानबे · ikyanbe इक्यानबे · ikyanve इक्यानवे · banave बानवे ·
banabe बानबे · banbe बानबे · banve बानवे · bayanave बयानवे · tiranave तिरानवे · tiranabe तिरानबे · tiranbe तिरानबे ·
tiranve तिरान्वे · chauranave चौरानवे · chauranabe चौरानबे · chauranbe चौरानबे · chauranve चौरानवे · pachanave पचानवे ·
panchanave पंचानवे · pachanabe पचानबे · panchanabe पंचानबे · panchanbe पंचानबे · pachanve पचानवे · panchanve पंचानवे ·
chhiyanave छियानवे · chhiyanabe छियानबे · chhiyanbe छियानबे · chhiyanve छियानवे · sattanave सत्तानवे · sattanabe सत्तानबे ·
sattanbe सत्तानबे · sattanve सत्तानवे · atthanave अट्ठानवे · atthanabe अट्ठानबे · atthanbe अट्ठानबे · atthanve अट्ठानवे ·
ninyanave निन्यानवे · ninyanabe निन्यानबे · ninyanbe निन्यानबे · ninyanve निन्यानवे`;
const pairs = (key: string) => new Map(key.split('·').map((p) => p.trim().split(' ') as [string, string]));
const DEVANAGARI = pairs(DEVANAGARI_KEY);
const LATIN = pairs(LATIN_KEY);
// The value of a Devanagari spelling: its place in ICU's list or the review's, or (through the key) its standard spelling's.
const valueOfSpelling = (w: string): number | undefined => {
  if (w === CLDR_HI_SCALES[0]) return 0;
  const at = CLDR_HI.indexOf(w) + 1 || REVIEW_HI.indexOf(w) + 1;
  return at || (DEVANAGARI.has(w) ? valueOfSpelling(DEVANAGARI.get(w) as string) : undefined);
};
// Words the detector refuses that the parser reads as scales, or does not read at all (a hundred-lot, 10^9, 10^11).
const SCALES = ['सौ', 'हज़ार', 'लाख', 'करोड़', 'sau', 'hazaar', 'lakh', 'laakh', 'karod', 'karor'];
const UNREAD = ['सैकड़ा', 'अरब', 'खरब', 'sainkda', 'saikda', 'arab', 'kharab'];

it("EX2 every Hindi cardinal the detector lists reads to its value in the hand-written key and ICU's Hindi numerals", () => {
  const wrong: string[] = [];
  const check = (w: string, want: number | undefined) => {
    if (want === undefined || count(w) !== want) wrong.push(`${w}: read ${count(w)}, key ${want}`);
  };
  for (const [i, w] of CLDR_HI.entries()) check(w, i + 1); // "एक सौ" is 100
  for (const [i, w] of CLDR_HI_SCALES.entries()) check(w, [0, 1000, 100_000, 10_000_000][i]);
  for (const [i, w] of REVIEW_HI.entries()) check(w, i + 1);
  const deva = HINDI_CARDINALS.filter((w) => !SCALES.includes(w) && !UNREAD.includes(w));
  const latin = HINDI_LATIN_CARDINALS.filter((w) => !SCALES.includes(w) && !UNREAD.includes(w));
  for (const w of deva) check(w, valueOfSpelling(w));
  for (const w of latin) check(w, LATIN.has(w) ? valueOfSpelling(LATIN.get(w) as string) : undefined);
  for (const w of [...SCALES, ...UNREAD]) expect(HINDI_CARDINALS.includes(w) || HINDI_LATIN_CARDINALS.includes(w), w).toBe(true);
  for (const w of UNREAD) expect(count(w), w).toBe('unreadable');
  // The parser's own table holds exactly these spellings: none unchecked, none the detector does not refuse.
  const table = SPAN_HINDI.trim().split('\n').flatMap((l) => l.split(' ').slice(1));
  expect(new Set(table)).toEqual(new Set([...deva, ...latin]));
  const checked = CLDR_HI.length + CLDR_HI_SCALES.length + REVIEW_HI.length + deva.length + latin.length;
  console.log(`EX2 ${checked} Hindi spellings read against the key (${deva.length} Devanagari, ${latin.length} Latin)`);
  expect(deva.length).toBeGreaterThan(150);
  expect(latin.length).toBeGreaterThan(150);
  expect(wrong).toEqual([]);
});

it('EX2 compositions, English, digits and rupee forms read to the hand-written key', () => {
  const counts: [string, number][] = [
    ['paanch sau', 500], ['dhai hazaar', 2500], ['डेढ़ सौ', 150], ['ढाई सौ', 250], ['sava sau', 125], ['सवा दो सौ', 225],
    ['paune do sau', 175], ['पौने सौ', 75], ['saadhe teen sau', 350], ['साढ़े तीन हज़ार', 3500], ['unnis sau', 1900],
    ['बारह सौ पचास', 1250], ['ek lakh pachchis hazaar', 125_000], ['do lakh pachaas hazaar paanch sau', 250_500],
    ['एक करोड़', 10_000_000], ['teen karod', 30_000_000], ['do hazaar aur paanch sau', 2500], ['sau', 100], ['hazaar', 1000],
    ['laakh', 100_000], ['dhai lakh', 250_000], ['sava do lakh', 225_000], ['one hundred and fifty', 150], ['twenty-five thousand', 25_000],
    ['twenty five', 25], ['two thousand five hundred', 2500], ['five lakhs', 500_000], ['twelve hundred', 1200], ['zero', 0],
    ['nineteen', 19], ['ninety nine', 99], ['500', 500], ['0500', 500], ['1,500', 1500], ['1,23,456', 123_456], ['123,456', 123_456],
    ['12,34,567', 1_234_567], ['५००', 500], ['१,२५०', 1250], ['৫০০', 500], ['੫੦੦', 500], ['૫૦૦', 500], ['௫௦௦', 500], ['５００', 500],
  ];
  const amounts: [string, number][] = [
    ['₹500', 50_000], ['₹ 500', 50_000], ['Rs 1,500', 150_000], ['Rs.500', 50_000], ['rs. 500', 50_000], ['INR 2,50,000', 25_000_000],
    ['₨500', 50_000], ['रु 500', 50_000], ['रु. 500', 50_000], ['500 rupaye', 50_000], ['500 rupees', 50_000], ['500 रुपये', 50_000],
    ['500 रुपए', 50_000], ['500rs', 50_000], ['1,23,456.50', 12_345_650], ['19.99', 1999], ['19.9', 1990], ['₹१,२५०', 125_000],
    ['paanch sau rupaye', 50_000], ['Rs. paanch sau', 50_000], ['hazaar rupaye', 100_000], ['ढाई सौ रुपये', 25_000], ['dedh', 150],
    ['saadhe teen', 350], ['dhai', 250], ['paune ek', 75],
  ];
  const got = [...counts.map(([t]) => count(t)), ...amounts.map(([t]) => paise(t))];
  expect(got).toEqual([...counts.map(([, n]) => n), ...amounts.map(([, n]) => n)]);
  // A pure digit span is the database's to re-read (0016); words are core's alone.
  expect(whole('₹1,500', { field: 'amount' })).toMatchObject({ ok: true, parsedAs: 'digits' });
  expect(whole('paanch sau', { field: 'amount' })).toMatchObject({ ok: true, parsedAs: 'words' });
  for (const zero of DIGIT_ZEROS) {
    const five = String.fromCodePoint(zero + 5, zero, zero);
    expect([...Array(10).keys()].every((d) => /\p{Nd}/u.test(String.fromCodePoint(zero + d))), zero.toString(16)).toBe(true);
    expect(count(five), zero.toString(16)).toBe(500);
  }
  console.log(`EX2 ${counts.length + amounts.length} compositions and digit forms, ${DIGIT_ZEROS.length} digit scripts`);
  // Offsets count code points, as Postgres does: the emoji before the figure is one character, not two.
  const said = '😀 ₹500 दे दिए';
  expect(readSpan(said, { start: 2, end: 6 }, { field: 'amount' })).toMatchObject({ ok: true, minor: 50_000 });
});

it("EX2 the span parser refuses what it cannot read, with the reason, and never guesses: 'बीस प्रतिशत' and '1,5' among them", () => {
  const refusals: [string, string, SpanAsk['field']?][] = [
    ['बीस प्रतिशत', 'percent'], ['20%', 'percent'], ['20 percent', 'percent'], ['bees fisadi', 'percent'], ['das per cent', 'percent'],
    ['1,5', 'grouping'], ['12,34', 'grouping'], ['1,234,56', 'grouping'], ['1,23,4567', 'grouping'], ['1,5', 'grouping', 'amount'],
    ['1२3', 'mixed_script'], ['5०0', 'mixed_script', 'amount'], ['₹5.505', 'decimals', 'amount'], ['2.5', 'not_whole'], ['5.00', 'not_whole'],
    ['dedh', 'not_whole'], ['saadhe teen', 'not_whole'], ['₹500', 'unreadable'], ['500 rupaye', 'unreadable'], ['500 paise', 'unreadable', 'amount'],
    ['$500', 'unreadable', 'amount'], ['500 dollars', 'unreadable', 'amount'], ['5 hazaar', 'unreadable'], ['₹5 lakh', 'unreadable', 'amount'],
    ['5²', 'unreadable'], ['²', 'unreadable'], ['๕๐๐', 'unreadable'], ['𝟓𝟎𝟎', 'unreadable'], ['five million', 'unreadable'], ['do arab', 'unreadable'],
    ['fivety', 'unreadable'], ['half', 'unreadable'], ['aadha', 'unreadable'], ['double', 'unreadable'], ['a hundred', 'unreadable'],
    ['do aur teen', 'unreadable'], ['bees paanch', 'unreadable'], ['ek hazaar barah sau', 'unreadable'], ['sau hazaar', 'unreadable'],
    ['saadhe sau', 'unreadable'], ['shunya sau', 'unreadable'], ['sau shunya', 'unreadable'], ['and paanch', 'unreadable'],
    ['paanch and', 'unreadable'], ['twenty fifteen', 'unreadable'], ['-500', 'unreadable'], ['5.', 'unreadable'], ['.5', 'unreadable'],
    ['5 00', 'unreadable'], ['5‍00', 'unreadable'], ['   ', 'unreadable'], ['teen packet', 'unreadable'],
  ];
  const got = refusals.map(([t, , field]) => {
    const r = whole(t, { field: field ?? 'quantity' } as SpanAsk);
    return r.ok ? `read ${JSON.stringify(r)}` : r.refusal;
  });
  expect(got).toEqual(refusals.map(([, why]) => why));
  const span = (start: number, end: number) => readSpan('paanch sau', { start, end }, { field: 'amount' });
  expect([span(3, 3), span(5, 2), span(-1, 4), span(0, 11), span(0.5, 4)].map((r) => (r.ok ? 'read' : r.refusal))).toEqual(Array(5).fill('bad_span'));
});

it('EX2 date words and forms read to the hand-written key, from Wednesday 28 Oct 2026', () => {
  const next: [string, string][] = [
    ['aaj', '2026-10-28'], ['आज', '2026-10-28'], ['today', '2026-10-28'], ['kal', '2026-10-29'], ['कल', '2026-10-29'],
    ['parson', '2026-10-30'], ['परसों', '2026-10-30'], ['tomorrow', '2026-10-29'], ['yesterday', '2026-10-27'],
    ['3 Nov', '2026-11-03'], ['Nov 3', '2026-11-03'], ['03 nov', '2026-11-03'], ['३ नवंबर', '2026-11-03'], ['3 नवम्बर', '2026-11-03'],
    ['28 Oct', '2026-10-28'], ['27 Oct', '2027-10-27'], ['3 November 2026', '2026-11-03'], ['29 Feb 2028', '2028-02-29'],
    ['15 फ़रवरी', '2027-02-15'],
  ];
  const last: [string, string][] = [['kal', '2026-10-27'], ['parson', '2026-10-26'], ['3 Nov', '2025-11-03'], ['27 Oct', '2026-10-27'], ['28 Oct', '2026-10-28']];
  const weekdays: [string, string, string][] = [
    ['sunday ravivaar itvaar raviwar itwar रविवार इतवार', '2026-11-01', '2026-10-25'],
    ['monday somvaar somwar सोमवार', '2026-11-02', '2026-10-26'],
    ['tuesday mangalvaar mangalwar मंगलवार', '2026-11-03', '2026-10-27'],
    ['thursday guruvaar guruwar brihaspativaar veervaar गुरुवार बृहस्पतिवार वीरवार', '2026-10-29', '2026-10-22'],
    ['friday shukravaar shukrawar शुक्रवार', '2026-10-30', '2026-10-23'],
    ['saturday shanivaar shaniwar शनिवार', '2026-10-31', '2026-10-24'],
  ];
  const months: [string, number][] = [
    ['january jan जनवरी', 1], ['february feb फ़रवरी फरवरी', 2], ['march mar मार्च', 3], ['april apr अप्रैल', 4], ['may मई', 5],
    ['june jun जून', 6], ['july jul जुलाई', 7], ['august aug अगस्त', 8], ['september sep sept सितंबर सितम्बर', 9],
    ['october oct अक्टूबर अक्तूबर', 10], ['november nov नवंबर नवम्बर', 11], ['december dec दिसंबर दिसम्बर', 12],
  ];
  const want: string[] = [];
  const got: string[] = [];
  const check = (t: string, direction: 'next' | 'last', day: string) => {
    want.push(`${t} ${direction} ${day}`);
    got.push(`${t} ${direction} ${date(t, direction)}`);
  };
  for (const [t, day] of next) check(t, 'next', day);
  for (const [t, day] of last) check(t, 'last', day);
  for (const [words, ahead, before] of weekdays) {
    for (const w of words.split(' ')) {
      check(w, 'next', ahead);
      check(w, 'last', before);
    }
  }
  // The 15th of each month: the next one is this year from November, the last one is last year from November.
  for (const [words, m] of months) {
    for (const w of words.split(' ')) {
      check(`15 ${w}`, 'next', `${m >= 11 ? 2026 : 2027}-${String(m).padStart(2, '0')}-15`);
      check(`15 ${w}`, 'last', `${m >= 11 ? 2025 : 2026}-${String(m).padStart(2, '0')}-15`);
    }
  }
  // Refused: the weekday it is today (this one or the next?), dates that do not exist, forms not listed.
  for (const t of ['wednesday', 'budhvaar', 'बुधवार']) {
    for (const d of ['next', 'last'] as const) {
      want.push(`${t} ${d} ambiguous`);
      got.push(`${t} ${d} ${date(t, d)}`);
    }
  }
  for (const t of ['29 Feb', '30 Feb', '31 Nov', '0 Nov', '32 Oct', '3rd Nov', '3/11', 'agle shanivaar', 'agle hafte', 'Nov', '3', 'sat', 'kal subah', '3 Nov 26', '१२३ Nov']) {
    want.push(`${t} unreadable`);
    got.push(`${t} ${date(t)}`);
  }
  console.log(`EX2 ${want.length} date forms read against the key`);
  expect(want.length).toBeGreaterThan(150);
  expect(got).toEqual(want);
});

it('EX2 every word the parser reads as a number is one the detector refuses in prose', () => {
  const words = [
    ...SPAN_HINDI.trim().split('\n').flatMap((l) => l.split(' ').slice(1)),
    ...SPAN_ENGLISH_UNITS.split(' '),
    ...SPAN_ENGLISH_TENS.split(' '),
    ...[...SPAN_SCALES, ...SPAN_WHOLES, ...SPAN_ADDS].map(([w]) => w),
  ];
  expect(words.length).toBeGreaterThan(300);
  expect(words.filter((w) => !textRules(w).includes('number_word'))).toEqual([]);
});
