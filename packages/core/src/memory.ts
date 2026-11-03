// Memory (W2-A, 23_memory.sql): short notes the agents read as context, each written by a person with one of their own
// decisions and citing it. A note is not the books: it changes no ledger and is never executed. decide() writes one in
// the approver's own transaction when they give their words: a rejection's words are a `declined` note, an approval's a
// `preference`. The words are checked by the number grammar before any transaction opens (memory never stores a
// number; the schema refuses a digit too, as the second line), and on a live shop a person's name in them becomes their
// role ("a customer"; maskNames). Every note lists in `about` the people it concerns (the draft's customer or supplier,
// and anyone it names), and a person's erasure blanks the words of those notes and of any whose words may name them
// (mayName), taking them out of force. Forgetting is the owner's command, audited
// by the schema (memory.end).
import type pg from 'pg';
import { featureOn } from './ai-features.ts';
import { CoreError } from './errors.ts';
import { answerRules, NAME_STOPWORDS } from './numbers.ts';
import { mayReadIn, OFFICE_ROLES } from './read-roles.ts';
import { type Session, withTx } from './session.ts';

export const NOTE_MAX = 160; // characters, as ai.memory_stamp counts them
export const NOTE_DAYS = 180; // a note holds this long unless it is forgotten or superseded (the schema allows a year)
export const NOTES_IN_PROMPT = 12; // the newest notes an agent is given
export const ABOUT_MAX = 32; // the schema's cap on a note's `about` (23_memory.sql: at most 32 ids)

export type NoteKind = 'preference' | 'declined';
export type Note = { id: string; kind: string; text: string };

/** Why a note's words were refused, as the field CoreError names: a number or number word (a handle ⟦1⟧ is one), a
 * script other than English or Hindi, too long as typed, or too long once names are kept as roles. */
export type NoteRefusal = 'note.number' | 'note.script' | 'note.length' | 'note.masked_length';

/** A note's words as a person typed them, checked before any transaction: spaces collapsed, 1 to NOTE_MAX characters,
 * no handle (⟦ ⟧), and nothing the number grammar reads as a number (a digit of any script, a number word) or cannot
 * read (another script). Refused: `invalid`, its field the reason (NoteRefusal). */
export function noteWords(words: string): string {
  const w = words.normalize('NFC').replace(/\s+/gu, ' ').trim();
  const refuse = (why: NoteRefusal) => new CoreError('invalid', { fields: [why] });
  if (!w || [...w].length > NOTE_MAX) throw refuse('note.length');
  if (/[⟦⟧]/u.test(w)) throw refuse('note.number');
  const rules = answerRules(w);
  if (rules.includes('other_script')) throw refuse('note.script');
  if (rules.length > 0) throw refuse('note.number');
  return w;
}

/** In a member's transaction: refused unless the member is the shop's owner or a manager (the schema's writers). */
export async function refuseNoteWriter(c: pg.ClientBase, session: Session, owner = false): Promise<void> {
  const { rows } = await c.query<{ role: string }>('select role from ops.member where id = $1 and active', [session.memberId]);
  const role = rows[0]?.role;
  if (!role || (owner ? role !== 'owner' : !(OFFICE_ROLES as readonly string[]).includes(role))) throw new CoreError('refused', { fields: ['note'] });
}

