// The route table of API v1 (BLUEPRINT §5.1): every route under /api/v1, its auth mode (§5.2), its parts and the error
// codes it may answer (§5.3). Route handlers parse with these same schemas (§5.6), with three rules the schemas cannot
// carry:
//   - a path parameter that fails its schema is an unknown route: 404 not_found, never 400 (an unknown slug, a bad order
//     code and a malformed one answer byte-identically, Munim gotcha 16);
//   - every POST and DELETE carries Idempotency-Key, and its absence is idempotency_key_required, not invalid;
//   - a publishable key that is bad, revoked or used from a wrong origin is not_found, as an unknown route.
// Not here: /api/internal/tick, /api/webhooks/whatsapp and /api/health live outside /api/v1 and are no public API.
import type { z } from 'zod';
import { ListQuery, Received, SlugParams, WriteHeaders } from './common.ts';
import { BookingBody } from './bookings.ts';
import { CataloguePage, CatalogueQuery } from './catalogue.ts';
import { DraftProposal, DraftProposed, DraftsPage, DraftsQuery, FindingsPage, FindingsQuery } from './developer.ts';
import type { ErrorCodeName } from './errors.ts';
import { HoldBody, HoldCreated, HoldHeaders, HoldParams, HoldReleased, ReleaseHoldHeaders } from './holds.ts';
import { MediaParams } from './media.ts';
import { OffersPage } from './offers.ts';
import { OrderBody, OrderCreated, OrderStatus, OrderStatusParams } from './orders.ts';
import { PackagesPage } from './packages.ts';
import { RefAnswer, RefParams } from './refs.ts';
import { BookingRequestBody, EnquiryBody } from './requests.ts';
import { ReservationBody } from './reservations.ts';
import { ServicesPage } from './services.ts';
import { Site } from './site.ts';
import { Slots, SlotsQuery } from './slots.ts';
import { StylistsPage, StylistsQuery } from './stylists.ts';

export type RouteDef = {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  // none: published reads by slug; publishable: mpk_<slug>_… in Authorization: Bearer; secret: msk_<slug>_… (deferred)
  auth: 'none' | 'publishable' | 'secret';
  summary: string;
  params: z.ZodType | undefined;
  query: z.ZodType | undefined;
  headers: z.ZodType | undefined;
  body: z.ZodType | undefined;
  status: 200 | 201 | 202;
  response: z.ZodType | 'image/jpeg' | 'image/svg+xml';
  errors: readonly ErrorCodeName[];
  cache: string;
  writes: string | undefined;
  deferred: boolean;
};

const PUBLISHED = 'public, s-maxage=60';
const GET_ERRORS = ['not_found', 'rate_limited', 'internal'] as const;
const LIST_ERRORS = ['invalid', ...GET_ERRORS] as const;
const WRITE_ERRORS = [
  'invalid',
  'idempotency_key_required',
  'not_found',
  'idempotency_mismatch',
  'payload_too_large',
  'unsupported_media_type',
  'rate_limited',
  'internal',
] as const;
const FORM_ERRORS = [...WRITE_ERRORS, 'stale_notice', 'bot_check', 'intake_paused'] as const;

const read = { method: 'GET', auth: 'none', headers: undefined, body: undefined, status: 200, writes: undefined, deferred: false } as const;
const write = { method: 'POST', auth: 'publishable', query: undefined, cache: 'no-store', deferred: false } as const;

