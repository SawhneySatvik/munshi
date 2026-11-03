// Red-proofs of an Instagram post's card (lane L-CARD, D-085): attaching it through core (test/v2/core/messaging/card.test.ts)
// and the app (apps/web/test/card-attach.test.tsx, card-post.test.tsx), binding it into the approval, the send reading
// the approved card, the media store (packages/adapters/test/media.test.ts) and its settings
// (packages/config/test/media.test.ts). Each breaks one protection, and its named test must then fail.
import type { Case } from './case.ts';
import { mutate } from './sql.ts';

const CORE = 'test/v2/core/messaging/card.test.ts';
const CARD = 'packages/core/src/campaign-card.ts';
const COMMANDS = 'packages/core/src/commands-messaging.ts';
const ATTACH = 'test/card-attach.test.tsx';
const POST = 'test/card-post.test.tsx';
const IMAGE = 'apps/web/lib/server/card-image.ts';
const DEPS = 'apps/web/lib/api/deps.ts';
const VIEWS = 'apps/web/components/app/OfficeViews.tsx';
const MEDIA = 'packages/adapters/media/index.ts';
const CONFIG = 'packages/config/src/index.ts';

const CARD1 =
  'CARD1 an owner or a manager attaches a JPEG to a composing Instagram campaign: a card document (an upload, its sha256 and size, its uploader) the campaign names, its bytes in the store under the shop; a replace names the new card, a remove names none';
const CARD2 =
  'CARD2 attachCard refuses staff, a WhatsApp campaign, a proposed one, bytes that are not a whole JPEG and a JPEG over the ceiling, and a store that fails: each writes no document and names no card';
const CARD3 =
  "CARD3 campaign.post binds the card's id and sha256; a card replaced or removed after the proposal makes the draft stale at approval, and nothing is posted";
const CARD4 =
  'CARD4 the send reads the card the approved payload bound: campaignCard gives that card, and none for a campaign that names another since (planted past the guard), nor before approval';
const CARD5 =
  "CARD5 the same picture again names its card and writes its bytes back if the store lost them; an erased card's picture cannot come back; an Instagram campaign with no card, or with its card erased, cannot be proposed";
const CARD6 = 'CARD6 a proposal waits for a card change in flight on the campaign row and binds the card that change wrote, never the one it replaced';
const CARDWEB1 =
  "CARDWEB1 the office attaches a PNG while composing and the store holds a JPEG Instagram takes (within 4:5 to 1.91:1 exactly, at the edges too, at least 320 wide, no transparency), its sha256 the document's; a GIF, staff, no store and a proposed campaign are refused with nothing stored; remove names none";
const CARDWEB4 = "CARDWEB4 a phone's photo taken sideways, carrying EXIF, is stored upright with no EXIF left; a valid picture over the four-megabyte cap is refused";
const CARDWEB2 =
  "CARDWEB2 the composer and the approver see the card on the campaign line (the approver the one the draft bound); the office's card route serves it to an owner or a manager only, never to staff or another shop, never cached";
const CARDWEB3 =
  "CARDWEB3 end to end in recorded Meta: with the config's store and an https MUNSHI_APP_URL, a real shop's approved post with an attached card goes through the outbox's claim to the Graph endpoint with that card's public address and the approved words exactly, and the address serves the stored bytes";
const MEDIA1 =
  'MEDIA1 the local store writes bytes under the key and reads them back whole; an unknown key reads null; a key outside a tenant path is refused before any file';
const MEDIA2 =
  "MEDIA2 Supabase Storage: a put is one POST to the bucket's object path with the secret key, the type and no upsert; a read GETs the same bytes back; a missing object, a failure and a key outside a tenant path are null or refused, naming no key and no secret";
const MEDIACFG1 =
  'MEDIACFG1 off a host the store is the folder MUNSHI_MEDIA_DIR names (unset, none); hosted, none unless the bucket is set; the bucket needs the project URL and the secret key, and a bad bucket or key is refused by name';

