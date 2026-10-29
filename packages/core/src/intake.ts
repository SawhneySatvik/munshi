// Intake (BLUEPRINT §8.12, decision 18): every channel makes an ops.order_request, never a book. A site or widget cart
// stores the latest release it was priced from and its lines (item ids and quantities only); a message channel names the
// inbox message the webhook stored. A request holds a code and a contact id at most, no name, phone or note, and becomes
// an order only by a person's order.confirm. Each function runs in the caller's transaction, whose context carries the
// tenant and, on the public and webhook routes, no actor (withTx's `system` scope on the public pool), so the route can
// claim its idempotency key in that same transaction. The public role may insert a request but not read one back: the
// id is made here and the insert returns nothing.
import { createHash, randomInt, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { CoreError } from './errors.ts';
import { lineAmount } from './money.ts';
import { formatRef, type JsonCell, type JsonColumn } from './read.ts';

// The release read a cart is priced from, and the two of its columns intake relies on: one row per orderable item id,
// with its published price (BP-SITES-1 and BP-API-1 mint it; no site.* read is registered yet).
export const CATALOGUE = { query: 'site.catalogue', item: 'item_id', price: 'price' } as const;

const id = z.guid();
const kind = z.enum(['goods', 'stitching', 'alteration']).default('goods');
const cartInput = z.strictObject({
  shopId: id,
  kind,
  lines: z.array(z.strictObject({ itemId: id, qtyMilli: z.number().int().positive().max(1_000_000_000) })).min(1).max(20),
  contactId: id.optional(),
});
const messageInput = z.strictObject({ shopId: id, kind, inboundMessageId: id, contactId: id.optional() });

export type CartRequest = z.input<typeof cartInput>;
export type MessageRequest = z.input<typeof messageInput>;
type CartLine = { itemId: string; qtyMilli: number };

type Ref = string;
// The shapes of packages/contracts' OrderCreated: a price is a published cell with its ref; a line amount and the
// total are derived figures (the counter's line function over those cells), carrying the refs they came from; the
// quantity is the caller's own, labelled as theirs.
export type CartFigures = {
  releaseId: string;
  lines: { itemId: string; qty: { qtyMilli: number; source: 'request' }; price: { minor: number; currency: string; ref: Ref }; amount: { minor: number; currency: string; from: Ref[] } }[];
  total: { minor: number; currency: string; from: Ref[] };
};
export type Intake = { requestId: string; code: string };

function parse<S extends z.ZodType>(s: S, input: unknown): z.output<S> {
  const r = s.safeParse(input);
  if (!r.success) throw new CoreError('invalid', { fields: r.error.issues.map((i) => i.path.join('.') || '(input)') });
  return r.data;
}

// A capability token for the status page (GET /sites/{slug}/orders/{code}): six characters from crypto, with no 0/O,
// 1/I/L to misread.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const newOrderCode = () => `ORD-${Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')}`;
// A request's code, from its random id (randomUUID: 122 random bits, never shown): as unguessable as newOrderCode, and
// derivable again from the id alone, so the public API's idempotency row (which holds ids only) can replay the code.
export const orderCodeFor = (requestId: string) => {
  const h = createHash('sha256').update(`order-code:${requestId}`).digest();
  return `ORD-${Array.from({ length: 6 }, (_, i) => ALPHABET[h.readUInt32BE(i * 4) % ALPHABET.length]).join('')}`;
};

// The figures of `lines` at the release's published cells. No offer discount: an anonymous cart cannot judge one.
export async function priceCart(c: pg.ClientBase, releaseId: string, lines: CartLine[]): Promise<CartFigures> {
  const { rows } = await c.query<{ id: string; columns: JsonColumn[]; rows: JsonCell[][] }>(
    `select s.id::text as id, s.columns, s.rows from ops.site_release r join snap.snapshot s on s.tenant_id = r.tenant_id and s.id = (r.snapshots ->> $2)::uuid
      where r.id = $1`,
    [releaseId, CATALOGUE.query],
  );
  const snap = rows[0];
  if (!snap) throw new CoreError('not_found');
  const itemCol = snap.columns.findIndex((col) => col.n === CATALOGUE.item && col.k === 'text');
  const priceCol = snap.columns.findIndex((col) => col.n === CATALOGUE.price && col.k === 'money');
  if (itemCol < 0 || priceCol < 0) throw new CoreError('not_found');
  const priced = lines.map((l, n) => {
    const row = snap.rows.findIndex((cells) => {
      const cell = cells[itemCol];
      return cell?.k === 'text' && cell.t === l.itemId;
    });
    const cell = snap.rows[row]?.[priceCol];
    if (cell?.k !== 'money') throw new CoreError('invalid', { fields: [`lines.${n}.itemId`] }); // not published, or no price
    const ref = formatRef({ snapshotId: snap.id, row, col: CATALOGUE.price });
    const price = { minor: Number(cell.n), currency: cell.c, ref };
    return { itemId: l.itemId, qty: { qtyMilli: l.qtyMilli, source: 'request' as const }, price, amount: { minor: lineAmount(l.qtyMilli, price.minor), currency: cell.c, from: [ref] } };
  });
  const currency = priced[0]?.price.currency as string;
  if (priced.some((l) => l.price.currency !== currency)) throw new CoreError('invalid', { fields: ['lines'] });
  const total = { minor: priced.reduce((a, l) => a + l.amount.minor, 0), currency, from: [...new Set(priced.map((l) => l.price.ref))] };
  return { releaseId, lines: priced, total };
}

// ORD1's recompute: a stored site or widget request's figures, from its stored release and lines alone.
export async function requestFigures(c: pg.ClientBase, requestId: string): Promise<CartFigures> {
  const { rows } = await c.query<{ release_id: string; lines: CartLine[] }>(
    'select release_id::text as release_id, lines from ops.order_request where id = $1 and release_id is not null',
    [requestId],
  );
  const r = rows[0];
  if (!r) throw new CoreError('not_found');
  return priceCart(c, r.release_id, r.lines);
}

// One insert, under a savepoint so a code already taken (23505 on order_request_code) is retried with a fresh one.
async function store(c: pg.ClientBase, cols: { shopId: string; channel: string; kind: string; releaseId?: string; lines?: CartLine[]; inboundMessageId?: string; contactId?: string | undefined }): Promise<Intake> {
  for (let attempt = 1; ; attempt++) {
    const requestId = randomUUID();
    const code = orderCodeFor(requestId);
    await c.query('savepoint intake');
    try {
      await c.query(
        `insert into ops.order_request (tenant_id, id, code, shop_id, channel, kind, release_id, lines, inbound_message_id, contact_id)
         values (nullif(current_setting('munshi.tenant_id', true), '')::uuid, $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          requestId,
          code,
          cols.shopId,
          cols.channel,
          cols.kind,
          cols.releaseId ?? null,
          cols.lines ? JSON.stringify(cols.lines.map((l) => ({ itemId: l.itemId, qtyMilli: l.qtyMilli }))) : null,
          cols.inboundMessageId ?? null,
          cols.contactId ?? null,
        ],
      );
      await c.query('release savepoint intake');
      return { requestId, code };
    } catch (err) {
      await c.query('rollback to savepoint intake');
      if ((err as { constraint?: string }).constraint !== 'order_request_code' || attempt === 3) throw err;
    }
  }
}

// A cart from the shop's site or a widget: checked against the latest release, priced from its cells, stored.
async function cart(c: pg.ClientBase, channel: 'site' | 'widget', input: CartRequest): Promise<Intake & CartFigures> {
  const i = parse(cartInput, input);
  const { rows } = await c.query<{ id: string }>('select id::text as id from ops.site_release order by published_at desc, id desc limit 1');
  if (!rows[0]) throw new CoreError('not_found');
  const figures = await priceCart(c, rows[0].id, i.lines);
  const stored = await store(c, { shopId: i.shopId, channel, kind: i.kind, releaseId: figures.releaseId, lines: i.lines, contactId: i.contactId });
  return { ...stored, ...figures };
}

async function message(c: pg.ClientBase, channel: 'whatsapp' | 'instagram' | 'voice' | 'photo', input: MessageRequest): Promise<Intake> {
  const i = parse(messageInput, input);
  return store(c, { shopId: i.shopId, channel, kind: i.kind, inboundMessageId: i.inboundMessageId, contactId: i.contactId });
}

export const intakeSite = (c: pg.ClientBase, input: CartRequest) => cart(c, 'site', input);
export const intakeWidget = (c: pg.ClientBase, input: CartRequest) => cart(c, 'widget', input);
export const intakeWhatsapp = (c: pg.ClientBase, input: MessageRequest) => message(c, 'whatsapp', input);
export const intakeInstagram = (c: pg.ClientBase, input: MessageRequest) => message(c, 'instagram', input);
export const intakeVoice = (c: pg.ClientBase, input: MessageRequest) => message(c, 'voice', input);
export const intakePhoto = (c: pg.ClientBase, input: MessageRequest) => message(c, 'photo', input);
