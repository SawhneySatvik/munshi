// Red-proofs of the sites and public gates (test/v2/gates/14-sites.test.ts): each breaks one rule of a 14 trigger,
// constraint, policy or grant.
import type { Case } from '../../sabotage.ts';
import { asOwner, mutate } from './sql.ts';

const V2 = 'vitest.v2.config.ts';
const FILE = 'test/v2/gates/14-sites.test.ts';
const t = (test: string, sabotage: string, sql: string): Case => ({ sabotage, file: FILE, test, config: V2, sql });
const FLOW = 'ops.booking_flow()';

const BK1 = 'BK1 two live bookings of one stylist never overlap; another stylist may take the same time; an expired hold frees its slot';
const BK2 = 'BK2 a booking fits the calendar: its named roster row in effect that day, no leave, no holiday, inside the shop’s hours, the service’s length';
const HOLD1 = 'HOLD1 one live hold per device, three per IP hash, two per stylist and day; a lapsed hold frees its allowance; a hold moves only with its token';
const ROLE1_BOOKING = 'ROLE1 a booking moves by role: the public its own hold, a member a request or a confirmed booking (confirmed only in booking.confirm, done only with its sale), the jobs role an expiry';
const ROLE1_RESERVATION = 'ROLE1 a reservation is asked by the public, held, declined, released or sold by a member (sold only with the sale naming it), and expired by the jobs role';
const ROLE1_REQUEST = 'ROLE1 a request is the public’s, handled once by an active member, closed by the jobs role after 30 days open, and its details purged 7 days after it closed on a demo';
const S10 = 'S10 on a demo the public’s name and note are the samples and any other phone is refused; versions must be current, intake open, the shop the tenant’s own';
const PUB1_READS = 'PUB1 the public reads bookings and pieces as ids and times only, no contact, request, price or name; profiles only shown, looks and art only as a release shows them';
const PUB1_LOOK = 'PUB1 a look holds only the fixed token names, colours as #rrggbb, plain values (no url(), quote or semicolon) and the tenant’s own art';
const S1S2 = 'S1 a publishable key is kept as its sha256, revoked once by an active owner and never restored; S2 a site’s origins are https hosts (localhost only off live) and a booking mode needs the bookings switch';
const S9 = 'S9 a release names site.* release snapshots of its own transaction, published on live by an active owner from a real session, never from a demo one; off live only the owner role publishes';
const ROLE1_14 = 'ROLE1 every role-shaped transition of 14 is refused for every role it does not belong to, and for a jobs or public session that names an actor, then admitted for its own';
const ROLE1_STAFF = 'ROLE1 a staff profile is shown only by an active owner who attests the person agreed, and erases to nothing';