const ROLE_WORDS = { customer: 'a customer', supplier: 'a supplier', staff: 'a staff member', contact: 'a person' } as const;
const PAYLOAD_PARTIES = ['customerId', 'supplierId', 'staffId'];
// A first name that is also an ordinary word ("Sugar Point", "Fresh Mart", "Sunny") is not masked on its own: masking it
// would change what the note says. The whole name is still masked, and an erasure still blanks the note (namesIn).
const ORDINARY = new Set([
  ...NAME_STOPWORDS,
  ...'customer supplier staff member owner manager person credit counter'.split(' '),
  ...'sugar fresh sunny gold golden silver star sweet salt rice tea milk honey rose lotus sun moon new good best happy lucky royal super prime green red white black blue apple mango orange'.split(' '),
  ...'sona chandi heera moti chand suraj raja rani shubh laabh labh mangal naya achha accha meetha'.split(' '),
  ...'सोना चांदी हीरा मोती चाँद चांद सूरज राजा रानी शुभ लाभ मंगल नया अच्छा मीठा'.split(' '),
]);
const literal = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A name or a part of one, whole, with the suffixes people put on a name: 's, ji, -ji, bhai, -bhai, ben, -ben (and जी).
const SUFFIX = `(?:'s|’s|-?ji|-?bhai|-?ben|\\s?जी|\\s?भाई|\\s?बेन)?`;
const named = (s: string) => new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${literal(s)}(${SUFFIX})(?![\\p{L}\\p{M}\\p{N}])`, 'giu');
const letters = (s: string) => [...s].filter((ch) => /\p{L}/u.test(ch)).length;
/** A name's parts of two letters or more, as stored. */
export const nameParts = (name: string) => name.split(/[\s(),.\-/]+/u).filter((w) => letters(w) >= 2);

export type Party = { name: string; party: string; role: keyof typeof ROLE_WORDS };

/**
 * Who the words name among `parties` (a whole name, or a first name that is not an ordinary word, either with a name's
 * suffixes, any case), and the words as kept: on a live shop each such name becomes its role ("a customer", "a
 * customer's"), elsewhere they stay as typed. Pure, so the masking is gated without a database.
 */
export function maskNames(words: string, parties: Party[], live: boolean): { words: string; named: string[] } {
  const spans = parties.flatMap((p) => {
    const first = nameParts(p.name)[0];
    const whole = p.name.trim();
    // A one-word name is a first name too: an ordinary word ("Sunny") is not masked.
    const plainWhole = nameParts(whole).length === 1 && ORDINARY.has(whole.toLowerCase());
    const own = first && first !== whole && !ORDINARY.has(first.toLowerCase()) ? [first] : [];
    return [...(plainWhole ? [] : [whole]), ...own].filter(Boolean).map((s) => ({ s, p }));
  });
  // The longest first, so "Ravi Kumar" is masked whole before "Ravi" alone.
  spans.sort((x, y) => [...y.s].length - [...x.s].length);
  let kept = words;
  const found = new Set<string>();
  for (const { s, p } of spans) {
    if (!named(s).test(kept)) continue;
    found.add(p.party);
    if (live) kept = kept.replace(named(s), (_m, suffix: string) => `${ROLE_WORDS[p.role]}${/^['’]s$/u.test(suffix) ? suffix : ''}`);
  }
  return { words: kept, named: [...found] };
}

/**
 * Whether `text` may name the person `name` (the erasure's safety net, wider than masking): any part of the name of
 * two letters or more, with a name's suffixes, any case; or any word in a script the stored name is not written in
 * (Latin or Devanagari), since the note may spell the name in that script. Wide on purpose: over-blanking is safe.
 */
export function mayName(text: string, name: string): boolean {
  if (nameParts(name).some((part) => named(part).test(text))) return true;
  const deva = /\p{Script=Devanagari}/u;
  const latin = /\p{Script=Latin}/u;
  return (deva.test(text) && !deva.test(name)) || (latin.test(text) && !latin.test(name));
}

// The parties a draft's payload names (a customerId, supplierId or staffId at any depth).
function partiesIn(v: unknown, key = ''): string[] {
  if (typeof v === 'string') return PAYLOAD_PARTIES.includes(key) ? [v] : [];
  if (Array.isArray(v)) return v.flatMap((x) => partiesIn(x, key));
  if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => partiesIn(x, k));
  return [];
}

/**
 * The words as kept (maskNames over the shop's people, live only for a live shop) and `about`: the draft's parties
 * first, then everyone named, to the schema's cap (ABOUT_MAX), so a draft's own party is never pushed out.
 */
async function people(c: pg.ClientBase, words: string, payload: unknown): Promise<{ words: string; about: string[] }> {
  const { rows } = await c.query<{ contact_id: string; name: string; customer_id: string | null; supplier_id: string | null; staff_id: string | null }>(
    `select ct.id::text as contact_id, ct.name, p.customer_id::text, p.supplier_id::text, p.staff_id::text
       from ops.contact ct
       left join books.party_contact p on p.tenant_id = ct.tenant_id and p.contact_id = ct.id
      where ct.erased_at is null and ct.name is not null`,
  );
  const live = (await c.query<{ live: boolean }>(`select data_class = 'live' as live from ops.tenant`)).rows[0]?.live === true;
  const parties: Party[] = rows.map((r) => ({
    name: r.name,
    party: r.customer_id ?? r.supplier_id ?? r.staff_id ?? r.contact_id,
    role: r.customer_id ? 'customer' : r.supplier_id ? 'supplier' : r.staff_id ? 'staff' : 'contact',
  }));
  const masked = maskNames(words, parties, live);
  if ([...masked.words].length > NOTE_MAX) throw new CoreError('invalid', { fields: ['note.masked_length' satisfies NoteRefusal] });
  return { words: masked.words, about: [...new Set([...partiesIn(payload), ...masked.named])].slice(0, ABOUT_MAX) };
}

/**
 * Inside decide()'s transaction, after its decision row: the note citing that decision, its words in message_text
 * (written by the approver now, as the schema requires) and the note in ai.memory. Returns the note's id.
 */
