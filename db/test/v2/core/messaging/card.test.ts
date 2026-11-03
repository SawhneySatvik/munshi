// An Instagram post's card through core (D-085): the office attaches a JPEG while the campaign is composing (attachCard:
// a card document named by the campaign, its bytes in the media store), the proposal binds the card's id and sha256 in
// the campaign.post draft, the approval rechecks both (a card changed since is a stale draft, and nothing is posted),
// and the send reads the card the approved payload bound (campaignCard), never a live guess. The media store is the
// local folder adapter in a temp folder; the database is real. Red-proofs: db/test/v2/sabotage/card.ts.
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  attachCard,
  CARD_MAX_BYTES,
  type CardStore,
  campaignCard,
  CoreError,
  createCampaign,
  decide,
  proposeCampaign,
  removeCard,
  type Session,
  switchCapability,
  writeCopy,
} from '@munshi/core';
import type pg from 'pg';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { localMediaStore } from '../../../../../packages/adapters/media/index.ts';
import { openTestDb, type TestDb, tx } from '../../db.ts';
import { plant } from '../../gates/lib.ts';
import { type Shop, smallShop } from '../shop.ts';

let db: TestDb;
let app: pg.Pool;
let s: Shop;
let dir: string;

beforeAll(async () => {
  db = await openTestDb();
  app = db.as('munshi_app');
  s = await smallShop(app, 'Card');
  await switchCapability(app, s.owner, 'campaigns', true);
  dir = mkdtempSync(path.join(tmpdir(), 'munshi-card-'));
  await db.sabotage();
});
afterAll(async () => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  await db?.close();
});

const store = () => localMediaStore(dir);
const jpeg = (n = 64) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(n), Buffer.from([0xff, 0xd9])]);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const q = async <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) => (await db.admin.query<T>(sql, params)).rows;
const as = (who: Session) => ({ tenant_id: who.tenantId, actor_id: who.memberId });
const stored = () => readdirSync(path.join(dir, `t-${s.owner.tenantId}`, 'card'), { withFileTypes: true }).length;
const cardOf = async (campaign: string) => (await q<{ card: string | null }>('select card_document_id::text as card from ops.campaign where id = $1', [campaign]))[0]?.card ?? null;
const docs = async () => (await q<{ n: number }>(`select count(*)::int as n from ops.document where tenant_id = $1 and kind = 'card'`, [s.owner.tenantId]))[0]?.n;

const post = async (channel: 'instagram' | 'whatsapp' = 'instagram') => {
  const id = await createCampaign(app, s.owner, { name: 'Festive post', channel, segment: 'bought_within_days', segmentDays: 30 });
  await writeCopy(app, { session: s.owner }, id, 'Festive picks are in this week.');
  return id;
};
const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (err) {
    return err instanceof CoreError ? [err.code, ...(err.fields ?? [])].join(':') : 'other';
  }
  return 'accepted';
};
const move = (campaign: string, status: string) => tx(app, as(s.owner), (c) => c.query('update ops.campaign set status = $2 where id = $1', [campaign, status]));
const setCard = (campaign: string, card: string | null) => tx(app, as(s.owner), (c) => c.query('update ops.campaign set card_document_id = $2 where id = $1', [campaign, card]));

it('CARD1 an owner or a manager attaches a JPEG to a composing Instagram campaign: a card document (an upload, its sha256 and size, its uploader) the campaign names, its bytes in the store under the shop; a replace names the new card, a remove names none', async () => {
  const campaign = await post();
  const first = jpeg();
  const doc = await attachCard(app, s.owner, campaign, first, store());
  const [row] = await q<{ kind: string; source: string; mime: string; sha: string; bytes: number; by: string; key: string }>(
    `select kind, source, mime, encode(sha256, 'hex') as sha, bytes, uploaded_by::text as by, storage_key as key from ops.document where id = $1`,
    [doc],
  );
  expect(row && { ...row, key: undefined }).toEqual({ kind: 'card', source: 'upload', mime: 'image/jpeg', sha: sha(first), bytes: first.length, by: s.owner.memberId, key: undefined });
  expect(row?.key).toMatch(new RegExp(`^t-${s.owner.tenantId}/card/[0-9a-f-]{36}\\.jpg$`));
  expect(await cardOf(campaign)).toBe(doc);
  expect((await store().read(row?.key as string))?.equals(first)).toBe(true);
  // A manager replaces it; the campaign names the new card.
  const second = jpeg(80);
  const replaced = await attachCard(app, s.manager, campaign, second, store());
  expect(replaced).not.toBe(doc);
  expect(await cardOf(campaign)).toBe(replaced);
  await removeCard(app, s.manager, campaign);
  expect(await cardOf(campaign)).toBeNull();
  // The same picture again is the card already stored (one document per hash), named again.
  expect(await attachCard(app, s.owner, campaign, first, store())).toBe(doc);
  expect(await cardOf(campaign)).toBe(doc);
});

