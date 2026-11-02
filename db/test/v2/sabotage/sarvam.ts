// Red-proofs of W2-C, Sarvam through the provider layer: the speak role (packages/agent/test/sarvam.test.ts, and read
// aloud in the app, apps/web/test/speak.test.tsx), Saaras's language detection, a PDF bill read by Sarvam Vision
// (packages/agent/test/sarvam.test.ts, apps/web/test/hero-bill.test.tsx), core's allow on every media call
// (packages/agent/test/media-allow.test.ts) and the Ask answers' 30-day purge (test/v2/core/jobs/ask-words.test.ts).
// Each breaks one protection.
import type { Case } from './case.ts';

const SPEAK_TS = 'packages/agent/src/providers/sarvam-speak.ts';
const DOCS_TS = 'packages/agent/src/providers/sarvam-docs.ts';
const BILL_TS = 'packages/agent/src/bill.ts';
const PHOTO_TS = 'packages/agent/src/photo.ts';
// packages/agent's own config may not import db (B1), so its cases run under db's agent config, as packages.ts's do.
const inAgent =
  (file: string) =>
  (sabotage: string, test: string, source: string, from: string, to: string): Case => ({
    sabotage,
    file,
    test,
    dir: 'packages/agent',
    config: '../../db/test/v2/agent.vitest.config.ts',
    ts: { file: source, from, to },
  });
const agent = inAgent('test/sarvam.test.ts');
const media = inAgent('test/media-allow.test.ts');
const web = (sabotage: string, test: string, testFile: string, file: string, from: string, to: string): Case => ({
  sabotage,
  file: testFile,
  test,
  dir: 'apps/web',
  config: 'vitest.config.ts',
  ts: { file, from, to },
});
const SPEAK_WEB = 'test/speak.test.tsx';
const BILL_WEB = 'test/hero-bill.test.tsx';

const SPLIT = 'SPEAK3 a text over the request limit goes as pieces cut at sentence ends, each allowed first; a refusal stops it';
const ALLOWED = "SPEAK4 a speak call is asked of core's allow as role speak (a media call), before any request";
const NO_KEY = 'SPEAK5 a missing Sarvam key fails the call by name (no_key), before any request, as a result, not a throw';
const CHAIN = "SPEAK8 the speak desk's chain decides: an empty one (none allowed) is off before any call; else its first alias answers";
const CUT = 'SPEAK9 a cut never falls inside a figure: not at a decimal point at the limit, nor inside digits or a placeholder';
const RECORDED = 'SPEAK6 recorded mode replays what record mode wrote, with no network call; with no fixture it fails, still offline';
const DETECT = 'VOICE1 with no bias it asks Sarvam to detect (unknown), and the language it heard comes back through askByVoice';
const DOC_ONLY = 'DOC2 sarvam-vision is a document reader only: never in a chain, a picker, the allow-list, or an image call';
const DOC_SPANS = 'DOC4 a figure not in the block it names, or a block with no place, refuses the whole bill: nothing is recorded';
const DOC_RECORDED = 'DOC5 recorded mode reads the PDF bill from what record mode wrote, with no network call';
const DOC_TOKENS = 'DOC6 a figure is held only as a whole token of its block: 4 inside 24, 50 inside ₹8.50 and a zero are refused';
const DOC_DATE = "DOC7 the bill's date is read on the page as a whole token and a calendar day; else the bill is kept with no date";
const DOC_PARTLY = 'DOC8 a document Sarvam Vision read only in part is refused as partly read: nothing recorded, no reason call';
const DOC_POST = "DOC9 the job's POST is sent once, never retried; a result of more pages than Sarvam Vision's cap is refused";
const DOC_KEY = 'DOC10 a PDF with no Sarvam key fails by name (no_key) before any call is counted or made';
const M_VISION = "MEDIA1 a bill photo's vision call asks allow first: refused, the bill is refused as ai_off and nothing is sent";
const M_KEY = 'MEDIA2 with no key for the vision model, a photo fails by name (no_key) before allow is asked';
const M_SEGMENT = 'MEDIA3 each segment call asks allow (segment): refused, the item is uncounted as ai_off and no segment call is made';
const M_VOICE = 'MEDIA4 a voice note asks allow (voice) after the audio and the key are checked: refused, it abstains with no call';
const PURGE = "ASKWORDS1 the purge erases an Ask answer's words after 30 days, keeps a recent one's and a brief line's, and keeps every answer row";
const W_CHECKED = "SPEAKW1 the stored, checked answer is read as the turn shows it, and voiced in a speak run that is the member's";
const W_REFUSED = 'SPEAKW2 an id the member cannot see, or that names nothing checked, is refused before any run or call';
const W_NO_KEY = 'SPEAKW5 live with no Sarvam key, the call fails by name (no_key): no request, no call counted, no crash';
const W_RECORDED = 'SPEAKW6 recorded mode replays the stored clip with no network call';
const W_MEDIA = "SPEAKW7 a speak call is a media call: once the shop's media calls are spent, it is refused as off";
const W_ONE = 'SPEAKW8 one clip at a time in the app: starting one stops the other; a reply that lands after unmount never plays';
const WORDS = 'SPEAKWORDS the read-aloud words carry no digit, and the English ones no Devanagari';
const PDF = 'PDFBILL1 a PDF reads to a purchase draft, each figure read on its page; the books change only once it is approved';
const PICKER = 'PDFBILL2 the bill photo picker takes a PDF';
const CAP = "MEDIACAP1 once the shop's media calls are spent, a bill photo and a PDF bill are refused as ai_off: no read, nothing stored";
const STAFF = 'AISTAFF1 the owner sees every desk with its model and a picker of the allowed aliases, and picks one as their own row';

