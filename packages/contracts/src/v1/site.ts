// GET /sites/{slug} (BLUEPRINT §5.1, §5.5): the site, its branches and the published look. The token names, colour and
// value rules are look_check's (db/schema/14_sites_public.sql), so a look the contract accepts the database accepts.
import { z } from 'zod';
import { Id, MediaPath, Slug, Timestamp, Version } from './common.ts';

const Colour = z.string().regex(/^#[0-9a-f]{6}$/);
// No quote, bracket, colon or semicolon: no url() or other CSS reaches a page.
const Plain = z.string().regex(/^[A-Za-z0-9 #.,%_-]{1,40}$/);

export const TokenSet = z.strictObject({
  '--ground': Colour.optional(),
  '--surface': Colour.optional(),
  '--ink': Colour.optional(),
  '--ink-muted': Colour.optional(),
  '--hairline': Colour.optional(),
  '--accent': Colour.optional(),
  '--accent-ink': Colour.optional(),
  '--signal': Colour.optional(),
  '--ok': Colour.optional(),
  '--warn': Colour.optional(),
  '--danger': Colour.optional(),
  '--radius-card': Plain.optional(),
  '--radius-chip': Plain.optional(),
  '--space-1': Plain.optional(),
  '--space-2': Plain.optional(),
  '--space-3': Plain.optional(),
  '--space-4': Plain.optional(),
  '--space-5': Plain.optional(),
  '--space-6': Plain.optional(),
  '--space-7': Plain.optional(),
  '--space-8': Plain.optional(),
  '--figure-xl': Plain.optional(),
  '--figure-l': Plain.optional(),
  '--figure-m': Plain.optional(),
  '--font-display': Plain.optional(),
  '--font-text': Plain.optional(),
  '--font-figures': Plain.optional(),
  '--font-deva-display': Plain.optional(),
  '--font-deva-text': Plain.optional(),
  '--motion-quick': Plain.optional(),
  '--motion-sheet': Plain.optional(),
});
export const Tokens = z.union([TokenSet, z.strictObject({ light: TokenSet, dark: TokenSet })]);

// The merchant's copy per language code: the languages are the country pack's, not the contract's.
export const LocalText = z.record(z.string().regex(/^[a-z]{2}$/), z.string().min(1).max(2000));
export const Profile = z.strictObject({
  tagline: LocalText.optional(),
  story: z.array(LocalText).max(20).optional(),
  sections: z.array(z.string().regex(/^[a-z_]{2,40}$/)).max(30).optional(),
  faq: z.array(z.strictObject({ q: LocalText, a: LocalText })).max(30).optional(),
  hoursNote: LocalText.optional(),
});
export const Look = z.strictObject({
  tokens: Tokens,
  fontPair: z.string().regex(/^[a-z0-9_]{2,40}$/),
  profile: Profile,
  art: z.record(z.string().regex(/^[a-z_]{2,40}$/), MediaPath),
});

const Clock = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/);
export const Hours = z.strictObject({
  day: z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']),
  closed: z.boolean(),
  opens: Clock.nullable(),
  closes: Clock.nullable(),
});
export const Shop = z.strictObject({
  id: Id,
  name: z.string().min(1).max(80),
  area: z.string().max(80).nullable(),
  hours: z.array(Hours).max(7),
});
export const SiteRelease = z.strictObject({ id: Id, publishedAt: Timestamp });
export const Site = z.strictObject({
  slug: Slug,
  name: z.string().min(1).max(120),
  businessType: z.string().regex(/^[a-z_]{2,40}$/),
  dataClass: z.enum(['synthetic', 'showcase', 'live']),
  // "Simulated means labelled": every non-live site says so on the page.
  label: z.literal('Sample site').nullable(),
  shops: z.array(Shop).min(1).max(20),
  bookingMode: z.enum(['none', 'request', 'slots']),
  intake: z.enum(['open', 'paused']),
  noticeVersion: Version,
  consentVersion: Version,
  look: Look,
  // The capabilities on when the release was published (its site.capabilities cells): a widget for one not listed
  // renders nothing.
  capabilities: z.array(z.string().regex(/^[a-z_]{2,40}$/)).max(40),
  release: SiteRelease,
});