it('CARD2 attachCard refuses staff, a WhatsApp campaign, a proposed one, bytes that are not a whole JPEG and a JPEG over the ceiling, and a store that fails: each writes no document and names no card', async () => {
  const campaign = await post();
  const before = await docs();
  const failing: CardStore = {
    read: async () => null,
    put: async () => {
      throw new Error('disk full');
    },
  };
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...randomBytes(32)]);
  const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(CARD_MAX_BYTES), Buffer.from([0xff, 0xd9])]);
  expect(await code(attachCard(app, s.staff, campaign, jpeg(), store())), 'staff').toBe('refused');
  expect(await code(removeCard(app, s.staff, campaign)), 'staff remove').toBe('refused');
  expect(await code(attachCard(app, s.owner, await post('whatsapp'), jpeg(), store())), 'whatsapp').toBe('invalid:campaignId');
  expect(await code(attachCard(app, s.owner, campaign, png, store())), 'a PNG').toBe('invalid:card');
  expect(await code(attachCard(app, s.owner, campaign, jpeg().subarray(0, 40), store())), 'cut short').toBe('invalid:card');
  expect(await code(attachCard(app, s.owner, campaign, big, store())), 'too big').toBe('invalid:card');
  expect(await code(attachCard(app, s.owner, campaign, jpeg(), failing)), 'store fails').toBe('internal');
  await move(campaign, 'proposed');
  expect(await code(attachCard(app, s.owner, campaign, jpeg(), store())), 'proposed').toBe('invalid:campaignId');
  expect(await code(removeCard(app, s.owner, campaign)), 'proposed remove').toBe('invalid:campaignId');
  expect(await docs()).toBe(before);
  expect(await cardOf(campaign)).toBeNull();
});

it("CARD3 campaign.post binds the card's id and sha256; a card replaced or removed after the proposal makes the draft stale at approval, and nothing is posted", async () => {
  // Bound as proposed: the payload names the card and its hash.
  const bound = await post();
  const card = await attachCard(app, s.owner, bound, jpeg(), store());
  const draft = await proposeCampaign(app, s.owner, bound);
  const [payload] = await q<{ p: Record<string, string> }>('select payload as p from approval.draft where id = $1', [draft]);
  const [doc] = await q<{ sha: string }>(`select encode(sha256, 'hex') as sha from ops.document where id = $1`, [card]);
  expect([payload?.p.cardDocumentId, payload?.p.cardSha256]).toEqual([card, doc?.sha]);

  // Each change made after the proposal (back to composing, the card changed, proposed again), then the old draft decided.
  const changed = async (change: (campaign: string) => Promise<unknown>) => {
    const campaign = await post();
    await attachCard(app, s.owner, campaign, jpeg(), store());
    const d = await proposeCampaign(app, s.owner, campaign);
    await move(campaign, 'composing');
    await change(campaign);
    await move(campaign, 'proposed');
    const out = await decide(app, s.owner, d, 'approved');
    const posts = await q('select 1 from books.outbound_message where campaign_id = $1', [campaign]);
    return [out.status, posts.length];
  };
  expect(await changed((k) => attachCard(app, s.owner, k, jpeg(), store())), 'replaced').toEqual(['stale', 0]);
  expect(await changed((k) => setCard(k, null)), 'removed').toEqual(['stale', 0]);
  // Unchanged, it executes.
  expect((await decide(app, s.owner, draft, 'approved')).status).toBe('executed');
});

