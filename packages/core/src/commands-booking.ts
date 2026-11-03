// Commands for bookings. booking.confirm is the one book a booking writes: a named owner or manager confirms a request,
// which writes its customer through the vault and the customer's confirmation message naming the booking, in one
// transaction with the move (z_booking_message refuses the commit without the message, MS007). Holds, requests,
// declines and desk bookings are ops rows (booking.ts). Helpers from commands.ts are used only inside a run, so the
// value import is safe while commands.ts spreads BOOKING_COMMANDS.
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { type CommandResult, type Ctx, type Def, one } from './commands.ts';
import { CoreError } from './errors.ts';

const id = z.guid();

// customerId: the desk names a customer it already knows; otherwise the booking's contact row is the customer.
const bookingConfirm = z.strictObject({ bookingId: id, customerId: id.optional() });

function def<S extends z.ZodType>(input: S, run: (ctx: Ctx, input: z.output<S>) => Promise<CommandResult>): Def {
  return { input, run: run as Def['run'] };
}

type Request = {
  state: string;
  contact_name: string | null;
  contact_phone_e164: string | null;
  wa_updates: boolean | null;
  shop: string;
  service: string;
  on_day: string;
  at_time: string;
};

// The customer the booking's contact names: the live vault contact with that phone (one per tenant, contact_phone) and
// the customer it is the current link of; else a new customer, and a new contact if there is none. On a demo every
// request carries the sample phone, so every demo booking finds the one sample customer.
async function customerOf(ctx: Ctx, b: Request): Promise<string> {
  const { c, t } = ctx;
  if (!b.contact_name || !b.contact_phone_e164) throw new CoreError('invalid', { fields: ['customerId'] }); // erased, or never given
  const { rows } = await c.query<{ contact_id: string; customer_id: string | null }>(
    `select ct.id::text as contact_id,
            (select p.customer_id::text from books.party_contact p
              where p.contact_id = ct.id and p.customer_id is not null and p.effective_from <= now()
                and p.id = (select x.id from books.party_contact x where x.tenant_id = p.tenant_id and x.customer_id = p.customer_id
                             and x.effective_from <= now() order by x.effective_from desc, x.created_at desc, x.id desc limit 1)
              order by p.created_at, p.id limit 1) as customer_id
       from ops.contact ct where ct.phone_e164 = $1 and ct.erased_at is null`,
    [b.contact_phone_e164],
  );
  if (rows[0]?.customer_id) return rows[0].customer_id;
  const contactId =
    rows[0]?.contact_id ??
    (await one<{ id: string }>(c, 'insert into ops.contact (tenant_id, name, phone_e164) values ($1, $2, $3) returning id', [t.tenantId, b.contact_name, b.contact_phone_e164]))
      .id;
  const customerId = randomUUID();
  await c.query('insert into books.customer (tenant_id, id) values ($1, $2)', [t.tenantId, customerId]);
  await c.query('insert into books.party_contact (tenant_id, customer_id, contact_id, effective_from) values ($1, $2, $3, now())', [
    t.tenantId,
    customerId,
    contactId,
  ]);
  return customerId;
}

export const BOOKING_COMMANDS: [string, Def][] = [
  [
    'booking.confirm',
    def(bookingConfirm, async (ctx, i) => {
      const { c, t } = ctx;
      // The day and time in the shop's zone, read where the zone lives (ops.tenant); the service's current name.
      const b = await one<Request>(
        c,
        `select b.state, bc.contact_name, bc.contact_phone_e164, bc.wa_updates, s.name as shop,
                (select r.name from books.item_revision r where r.tenant_id = b.tenant_id and r.item_id = b.service_item_id and r.effective_from <= now()
                  order by r.effective_from desc, r.created_at desc, r.id desc limit 1) as service,
                to_char(lower(b.during) at time zone tn.time_zone, 'FMDD Mon YYYY') as on_day,
                to_char(lower(b.during) at time zone tn.time_zone, 'HH24:MI') as at_time
           from ops.booking b
           join ops.shop s on s.tenant_id = b.tenant_id and s.id = b.shop_id
           join ops.tenant tn on tn.tenant_id = b.tenant_id
           left join ops.booking_contact bc on bc.tenant_id = b.tenant_id and bc.booking_id = b.id
          where b.id = $1
            for update of b`,
        [i.bookingId],
      );
      if (b.state !== 'requested') throw new CoreError('conflict', { fields: ['bookingId'] });
      const customerId = i.customerId ?? (await customerOf(ctx, b));
      await c.query(`update ops.booking set state = 'confirmed', customer_id = $2 where id = $1`, [i.bookingId, customerId]);
      const body = `${t.name}: your booking is confirmed. ${b.service} at ${b.shop}, ${b.on_day} at ${b.at_time}.`;
      const text = await one<{ id: string; body_sha256: Buffer }>(
        c,
        `insert into ops.message_text (tenant_id, body, author) values ($1, $2, 'template') returning id, body_sha256`,
        [t.tenantId, body],
      );
      const messageId = randomUUID();
      await c.query(
        `insert into books.outbound_message (tenant_id, id, channel, recipient_kind, recipient_id, template_code, text_id, body_sha256, booking_id)
         values ($1, $2, $3, 'customer', $4, 'booking_confirmed', $5, $6, $7)`,
        [t.tenantId, messageId, b.wa_updates === false ? 'sms' : 'whatsapp', customerId, text.id, text.body_sha256, i.bookingId],
      );
      return { bookingId: i.bookingId, customerId, messageId, textId: text.id };
    }),
  ],
];
