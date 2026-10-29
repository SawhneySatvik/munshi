// POST /sites/{slug}/bookings (BLUEPRINT §5.1, §8.8): a held slot becomes a request, with the customer's details in
// ops.booking_contact. A person confirms it later; nothing here touches the books.
import { z } from 'zod';
import { BotToken, Honeypot, Id, Note, PersonName, Phone, Version } from './common.ts';
import { HoldToken } from './holds.ts';

export const BookingBody = z.strictObject({
  holdId: Id,
  holdToken: HoldToken,
  name: PersonName,
  phone: Phone,
  note: Note.optional(),
  whatsappUpdates: z.boolean(),
  noticeVersion: Version,
  consentVersion: Version,
  botToken: BotToken,
  website: Honeypot,
});
