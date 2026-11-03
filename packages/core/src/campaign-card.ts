// An Instagram post's picture: its campaign's card (BLUEPRINT §8.6). The office attaches it while the campaign is
// composing (attachCard: the bytes to the media store, an ops.document of kind card, the campaign naming it); the
// proposal binds its id and sha256 into the campaign.post draft, and the approval rechecks both (commands-messaging.ts),
// so the picture posted is the one its approver saw. Meta fetches the image from a public address, so the deploy serves
// the card there, and only while an approved or sent Instagram campaign names it: the public role's policies
// (19_messaging.sql's campaign_public and document_public) decide that, never this file.
import { createHash, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { can } from './capabilities.ts';
import { CoreError } from './errors.ts';
import { mayReadIn } from './read-roles.ts';
import { type Session, withTx } from './session.ts';

/** The database's ceiling on a document (04_ops_infra.sql): a card's JPEG is at most this many bytes. */
export const CARD_MAX_BYTES = 4_000_000;

/** Whether the bytes are a whole JPEG: its start-of-image marker first and its end-of-image marker last. */
export const isJpeg = (b: Buffer): boolean => b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff && b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9;

/** Where a card's bytes go: the media store (packages/adapters/media). */
export type CardStore = { read(storageKey: string): Promise<Buffer | null>; put(storageKey: string, bytes: Buffer, mime: string): Promise<void> };

const sha = (b: Buffer) => createHash('sha256').update(b).digest();

// The campaign a card is attached to or taken from: the office's (D-082: an owner or a manager, campaigns switched on),
// an Instagram campaign, still composing. Locked (FOR UPDATE), and proposeCampaign reads it under the same lock, so a
// proposal waits for an attach in flight and binds the card it wrote.
async function composing(c: pg.PoolClient, session: Session, campaignId: string): Promise<void> {
  if (!(await mayReadIn(c, 'campaign.audience'))) throw new CoreError('refused');
  if (!(await can(c, session, 'campaigns'))) throw new CoreError('capability_off');
  const { rows } = await c.query<{ channel: string; status: string }>('select channel, status from ops.campaign where id = $1 for update', [campaignId]);
  const k = rows[0];
  if (!k) throw new CoreError('not_found');
  if (k.channel !== 'instagram' || k.status !== 'composing') throw new CoreError('invalid', { fields: ['campaignId'] });
}

/**
 * Attaches a JPEG (already re-encoded for Instagram by the caller) as the campaign's card, replacing any card it named.
 * The role, the campaign and the bytes are checked first; the document row and the campaign's card are written, then
 * the bytes stored, all before the transaction commits: a refusal stores nothing, and a store that fails writes no row.
 * A shop holds one document per hash (document_sha), so the same picture again is the card already stored: named
 * again, its bytes written again only if the store no longer holds them (the same bytes, by that hash). A picture whose
 * card was erased cannot come back, and bytes the shop holds as another kind of document are no card.
 */
export async function attachCard(pool: pg.Pool, session: Session, campaignId: string, jpeg: Buffer, store: CardStore): Promise<string> {
  return withTx(pool, { kind: 'member', session }, async (c) => {
    await composing(c, session, campaignId);
    if (jpeg.length > CARD_MAX_BYTES || !isJpeg(jpeg)) throw new CoreError('invalid', { fields: ['card'] });
    const sha256 = sha(jpeg);
    const { rows: same } = await c.query<{ id: string; kind: string; erased: boolean; key: string | null }>(
      'select id::text, kind, erased_at is not null as erased, storage_key as key from ops.document where sha256 = $1',
      [sha256],
    );
    const held = same[0];
    if (held?.kind === 'card' && held.erased) throw new CoreError('invalid', { fields: ['cardErased'] });
    if (held && held.kind !== 'card') throw new CoreError('invalid', { fields: ['card'] });
    const key = held?.key ?? `t-${session.tenantId}/card/${randomUUID()}.jpg`;
    const doc =
      held?.id ??
      (
        await c.query<{ id: string }>(
          `insert into ops.document (tenant_id, kind, source, storage_key, sha256, mime, bytes) values ($1, 'card', 'upload', $2, $3, 'image/jpeg', $4) returning id`,
          [session.tenantId, key, sha256, jpeg.length],
        )
      ).rows[0]?.id;
    await c.query('update ops.campaign set card_document_id = $2 where id = $1', [campaignId, doc]);
    const kept = held ? await store.read(key).catch(() => null) : null;
    if (!kept || !sha(kept).equals(sha256)) {
      try {
        await store.put(key, jpeg, 'image/jpeg');
      } catch {
        throw new CoreError('internal');
      }
    }
    return doc as string;
  });
}

/** Takes the card off a composing campaign (its document stays, as every upload does until it is erased). */
export async function removeCard(pool: pg.Pool, session: Session, campaignId: string): Promise<void> {
  await withTx(pool, { kind: 'member', session }, async (c) => {
    await composing(c, session, campaignId);
    await c.query('update ops.campaign set card_document_id = null where id = $1', [campaignId]);
  });
}

export type StoredCard = { storageKey: string; sha256: Buffer };

/** A card some campaign of the member's shop names, for the office's own screens (any status): its key and hash, or
 *  null for another role, another shop's, an erased one or any other document. */
export async function memberCard(pool: pg.Pool, session: Session, documentId: string): Promise<StoredCard | null> {
  return withTx(pool, { kind: 'member', session }, async (c) => {
    if (!(await mayReadIn(c, 'campaign.audience'))) return null;
    const { rows } = await c.query<{ storage_key: string | null; sha256: Buffer }>(
      `select d.storage_key, d.sha256 from ops.document d
        where d.id = $1 and d.kind = 'card' and d.erased_at is null
          and exists (select 1 from ops.campaign k where k.card_document_id = d.id)`,
      [documentId],
    );
    const r = rows[0];
    return r?.storage_key ? { storageKey: r.storage_key, sha256: r.sha256 } : null;
  });
}

/**
 * The card an executed campaign.post draft bound (its payload's cardDocumentId), read as the outbox's sender sees the
 * shop (a tenant and no actor, on the app's pool: the jobs role reads no draft yet), and only while the campaign is
 * approved or sent, still names that card, and the card's sha256 is the one approved; null for none. A campaign is
 * approved once (approve()), so at most one executed campaign.post names it: the query needs no order.
 */
export async function campaignCard(app: pg.Pool, tenantId: string, campaignId: string): Promise<string | null> {
  return withTx(app, { kind: 'system', tenantId }, async (c) => {
    const { rows } = await c.query<{ card: string }>(
      `select doc.id::text as card from approval.draft d
         join ops.campaign k on k.id::text = d.payload ->> 'campaignId'
         join ops.document doc on doc.id::text = d.payload ->> 'cardDocumentId'
        where d.command = 'campaign.post' and d.status = 'executed' and d.payload ->> 'campaignId' = $1
          and k.status in ('approved', 'sent') and k.card_document_id = doc.id
          and encode(doc.sha256, 'hex') = d.payload ->> 'cardSha256'`,
      [campaignId],
    );
    return rows[0]?.card ?? null;
  });
}

export type PublicCard = { id: string; storageKey: string; sha256: Buffer; bytes: number };

/** A card document the public may fetch (munshi_public, the shop's context): an unerased JPEG card that an approved or
 *  sent Instagram campaign of the shop names; null for anything else, a site's art and cards among them. */
export async function publicCard(pub: pg.Pool, tenantId: string, documentId: string): Promise<PublicCard | null> {
  return withTx(pub, { kind: 'system', tenantId }, async (c) => {
    const { rows } = await c.query<{ storage_key: string | null; sha256: Buffer; bytes: number }>(
      `select d.storage_key, d.sha256, d.bytes from ops.document d
        where d.id = $1 and d.kind = 'card' and d.mime = 'image/jpeg' and d.erased_at is null
          and exists (select 1 from ops.campaign k where k.card_document_id = d.id)`,
      [documentId],
    );
    const r = rows[0];
    return r?.storage_key ? { id: documentId, storageKey: r.storage_key, sha256: r.sha256, bytes: r.bytes } : null;
  });
}