const core = (sabotage: string, test: string, file: string, from: string, to: string, sql?: string): Case => ({
  sabotage,
  file: CORE,
  test,
  config: 'vitest.v2.config.ts',
  ts: { file, from, to },
  ...(sql ? { sql } : {}),
});
const web = (sabotage: string, file: string, test: string, source: string, from: string, to: string): Case => ({
  sabotage,
  dir: 'apps/web',
  file,
  test,
  config: 'vitest.config.ts',
  ts: { file: source, from, to },
});
const pkg = (sabotage: string, dir: string, file: string, test: string, source: string, from: string, to: string): Case => ({
  sabotage,
  dir,
  file,
  test,
  config: 'vitest.config.ts',
  ts: { file: source, from, to },
});

export const CARD_CASES: Case[] = [
  // staff attach a card: core's office check gone and the database's composer check widened to every role
  core(
    'v2-card-staff',
    CARD2,
    CARD,
    "  if (!(await mayReadIn(c, 'campaign.audience'))) throw new CoreError('refused');\n",
    '',
    mutate('ops.campaign_guard()', "m.role in ('owner', 'manager') and m.active", "m.role in ('owner', 'manager', 'staff') and m.active"),
  ),
  // any bytes stored as a JPEG card: Instagram's container call fails at send, after the approval
  core('v2-card-not-jpeg', CARD2, CARD, 'if (jpeg.length > CARD_MAX_BYTES || !isJpeg(jpeg))', 'if (jpeg.length > CARD_MAX_BYTES)'),
  // the size ceiling left to the database's check alone: refused, but not as the card being too big
  core('v2-card-size', CARD2, CARD, 'if (jpeg.length > CARD_MAX_BYTES || !isJpeg(jpeg))', 'if (!isJpeg(jpeg))'),
  // a card attached to a WhatsApp campaign, which never posts a picture
  core('v2-card-channel', CARD2, CARD, "if (k.channel !== 'instagram' || k.status !== 'composing')", "if (k.status !== 'composing')"),
  // a store that failed taken as stored: a card document whose bytes are nowhere
  core('v2-card-store-fails', CARD2, CARD, "      } catch {\n        throw new CoreError('internal');\n      }", '      } catch {}'),
  // the proposal binds no card: the approval covers words, not the picture
  core('v2-card-unbound', CARD3, COMMANDS, "payload: { ...copy, ...card }, basedOn }", 'payload: copy, basedOn }'),
  // the approval does not recheck the card: a picture changed after the proposal is posted under the old approval
  core('v2-card-no-recheck', CARD3, COMMANDS, "  if (!sameCard(k, p)) bad.push('cardDocumentId');\n", ''),
  // the send takes the payload's card though the campaign now names another
  core('v2-card-send-other', CARD4, CARD, '          and k.status in (\'approved\', \'sent\') and k.card_document_id = doc.id\n', "          and k.status in ('approved', 'sent')\n"),
  // the send takes a card whose hash is not the approved one
  core('v2-card-send-sha', CARD4, CARD, "\n          and encode(doc.sha256, 'hex') = d.payload ->> 'cardSha256'`", '`'),
  // the same picture again inserted as a second document: the shop's one-per-hash key refuses it
  core('v2-card-same-again', CARD1, CARD, '      held?.id ??\n', ''),
  // the same picture again trusted to be in the store: a card whose bytes the store lost stays unservable
  core('v2-card-reput', CARD5, CARD, 'if (!kept || !sha(kept).equals(sha256)) {', 'if (!held) {'),
  // an erased card's picture attached again: refused only by the database, as a role refusal with no reason
  core('v2-card-erased-reason', CARD5, CARD, "    if (held?.kind === 'card' && held.erased) throw new CoreError('invalid', { fields: ['cardErased'] });\n", ''),
  // an Instagram campaign proposed with no picture: its approval covers no card, and the post fails at send
  core('v2-card-propose-cardless', CARD5, COMMANDS, "    if (k.channel === 'instagram' && !k.card_id) throw new CoreError('invalid', { fields: ['cardMissing'] });\n", ''),
  // proposed with its card erased: bound to no picture
  core('v2-card-propose-erased', CARD5, COMMANDS, "    if (k.channel === 'instagram' && !k.card_sha) throw new CoreError('invalid', { fields: ['cardErased'] });\n", ''),
  // the proposal reads the campaign without waiting for a card change in flight: it binds the card being replaced
  core('v2-card-propose-lock', CARD6, COMMANDS, "    await c.query('select 1 from ops.campaign where id = $1 for update', [campaignId]);\n", ''),
  // the upload stored in its own shape (scaled, never cropped): Instagram refuses a picture taller than 4:5
  web(
    'v2-card-web-shape',
    ATTACH,
    CARDWEB1,
    IMAGE,
    'const height = Math.min(Math.floor(width / TALLEST), Math.max(Math.ceil(width / WIDEST), Math.round(width / ratio)));',
    'const height = Math.round((width * h) / w);',
  ),
  // the height rounded to the nearest pixel: 750x1334 becomes 750x938 (under 4:5), a panorama 575x301 (over 1.91:1)
  web(
    'v2-card-web-round',
    ATTACH,
    CARDWEB1,
    IMAGE,
    'const height = Math.min(Math.floor(width / TALLEST), Math.max(Math.ceil(width / WIDEST), Math.round(width / ratio)));',
    'const height = Math.round(width / ratio);',
  ),
  // the type taken from whatever sharp can decode: a GIF becomes a card
  web('v2-card-web-type', ATTACH, CARDWEB1, IMAGE, 'if (!kind || meta.format !== kind || !meta.width', 'if (!meta.width'),
  // no size cap on the server: a body the host would cut off at 4.5 MB, taken whole where it is not
  web('v2-card-web-cap', ATTACH, CARDWEB4, IMAGE, '  if (upload.length > MAX_CARD_UPLOAD) return null;\n', ''),
  // the photo stored as the sensor wrote it: a phone's portrait picture posted on its side
  web('v2-card-web-upright', ATTACH, CARDWEB4, IMAGE, '        .rotate()\n', ''),
  // the office's card route serves any role's request
  web('v2-card-web-route-role', ATTACH, CARDWEB2, CARD, "    if (!(await mayReadIn(c, 'campaign.audience'))) return null;\n", ''),
  // the office's card route serves whatever bytes the store holds under the key
  web(
    'v2-card-web-route-sha',
    ATTACH,
    CARDWEB2,
    'apps/web/app/api/office/cards/[file]/route.ts',
    ' || !createHash("sha256").update(bytes).digest().equals(card.sha256)',
    '',
  ),
  // the card can still be replaced once proposed, on the screen at least
  web('v2-card-web-form-proposed', ATTACH, CARDWEB2, VIEWS, '      {k.status === "composing" &&\n        (cardStore ? (', '      {(cardStore ? ('),
  // the configured store never wired (as before this lane): nothing can be attached, and no post can go
  web(
    'v2-card-web-no-config-store',
    POST,
    CARDWEB3,
    DEPS,
    '(swapped.media !== undefined ? swapped.media : configured())',
    '(swapped.media ?? null)',
  ),
  // the local store writes wherever the key points
  pkg('v2-media-local-key', 'packages/adapters', 'test/media.test.ts', MEDIA1, MEDIA, "(storableKey(key) ? path.join(root, ...key.split('/')) : null)", "path.join(root, ...key.split('/'))"),
  // Supabase is sent any key
  pkg('v2-media-supa-key', 'packages/adapters', 'test/media.test.ts', MEDIA2, MEDIA, "      if (!storableKey(key)) throw new MediaError('bad_key');\n      let r: Reply;", '      let r: Reply;'),
  // a failed upload taken as stored
  pkg('v2-media-supa-unchecked', 'packages/adapters', 'test/media.test.ts', MEDIA2, MEDIA, '      if (!r.ok) throw new MediaError(\'not_stored\');\n', ''),
  // a hosted deploy given a folder Meta's fetch would not find on the next instance
  pkg('v2-media-cfg-hosted', 'packages/config', 'test/media.test.ts', MEDIACFG1, CONFIG, '  if (env.VERCEL_REGION) return undefined;\n', ''),
  // the bucket without its key: every upload fails at runtime instead of at boot
  pkg(
    'v2-media-cfg-partial',
    'packages/config',
    'test/media.test.ts',
    MEDIACFG1,
    CONFIG,
    "const unset = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY'].filter((name) => !env[name]);",
    'const unset: string[] = [];',
  ),
];
