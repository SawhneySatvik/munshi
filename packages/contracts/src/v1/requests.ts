// POST /sites/{slug}/booking-requests and /enquiries (BLUEPRINT §5.1, §8.11): one ops.site_request each. The branch is
// required because ops.site_request.shop_id is not null; serviceIds are its item_ids (at most 3).
import { z } from 'zod';
import { BotToken, Honeypot, Id, IsoDate, Note, PersonName, Phone, TimeWindow, Version } from './common.ts';

export const BookingRequestBody = z.strictObject({
  shopId: Id,
  name: PersonName,
  phone: Phone,
  serviceIds: z.array(Id).min(1).max(3),
  preferredOn: IsoDate,
  timeWindow: TimeWindow,
  note: Note.optional(),
  whatsappUpdates: z.boolean(),
  noticeVersion: Version,
  consentVersion: Version,
  botToken: BotToken,
  website: Honeypot,
});
export const EnquiryBody = z.strictObject({
  shopId: Id,
  name: PersonName,
  phone: Phone,
  itemId: Id.optional(),
  message: z.string().min(1).max(500),
  whatsappUpdates: z.boolean(),
  noticeVersion: Version,
  consentVersion: Version,
  botToken: BotToken,
  website: Honeypot,
});