it('CARD4 the send reads the card the approved payload bound: campaignCard gives that card, and none for a campaign that names another since (planted past the guard), nor before approval', async () => {
  const campaign = await post();
  const card = await attachCard(app, s.owner, campaign, jpeg(), store());
  const draft = await proposeCampaign(app, s.owner, campaign);
  expect(await campaignCard(db.as('munshi_jobs'), s.owner.tenantId, campaign), 'proposed').toBeNull();
  expect((await decide(app, s.owner, draft, 'approved')).status).toBe('executed');
  expect(await campaignCard(db.as('munshi_jobs'), s.owner.tenantId, campaign)).toBe(card);
  // Another card named after the approval (the guard forbids it; planted as if it had not): not the approved picture.
  const other = await post();
  const another = await attachCard(app, s.owner, other, jpeg(), store());
  await plant(db.admin, 'update ops.campaign set card_document_id = $2 where id = $1', [campaign, another]);
  expect(await campaignCard(db.as('munshi_jobs'), s.owner.tenantId, campaign)).toBeNull();
  await plant(db.admin, 'update ops.campaign set card_document_id = $2 where id = $1', [campaign, card]);
  expect(await campaignCard(db.as('munshi_jobs'), s.owner.tenantId, campaign)).toBe(card);
  // A payload whose hash is not the document's (planted): not the approved picture either.
  await plant(db.admin, `update approval.draft set payload = jsonb_set(payload, '{cardSha256}', to_jsonb($2::text)) where id = $1`, [draft, sha(jpeg())]);
  expect(await campaignCard(db.as('munshi_jobs'), s.owner.tenantId, campaign)).toBeNull();
  expect(stored()).toBeGreaterThan(0);
});

it("CARD5 the same picture again names its card and writes its bytes back if the store lost them; an erased card's picture cannot come back; an Instagram campaign with no card, or with its card erased, cannot be proposed", async () => {
  const campaign = await post();
  const bytes = jpeg();
  const doc = await attachCard(app, s.owner, campaign, bytes, store());
  const [row] = await q<{ key: string }>('select storage_key as key from ops.document where id = $1', [doc]);
  const file = path.join(dir, ...(row?.key ?? '').split('/'));
  rmSync(file);
  expect(await store().read(row?.key as string)).toBeNull();
  expect(await attachCard(app, s.owner, campaign, bytes, store())).toBe(doc);
  expect((await store().read(row?.key as string))?.equals(bytes)).toBe(true);
  // No card: refused before any draft.
  const bare = await post();
  expect(await code(proposeCampaign(app, s.owner, bare)), 'no card').toBe('invalid:cardMissing');
  // The owner erases the card: the campaign cannot be proposed with it, and its picture cannot be attached again.
  await tx(app, as(s.owner), (c) => c.query('update ops.document set storage_key = null, erased_at = now() where id = $1', [doc]));
  expect(await code(proposeCampaign(app, s.owner, campaign)), 'erased').toBe('invalid:cardErased');
  expect(await code(attachCard(app, s.owner, campaign, bytes, store())), 'again').toBe('invalid:cardErased');
  expect(await q('select 1 from approval.draft where payload ->> \'campaignId\' = any($1::text[])', [[bare, campaign]])).toEqual([]);
  expect((await q<{ status: string }>('select status from ops.campaign where id = $1', [campaign]))[0]?.status).toBe('composing');
});

it('CARD6 a proposal waits for a card change in flight on the campaign row and binds the card that change wrote, never the one it replaced', async () => {
  const campaign = await post();
  const old = await attachCard(app, s.owner, campaign, jpeg(), store());
  const fresh = await attachCard(app, s.owner, await post(), jpeg(), store());
  let draft: Promise<string> | undefined;
  await tx(app, as(s.owner), async (c) => {
    await c.query('select 1 from ops.campaign where id = $1 for update', [campaign]);
    draft = proposeCampaign(app, s.owner, campaign);
    await new Promise((r) => setTimeout(r, 400));
    await c.query('update ops.campaign set card_document_id = $2 where id = $1', [campaign, fresh]);
  });
  const [payload] = await q<{ card: string }>("select payload ->> 'cardDocumentId' as card from approval.draft where id = $1", [await (draft as Promise<string>)]);
  expect(payload?.card).not.toBe(old);
  expect(payload?.card).toBe(fresh);
});