export const SARVAM_CASES: Case[] = [
  // ---- the speak adapter and flow (packages/agent) -------------------------------------------------------------------
  // No splitting: a text over Bulbul's limit goes as one request.
  agent('v2-sarvam-speak-no-split', SPLIT, SPEAK_TS, '  while (rest.length > max) {', '  while (rest.length > max * 100) {'),
  // A sentence end judged on the slice: "₹8." at the limit counts as one, and the figure is cut in two.
  agent(
    'v2-sarvam-speak-cut-at-point',
    CUT,
    SPEAK_TS,
    '    const reach = rest.slice(0, max + 1);\n    let cut = -1;\n    for (const m of reach.matchAll(/[.?!।](?=\\s)/g))',
    '    const reach = rest.slice(0, max);\n    let cut = -1;\n    for (const m of reach.matchAll(/[.?!।](?=\\s|$)/g))',
  ),
  // The hard cut left where it falls: inside a run of digits, or inside a placeholder.
  agent('v2-sarvam-speak-cut-in-digits', CUT, SPEAK_TS, '    if (cut <= 0) cut = safeCut(rest, max) || max;', '    if (cut <= 0) cut = max;'),
  // Allow skipped: a speak call goes out uncounted, past the shop's caps.
  agent('v2-sarvam-speak-allow-skipped', ALLOWED, SPEAK_TS, '    await allowCall(beforeEach);', '    void beforeEach;'),
  // The key checked only inside the request: a call is counted against the caps before failing for want of a key.
  agent('v2-sarvam-speak-key-late', NO_KEY, 'packages/agent/src/providers/speech.ts', '  requireKey(b.provider, d);', '  void b;'),
  // The speak desk's chain ignored: a desk the platform allows no model still calls one.
  agent('v2-sarvam-speak-chain-ignored', CHAIN, 'packages/agent/src/speak.ts', '    if (o.port.models) {', '    if (false) {'),
  // Recorded mode bypassed: a replay reaches the network.
  agent('v2-sarvam-speak-recorded-live', RECORDED, SPEAK_TS, '  return viaFixture<Raw>(mode, d.fixturesDir', '  return viaFixture<Raw>("live", d.fixturesDir'),
  // ---- voice: Saaras's detection ---------------------------------------------------------------------------------------
  // No detection asked: with no bias, no language code is sent.
  agent('v2-sarvam-voice-no-detect', DETECT, 'packages/agent/src/providers/sarvam-voice.ts', '|| "unknown");', '|| "");'),
  // The detected language dropped on the way back.
  agent('v2-sarvam-voice-language-dropped', DETECT, 'packages/agent/src/voice.ts', '    language = heard.language && CODE.test(heard.language) ? heard.language : null;', '    language = null;'),
  // ---- the document reader and a PDF bill (packages/agent) -------------------------------------------------------------
  // The document reader let into chains, pickers and the allow-list: an image call could go to it.
  agent('v2-sarvam-vision-in-chains', DOC_ONLY, 'packages/agent/src/models.ts', '.filter(([, m]) => !m.documents));', '.filter(() => true));'),
  // A span's text matched as a substring of its block: "4" inside "24" and "50" inside "₹8.50" are taken.
  agent('v2-sarvam-doc-span-substring', DOC_TOKENS, BILL_TS, '    return b && heldAsToken(b.shown, s.text) ? {', '    return b && b.shown.includes(s.text) ? {'),
  // A zero rate kept: a line priced at nothing goes to the draft.
  agent('v2-sarvam-doc-zero-rate', DOC_TOKENS, BILL_TS, 'unitCostMinor === null || unitCostMinor === 0 || !item.text.trim()', 'unitCostMinor === null || !item.text.trim()'),
  // A figure with no place on the page kept: the bill is recorded unplaced.
  agent('v2-sarvam-doc-unplaced-kept', DOC_SPANS, BILL_TS, '    if (!qty.at || !rate.at) return refuse("unplaced");\n', ''),
  // The model's date taken as given: never checked against the block it names.
  agent('v2-sarvam-doc-date-unchecked', DOC_DATE, BILL_TS, '  const billDate = dateSpan ? printedDate(dateSpan.text) : null;', '  const billDate = bill.billDate ? printedDate(bill.billDate.text) : null;'),
  // A document read only in part drafted as if whole.
  agent('v2-sarvam-doc-partly-drafted', DOC_PARTLY, BILL_TS, '  if (!doc.complete) return refuse("partly_read");\n', ''),
  // The job's POST retried: a second job is started (and billed) on a 5xx.
  agent(
    'v2-sarvam-doc-post-retried',
    DOC_POST,
    DOCS_TS,
    '      job = await once("/doc-ai/v1/job/parse", { method: "POST", body: form });',
    '      job = await withRetry(() => once("/doc-ai/v1/job/parse", { method: "POST", body: form }), d, signal);',
  ),
  // No bound on the pages a result may bring back.
  agent('v2-sarvam-doc-pages-unbounded', DOC_POST, DOCS_TS, '    if (given.length > MAX_PAGES) throw', '    if (false) throw'),
  // The document reader's key not checked first: allow counts a call that then fails for want of a key.
  agent('v2-sarvam-doc-key-late', DOC_KEY, BILL_TS, 'refusedBeforeCall(o, "vision", documentBinding().provider);', 'refusedBeforeCall(o, "vision", "meta");'),
  // Recorded mode bypassed for documents.
  agent('v2-sarvam-doc-recorded-live', DOC_RECORDED, DOCS_TS, '  const raw = await viaFixture<Raw>(mode, d.fixturesDir', '  const raw = await viaFixture<Raw>("live", d.fixturesDir'),
  // ---- core's allow on every media call (packages/agent) --------------------------------------------------------------
  // A photo's vision call made without allow: AI off and the media caps do not hold for photos.
  media('v2-media-vision-allow-skipped', M_VISION, PHOTO_TS, '  if (o.port.allow && !(await o.port.allow(role))) {', '  if (false) {'),
  // The key not checked before allow: a call is counted, then fails for want of a key.
  media('v2-media-key-after-allow', M_KEY, PHOTO_TS, '    requireKey(provider ?? resolveBinding(role, o.deps ?? {}).provider, o.deps ?? {});', '    void provider;'),
  // Each segment call made without allow.
  media('v2-media-segment-allow-skipped', M_SEGMENT, 'packages/agent/src/providers/meta-sam.ts', '  await allowCall(beforeCall);', '  void beforeCall;'),
  // A voice note transcribed without allow.
  media('v2-media-voice-allow-skipped', M_VOICE, 'packages/agent/src/providers/transcribe.ts', '  await allowCall(beforeCall);', '  void beforeCall;'),
  // ---- the Ask answers' 30-day purge (db, core's jobs) ----------------------------------------------------------------
  // The purge erases nothing: an Ask answer's words are kept past 30 days.
  {
    sabotage: 'v2-ask-words-kept',
    file: 'test/v2/core/jobs/ask-words.test.ts',
    test: PURGE,
    config: 'vitest.v2.config.ts',
    ts: { file: 'packages/core/src/jobs-core.ts', from: '            where t.erased_at is null\n', to: '            where false and t.erased_at is null\n' },
  },
  // ---- read aloud in the app (apps/web) --------------------------------------------------------------------------------
  // The model's stored words read as they are, not as the screen shows them: handles and unchecked words are voiced.
  web('v2-speak-unrendered', W_CHECKED, SPEAK_WEB, 'apps/web/lib/server/speak.ts', '        partsOf(seg, snapshots)\n', '        [{ t: "text" as const, v: seg.text }]\n'),
  // Another member's answer readable: the asker check dropped.
  web('v2-speak-any-members-answer', W_REFUSED, SPEAK_WEB, 'apps/web/lib/server/speak.ts', 'and r.started_by = $2 and', 'and $2::uuid is not null and'),
  // Counter staff hear the office's brief.
  web('v2-speak-staff-brief', W_REFUSED, SPEAK_WEB, 'apps/web/lib/server/speak.ts', 'data.member.role === "staff" ? undefined :', 'false ? undefined :'),
  // The run started before the id is checked: a refused id still opens a speak run.
  web(
    'v2-speak-run-before-check',
    W_REFUSED,
    SPEAK_WEB,
    'apps/web/lib/server/speak.ts',
    '  if (!text) return { error: "not_found" };\n  const run = await startRun(session, "speak");',
    '  const run = await startRun(session, "speak");\n  if (!text) return { error: "not_found" };',
  ),
  // A missing key thrown, not answered: the page gets an error, not "no_key".
  web('v2-speak-no-key-thrown', W_NO_KEY, SPEAK_WEB, 'packages/agent/src/speak.ts', '    if (!(err instanceof ModelError)) throw err;', '    throw err;'),
  // Recorded mode bypassed in the app: a replay reaches the network.
  web('v2-speak-web-recorded-live', W_RECORDED, SPEAK_WEB, SPEAK_TS, '  return viaFixture<Raw>(mode, d.fixturesDir', '  return viaFixture<Raw>("live", d.fixturesDir'),
  // Speak counted as a text call: it passes once the media calls are spent.
  web('v2-speak-not-media', W_MEDIA, SPEAK_WEB, 'packages/core/src/allow.ts', "export const MEDIA_ROLES = ['vision', 'segment', 'voice', 'speak'] as const;", "export const MEDIA_ROLES = ['vision', 'segment', 'voice'] as const;"),
  // Two clips at once: starting one leaves the other playing.
  web('v2-readaloud-two-at-once', W_ONE, SPEAK_WEB, 'apps/web/components/ReadAloud.tsx', '    current?.stop();\n', ''),
  // A reply that lands after the button is gone still plays.
  web('v2-readaloud-plays-after-unmount', W_ONE, SPEAK_WEB, 'apps/web/components/ReadAloud.tsx', '    if (mine !== ticket.current) return; // stopped, replaced or unmounted meanwhile\n', ''),
  // No speak alias on the allow-list: the speak desk has no model.
  web(
    'v2-speak-not-allowed',
    STAFF,
    'test/ai-staff.test.tsx',
    'packages/agent/src/config.ts',
    '    .flatMap(([alias, m]) => m.roles.map((role) => ({ alias, role })));',
    '    .flatMap(([alias, m]) => m.roles.filter((r) => r !== "speak").map((role) => ({ alias, role })));',
  ),
  // A digit typed into the words, and Devanagari into the English ones.
  web('v2-speak-words-digit', WORDS, 'test/i18n-speak.test.ts', 'apps/web/lib/i18n-speak.ts', '  stop: "Stop reading",', '  stop: "Stop reading 2",'),
  web('v2-speak-words-devanagari', WORDS, 'test/i18n-speak.test.ts', 'apps/web/lib/i18n-speak.ts', '  stop: "Stop reading",', '  stop: "Stop पढ़ना",'),
  // ---- a PDF bill in the app (apps/web) --------------------------------------------------------------------------------
  // A PDF not routed to the document reader: it is refused as not a photo.
  web('v2-pdfbill-not-routed', PDF, BILL_WEB, BILL_TS, '  if (isPdf(photo)) return readBillDocument(photo, o, refuse);', '  if (false) return readBillDocument(photo, o, refuse);'),
  // The read draft applied at once, as the person who sent the PDF: the books change before anyone approves.
  web(
    'v2-pdfbill-auto-applied',
    PDF,
    BILL_WEB,
    'apps/web/app/app/bills/photo-actions.ts',
    '    return { result, snapshots, recorded: recordedMode() };',
    '    if (result.kind === "read" && result.draft) { const f = new FormData(); f.set("draft", result.draft.id); f.set("verdict", "approved"); await (await import("../hero-actions")).decidePhotoDraft(null, f); }\n    return { result, snapshots, recorded: recordedMode() };',
  ),
  // The picker no longer offers a PDF.
  web('v2-pdfbill-picker-no-pdf', PICKER, BILL_WEB, 'apps/web/components/BillPhoto.tsx', '          accept="image/png,image/jpeg,application/pdf"\n', ''),
  // A bill's photo and PDF read past the shop's spent media calls: allow skipped for photo flows, on the app's real port.
  web('v2-mediacap-allow-skipped', CAP, BILL_WEB, PHOTO_TS, '  if (o.port.allow && !(await o.port.allow(role))) {', '  if (false) {'),
];
