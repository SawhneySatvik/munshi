// An Instagram post's picture: its campaign's card (BLUEPRINT §8.6). Meta fetches the image from a public address, so
// the deploy serves the card there, and only while an approved or sent Instagram campaign names it: the public role's
// policies (19_messaging.sql's campaign_public and document_public) decide that, never this file. Reads only.
import type pg from 'pg';
import { withTx } from './session.ts';

/** The card the campaign names, read as the outbox's sender sees it (munshi_jobs, the shop's context), only once the
 *  campaign is approved or sent; null for none. Nothing sets card_document_id yet: before any code does, the card must
 *  be bound in campaign.post's approved payload, so the picture posted is the one its approver saw. */
export async function campaignCard(jobs: pg.Pool, tenantId: string, campaignId: string): Promise<string | null> {
  return withTx(jobs, { kind: 'system', tenantId }, async (c) => {
    const { rows } = await c.query<{ card: string | null }>(
      `select card_document_id::text as card from ops.campaign where id = $1 and status in ('approved', 'sent')`,
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
