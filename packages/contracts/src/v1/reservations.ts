// POST /sites/{slug}/reservations: hold a piece. One ops.reservation, requested; stock never moves. qtyMilli is
// required because ops.reservation.qty_milli is not null (one piece is 1000).
import { z } from 'zod';
import { BotToken, Honeypot, Id, Note, PersonName, Phone, Version } from './common.ts';
import { QtyMilli } from './lib.ts';

export const ReservationBody = z.strictObject({
  itemId: Id,
  qtyMilli: QtyMilli,
  name: PersonName,
  phone: Phone,
  note: Note.optional(),
  noticeVersion: Version,
  consentVersion: Version,
  botToken: BotToken,
  website: Honeypot,
});