export const SITES_CASES: Case[] = [
  t(BK1, 'v2-bk1-exclusion', 'alter table ops.booking drop constraint booking_no_overlap;'),
  t(BK2, 'v2-bk2-calendar', mutate(FLOW, 'if not fits then', 'if false then')),
  // accept a pattern row on a day a change governs (SLOT1's "accept any shift row")
  t(BK2, 'v2-bk2-any-roster', mutate(FLOW,
    'fits := not exists (select 1 from books.shift_change x where x.tenant_id = new.tenant_id and x.staff_id = new.staff_id and x.day = the_day)', 'fits := true')),
  // the token checked in core only
  t(HOLD1, 'v2-hold1-token', mutate(FLOW,
    "if sha256(convert_to(coalesce(nullif(current_setting('munshi.hold_token', true), ''), ''), 'UTF8')) <> old.hold_token_sha256 then", 'if false then')),
  t(HOLD1, 'v2-hold1-ip-cap', mutate(FLOW, "and b.state = 'held' and b.expires_at > now()) >= 3 then", "and b.state = 'held' and b.expires_at > now()) >= 99 then")),
  t(HOLD1, 'v2-hold1-device', asOwner('drop index ops.one_hold_per_device;')),
  t(HOLD1, 'v2-hold1-stylist-day', mutate(FLOW, "and (lower(b.during) at time zone tz)::date = the_day) >= 2 then", "and (lower(b.during) at time zone tz)::date = the_day) >= 99 then")),
  t(ROLE1_BOOKING, 'v2-role1-booking-confirm', mutate(FLOW, "if new.state = 'confirmed' and (", 'if false and (')),
  t(ROLE1_BOOKING, 'v2-role1-booking-contact', mutate('ops.booking_contact_guard()', " and b.state = 'requested' and b.requested_txid = txid_current()", '')),
  t(ROLE1_RESERVATION, 'v2-role1-reservation-sold', mutate('ops.reservation_flow()', "elsif new.state = 'sold' and not exists (", 'elsif false and not exists (')),
  t(ROLE1_REQUEST, 'v2-role1-request-close', mutate('ops.request_flow()', " or old.created_at > now() - interval '30 days'", '')),
  t(S10, 'v2-s10-demo-phone', mutate('ops.public_intake()', "if r ->> 'contact_phone_e164' is distinct from '+910000000000' then", 'if false then')),
  t(S10, 'v2-s10-versions', mutate('ops.public_intake()',
    "if r ->> 'notice_version' is distinct from s.privacy_version or r ->> 'consent_version' is distinct from s.consent_version then", 'if false then')),
  // widen a column grant; drop a restrictive policy (PUB1's red-proofs)
  t(PUB1_READS, 'v2-pub1-reservation-columns', 'grant select on ops.reservation to munshi_public;'),
  t(PUB1_READS, 'v2-pub1-look-policy', 'drop policy look_public on ops.site_look;'),
  t(PUB1_READS, 'v2-pub1-document-policy', 'drop policy document_public on ops.document;'),
  // the CSS fence: a value may carry url(), a quote or a semicolon
  t(PUB1_LOOK, 'v2-pub1-look-css', mutate('ops.look_check()', " or (t.value #>> '{}') !~ '^[A-Za-z0-9 #.,%_-]{1,40}$'", '')),
  // BUCKET1 for looks: art names any document, or a photo
  t(PUB1_LOOK, 'v2-bucket1-look-art', mutate('ops.look_check()', 'or not exists (select 1 from ops.document d', 'or false and not exists (select 1 from ops.document d')),
  t(PUB1_LOOK, 'v2-bucket1-look-art-kind', mutate('ops.look_check()', " and d.kind = 'art' and d.erased_at is null)) then", ' and d.erased_at is null)) then')),
  t(S1S2, 'v2-s1-key-restored', mutate('ops.site_key_guard()', 'if old.revoked_at is not null or new.revoked_at is null', 'if false')),
  t(S1S2, 'v2-s2-origins', mutate('ops.site_guard()', 'if exists (select 1 from unnest(new.origins) o', 'if false and exists (select 1 from unnest(new.origins) o')),
  t(S1S2, 'v2-s2-bookings-switch', mutate('ops.site_guard()', "if new.booking_mode <> 'none' and not coalesce((", 'if false and not coalesce((')),
  t(S9, 'v2-s9-release-check', asOwner('drop trigger release_check on ops.site_release;')),
  t(S9, 'v2-s9-release-pin', asOwner('drop trigger pin on ops.site_release;')),
  t(S9, 'v2-s9-release-site-only', mutate('ops.release_check()', " and s.query_name like 'site.%'", '')),
  t(S9, 'v2-s9-release-this-tx', mutate('ops.release_check()', ' and s.created_txid = txid_current())) then', ')) then')),
  t(S9, 'v2-s9-release-demo', mutate('ops.release_check()', "raise exception 'release refused: a demo or sandbox session never publishes' using errcode = 'MS010';", 'null;')),
  // an actor on a public or jobs session; the no-actor erasure by a member
  t(ROLE1_14, 'v2-role1-14-booking-actor', mutate(FLOW, "raise exception 'booking refused: an actor is set only by munshi_app' using errcode = 'MS018';", 'null;')),
  t(ROLE1_14, 'v2-role1-14-reservation-actor', mutate('ops.reservation_flow()', "raise exception 'reservation refused: an actor is set only by munshi_app' using errcode = 'MS018';", 'null;')),
  t(ROLE1_14, 'v2-role1-14-contact-purge', mutate('ops.booking_contact_guard()', "raise exception 'booking contact refused: the no-actor erasure is the jobs purge' using errcode = 'MS018';", 'null;')),
  t(ROLE1_STAFF, 'v2-role1-staff-public', mutate('ops.staff_public_guard()', 'if new.consent_at > now() or new.erased_at is not null then', 'if false then')),
];