export async function writeNote(
  c: pg.ClientBase,
  session: Session,
  note: { decisionId: string; kind: NoteKind; words: string; payload: unknown },
): Promise<string> {
  const { words, about } = await people(c, note.words, note.payload);
  const { rows: text } = await c.query<{ id: string }>(
    `insert into ops.message_text (tenant_id, body, author, body_sha256)
     values (nullif(current_setting('munshi.tenant_id', true), '')::uuid, $1, 'member', '\\x00') returning id`,
    [words],
  );
  const { rows } = await c.query<{ id: string }>(
    `insert into ai.memory (tenant_id, kind, text_id, decision_id, about, created_by, created_txid, valid_to)
     values (nullif(current_setting('munshi.tenant_id', true), '')::uuid, $1, $2, $3, $4, $5, 0, now() + make_interval(days => $6))
     returning id`,
    [note.kind, text[0]?.id, note.decisionId, JSON.stringify(about), session.memberId, NOTE_DAYS],
  );
  return (rows[0] as { id: string }).id;
}

/** The owner forgets a note: it ends now ('forgotten'), audited by the schema. Anyone else is refused before the write. */
export async function forgetNote(pool: pg.Pool, session: Session, memoryId: string): Promise<void> {
  await withTx(pool, { kind: 'member', session }, async (c) => {
    await refuseNoteWriter(c, session, true);
    const { rows } = await c.query('select 1 from ai.memory where id = $1', [memoryId]);
    if (!rows.length) throw new CoreError('not_found');
    await c.query(
      `insert into ai.memory_end (tenant_id, memory_id, ended_by, reason)
       values (nullif(current_setting('munshi.tenant_id', true), '')::uuid, $1, $2, 'forgotten')`,
      [memoryId, session.memberId],
    );
  });
}

/**
 * The notes in force an agent run of this member is given, oldest first so the prompt's prefix stays as it was when a
 * note is added (the newest NOTES_IN_PROMPT). Memory is the office's: none for a member whose role may not read it.
 */
export function notesFor(pool: pg.Pool, session: Session): Promise<Note[]> {
  return withTx(pool, { kind: 'member', session }, async (c) => {
    if (!(await mayReadIn(c, 'memory.in_force'))) return [];
    // The operator switched the shop's memory off (D-079 §8): no note reaches a model.
    if (!(await featureOn(c, 'memory'))) return [];
    const { rows } = await c.query<Note>(
      `select id::text, kind, text from (select n.* from ai.memory_in_force() n order by n.valid_from desc, n.id desc limit $1) x
        order by x.valid_from, x.id`,
      [NOTES_IN_PROMPT],
    );
    return rows;
  });
}

/**
 * The words of every note about a person who is erased, blanked (23_memory.sql's contract), in the erasure's own
 * transaction, after the contact's row: every note whose `about` names an erased person, and, as the safety net,
 * every note whose words may name one of `names` (mayName: any part of the name, a name's suffixes, any case, or a word
 * in another script). The second needs the names read before the erasure and an owner as the actor. No job completes a
 * held erasure yet; one would call this with no names (the `about` rule is the only one the jobs role may apply).
 * Returns how many notes' words were blanked.
 */
export async function eraseNotesOfErased(c: pg.ClientBase, names: string[] = []): Promise<number> {
  const r = await c.query(
    `update ops.message_text x set body = null, erased_at = now() from ai.memory n
      where n.tenant_id = x.tenant_id and n.text_id = x.id and x.erased_at is null and ai.memory_names_erased(n.tenant_id, n.about)`,
  );
  let blanked = r.rowCount ?? 0;
  if (!names.length) return blanked;
  const { rows } = await c.query<{ id: string; body: string }>(
    `select t.id::text, t.body from ai.memory n join ops.message_text t on t.tenant_id = n.tenant_id and t.id = n.text_id where t.erased_at is null`,
  );
  const naming = rows.filter((t) => names.some((name) => mayName(t.body, name))).map((t) => t.id);
  if (naming.length) blanked += (await c.query('update ops.message_text set body = null, erased_at = now() where id = any($1::uuid[]) and erased_at is null', [naming])).rowCount ?? 0;
  return blanked;
}

/**
 * The owner erases a person's contact at their request, in one transaction: the contact's name and phone, their
 * measurements, then the words of every note about them or that may name them, so no note keeps them in force. A
 * balance of theirs still open refuses it (the schema's hold).
 */
export async function eraseContact(pool: pg.Pool, session: Session, contactId: string): Promise<{ notes: number }> {
  return withTx(pool, { kind: 'member', session }, async (c) => {
    const { rows } = await c.query<{ name: string | null }>('select name from ops.contact where id = $1 and erased_at is null', [contactId]);
    if (!rows[0]) throw new CoreError('not_found');
    await c.query(
      `update ops.contact set name = null, phone_e164 = null, erased_at = now(), erased_by = $2, erase_reason = 'request' where id = $1`,
      [contactId, session.memberId],
    );
    // Loaded here: commands-orders reaches back into the command registry, which this module must not load first.
    const { eraseMeasurements } = await import('./commands-orders.ts');
    await eraseMeasurements(c, contactId);
    return { notes: await eraseNotesOfErased(c, rows[0].name ? [rows[0].name] : []) };
  });
}