export const routes = {
  site: {
    ...read,
    path: '/sites/{slug}',
    summary: 'The site, its branches, the published look and the release it was built from',
    params: SlugParams,
    query: undefined,
    response: Site,
    errors: GET_ERRORS,
    cache: PUBLISHED,
  },
  catalogue: {
    ...read,
    path: '/sites/{slug}/catalogue',
    summary: 'Goods from the latest release: parents with variants, each price a figure',
    params: SlugParams,
    query: CatalogueQuery,
    response: CataloguePage,
    errors: LIST_ERRORS,
    cache: PUBLISHED,
  },
  services: {
    ...read,
    path: '/sites/{slug}/services',
    summary: 'Services with duration and price figures, and the branches that offer each',
    params: SlugParams,
    query: ListQuery,
    response: ServicesPage,
    errors: LIST_ERRORS,
    cache: PUBLISHED,
  },
  packages: {
    ...read,
    path: '/sites/{slug}/packages',
    summary: 'Plans with their lines, sessions, validity and price figures',
    params: SlugParams,
    query: ListQuery,
    response: PackagesPage,
    errors: LIST_ERRORS,
    cache: PUBLISHED,
  },
  offers: {
    ...read,
    path: '/sites/{slug}/offers',
    summary: 'Published offers still in effect, with the codes the owner chose to publish',
    params: SlugParams,
    query: ListQuery,
    response: OffersPage,
    errors: LIST_ERRORS,
    cache: PUBLISHED,
  },
  stylists: {
    ...read,
    path: '/sites/{slug}/stylists',
    summary: 'The opted-in public staff profiles',
    params: SlugParams,
    query: StylistsQuery,
    response: StylistsPage,
    errors: LIST_ERRORS,
    cache: PUBLISHED,
  },
  slots: {
    ...read,
    path: '/sites/{slug}/slots',
    summary: "Free start times for one day, each naming the roster row it comes from",
    params: SlugParams,
    query: SlotsQuery,
    response: Slots,
    errors: LIST_ERRORS,
    cache: 'no-store',
  },
  mediaJpg: {
    ...read,
    path: '/sites/{slug}/media/{id}.jpg',
    summary: 'A card document a release names',
    params: MediaParams,
    query: undefined,
    response: 'image/jpeg',
    errors: GET_ERRORS,
    cache: 'public, max-age=3600',
  },
  mediaSvg: {
    ...read,
    path: '/sites/{slug}/media/{id}.svg',
    summary: 'An art document a release names',
    params: MediaParams,
    query: undefined,
    response: 'image/svg+xml',
    errors: GET_ERRORS,
    cache: 'public, max-age=3600',
  },
  ref: {
    ...read,
    path: '/sites/{slug}/refs/{snapshot}/{row}/{col}',
    summary: 'One published cell and the book row it came from, or "Cannot verify"',
    params: RefParams,
    query: undefined,
    response: RefAnswer,
    errors: GET_ERRORS,
    cache: PUBLISHED,
  },
  hold: {
    ...write,
    path: '/sites/{slug}/holds',
    summary: 'Hold a slot for ten minutes',
    params: SlugParams,
    headers: HoldHeaders,
    body: HoldBody,
    status: 201,
    response: HoldCreated,
    errors: [...WRITE_ERRORS, 'bot_check', 'slot_taken', 'hold_limit', 'intake_paused'],
    writes: 'one ops.booking (held)',
  },
  releaseHold: {
    ...write,
    method: 'DELETE',
    path: '/sites/{slug}/holds/{id}',
    summary: 'Release a hold before it expires',
    params: HoldParams,
    headers: ReleaseHoldHeaders,
    body: undefined,
    status: 200,
    response: HoldReleased,
    errors: ['invalid', 'idempotency_key_required', 'not_found', 'idempotency_mismatch', 'rate_limited', 'internal'],
    writes: "the hold's state (cancelled)",
  },
  book: {
    ...write,
    path: '/sites/{slug}/bookings',
    summary: 'Turn a hold into a booking request; the shop confirms it',
    params: SlugParams,
    headers: WriteHeaders,
    body: BookingBody,
    status: 202,
    response: Received,
    errors: FORM_ERRORS,
    writes: 'the booking (requested) and its ops.booking_contact',
  },
  requestBooking: {
    ...write,
    path: '/sites/{slug}/booking-requests',
    summary: 'Ask for a booking on a day and time window (shops in request mode)',
    params: SlugParams,
    headers: WriteHeaders,
    body: BookingRequestBody,
    status: 202,
    response: Received,
    errors: FORM_ERRORS,
    writes: 'one ops.site_request (booking_request)',
  },
  enquire: {
    ...write,
    path: '/sites/{slug}/enquiries',
    summary: 'Send the shop a question',
    params: SlugParams,
    headers: WriteHeaders,
    body: EnquiryBody,
    status: 202,
    response: Received,
    errors: FORM_ERRORS,
    writes: 'one ops.site_request (enquiry)',
  },
  reserve: {
    ...write,
    path: '/sites/{slug}/reservations',
    summary: 'Ask the shop to hold a piece',
    params: SlugParams,
    headers: WriteHeaders,
    body: ReservationBody,
    status: 202,
    response: Received,
    errors: FORM_ERRORS,
    writes: 'one ops.reservation (requested)',
  },
  order: {
    ...write,
    path: '/sites/{slug}/orders',
    summary: "Send a cart as an order request: today's published prices, no offer discount, a WhatsApp message to send",
    params: SlugParams,
    headers: WriteHeaders,
    body: OrderBody,
    status: 201,
    response: OrderCreated,
    errors: [...WRITE_ERRORS, 'intake_paused'],
    writes: 'one ops.order_request (site or widget, new)',
  },
  orderStatus: {
    ...read,
    path: '/sites/{slug}/orders/{code}',
    summary: "An order's steps so far and its current step; no personal data, no amount",
    params: OrderStatusParams,
    query: undefined,
    response: OrderStatus,
    errors: GET_ERRORS,
    cache: 'no-store',
  },
  findings: {
    ...read,
    auth: 'secret',
    path: '/findings',
    summary: 'Findings as ids, codes and figures (secret key; deferred)',
    params: undefined,
    query: FindingsQuery,
    response: FindingsPage,
    errors: LIST_ERRORS,
    cache: 'no-store',
    deferred: true,
  },
  drafts: {
    ...read,
    auth: 'secret',
    path: '/drafts',
    summary: 'Drafts as ids, codes and refs (secret key; deferred)',
    params: undefined,
    query: DraftsQuery,
    response: DraftsPage,
    errors: LIST_ERRORS,
    cache: 'no-store',
    deferred: true,
  },
  proposeDraft: {
    ...write,
    auth: 'secret',
    path: '/drafts',
    summary: 'Propose a draft for a person to approve; never decides or executes (secret key; deferred)',
    params: undefined,
    headers: WriteHeaders,
    body: DraftProposal,
    status: 202,
    response: DraftProposed,
    errors: WRITE_ERRORS,
    writes: 'one approval.draft (proposed)',
    deferred: true,
  },
} as const satisfies Record<string, RouteDef>;

export type Routes = typeof routes;
export type OperationId = keyof Routes;
