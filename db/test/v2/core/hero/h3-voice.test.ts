// H3: ask by voice (MS-8). The voice model transcribes a spoken question (Hindi or English, synthetic clips made with
// macOS `say`), and the transcript is asked like a typed question (run.ts `ask`): the answer's numbers are cells this run
// minted, or it abstains. The transcript is untrusted user text and never rides in a trace.
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { CheckedSegment } from '../../../../../packages/agent/src/answer.ts';
import { askByVoice } from '../../../../../packages/agent/src/voice.ts';
import { prepare, scripted, type Turn } from '../../../../../packages/agent/test/script.ts';
import { openTestDb, type TestDb } from '../../db.ts';
import { type Shop, smallShop } from '../shop.ts';
import { expectCleanTraces, media, photoRun } from './hero.ts';

const SUITE = 'voice';
const AS_OF = '2026-10-27';
const YESTERDAY = '2026-10-26';

let db: TestDb;
let s: Shop;
beforeAll(async () => {
  prepare(SUITE);
  db = await openTestDb();
  s = await smallShop(db.as('munshi_app'), 'H3');
  await db.sabotage();
}, 120_000);
afterAll(() => db.close());

const CLIPS = [
  { wav: 'ask-hi.wav', language: 'Hindi', transcript: 'कल काउंटर पर कितनी बिक्री हुई?', answer: '⟦1⟧ को काउंटर की कुल बिक्री ⟦2⟧ रही।' },
  { wav: 'ask-en.wav', language: 'English', transcript: 'How much did the counter take yesterday?', answer: 'On ⟦1⟧ the counter took ⟦2⟧ in all.' },
];
const turns = (c: (typeof CLIPS)[number]): Turn[] => [
  { transcript: c.transcript },
  { json: { desk: 'sales' } },
  { tools: [{ name: 'sales_by_day', args: { from: YESTERDAY, to: YESTERDAY } }] },
  { text: 'Read 1, row 0 is yesterday.' },
  { json: { segments: [{ text: c.answer, refs: ['day', 'total'].map((col) => ({ read: 1, row: 0, col })) }] } },
];

async function ask(c: (typeof CLIPS)[number]) {
  const run = await photoRun(db, s, 'question');
  const script = scripted(SUITE, turns(c));
  const out = await askByVoice(media(c.wav), { port: run.port, asOf: AS_OF, deps: script.deps, language: c.language });
  expect(script.left()).toBe(0);
  return { run, out };
}

it('H3 a spoken question, Hindi or English, is transcribed and answered from cells this run minted', async () => {
  for (const c of CLIPS) {
    const { run, out } = await ask(c);
    expect(out.transcript).toBe(c.transcript);
    expect(out.reply.kind, c.language).toBe('answer');
    const [segment] = (out.reply as { segments: CheckedSegment[] }).segments;
    expect(segment?.text).toBe(c.answer);
    expect(segment?.cells).toEqual([
      { kind: 'date', day: YESTERDAY },
      { kind: 'money', num: '0', currency: 'INR' }, // the shop sold nothing that day
    ]);
    const cited = (await db.admin.query('select run_id::text as run from snap.snapshot where id = $1', [segment?.refs[0]?.snapshotId])).rows;
    expect(cited).toEqual([{ run: run.runId }]);
  }
});

it('H3 the voice transcript never appears in a trace', async () => {
  for (const c of CLIPS) {
    const { run } = await ask(c);
    expect(run.events.map((e) => e.label)).toContain('voice');
    const words = c.transcript.replace(/[?।]/g, '').split(' ').filter((w) => w.length > 3);
    await expectCleanTraces(db, run.runId, run.events, [c.transcript, ...words]);
  }
});

it('H3 audio the voice model cannot take is not sent, and the question abstains', async () => {
  const run = await photoRun(db, s, 'question');
  const stereo = media('ask-en.wav');
  new DataView(stereo.buffer).setUint16(22, 2, true);
  const out = await askByVoice(stereo, { port: run.port, asOf: AS_OF, deps: scripted(SUITE, []).deps });
  expect(out).toEqual({ transcript: null, language: null, reply: { kind: 'abstain', specialist: null, missing: ['model_error'] } });
  expect(run.events.map((e) => [e.kind, e.label])).toEqual([
    ['model', 'model_error'],
    ['abstain', 'model_error'],
  ]);
});
