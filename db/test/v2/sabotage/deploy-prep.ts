// Red-proofs of the one-project, three-service Vercel layout (test/v2/deploy/vercel.test.ts), vercel-env's names
// (VERCEL-ENV2, test/v2/deploy/vercel-env.test.ts), the hosted wipe (WIPE1, test/v2/deploy/hosted-wipe.test.ts) and the
// Storage bucket script (BUCKET1, test/v2/deploy/storage-bucket.test.ts). Each breaks one protection; the named test
// must then fail.
import type { Case } from './case.ts';

const V2 = 'vitest.v2.config.ts';
const VERCEL = 'test/v2/deploy/vercel.test.ts';
const SERVICES = 'one project, three services, each from its own folder, installing and building only its own app; the top level holds no build or runtime key';
const ROUTING = 'each site is bound to the web app as WEB_URL and routed at its own /s/<slug>, its app’s base path; everything else goes to the web app';
const IGNORE = '.vercelignore keeps settings files and the local database out of the upload, and lets the root vercel.json go up';
const ENV2 = 'the one project gets the web app’s names and the sites’ keys; never a site’s address, a business or a shared key';
const WIPE = 'test/v2/deploy/hosted-wipe.test.ts';
const WIPE_LIVE = 'refuses a live deployment and changes nothing';
const WIPE_DROP = 'drops every Munshi schema, stray object and role, and leaves Supabase’s schemas, the extension and the admin’s own objects';
const WIPE_GUARD = 'refuses when a Munshi role owns anything in a Supabase schema, and changes nothing';
const BUCKET = 'test/v2/deploy/storage-bucket.test.ts';
const BUCKET_MADE = 'an absent bucket is created private; a private one is left alone; a public one is refused and nothing is sent';

export const DEPLOY_PREP_CASES: Case[] = [
  // harness-level: two site services built from one folder (the earlier previews' failure), or a site's build moved out
  // of .next, the folder Vercel packages
  { sabotage: 'v2-vercel-services-shared-root', file: VERCEL, test: SERVICES, config: V2 },
  { sabotage: 'v2-vercel-sites-dist', file: VERCEL, test: SERVICES, config: V2 },
  // harness-level: a site without its binding to the web app, or the web app's catch-all ahead of the sites' paths
  { sabotage: 'v2-vercel-site-unbound', file: VERCEL, test: ROUTING, config: V2 },
  { sabotage: 'v2-vercel-catch-all-first', file: VERCEL, test: ROUTING, config: V2 },
  // harness-level: .vercelignore without its rule for settings files, or for the local database
  { sabotage: 'v2-vercelignore-env', file: VERCEL, test: IGNORE, config: V2 },
  { sabotage: 'v2-vercelignore-run', file: VERCEL, test: IGNORE, config: V2 },
  // a site's key accepted under the other business's name
  {
    sabotage: 'v2-vercel-env-key-swapped',
    file: 'test/v2/deploy/vercel-env.test.ts',
    test: ENV2,
    config: V2,
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the source text to break, not a template
    ts: { file: 'deploy/vercel-env.ts', from: 'new RegExp(`^mpk_${slug}_[A-Za-z0-9_-]{43}$`)', to: 'new RegExp("^mpk_[a-z]+_[A-Za-z0-9_-]{43}$")' },
  },
  // a site's API address or a one-key name accepted through --set
  {
    sabotage: 'v2-vercel-env-site-address',
    file: 'test/v2/deploy/vercel-env.test.ts',
    test: ENV2,
    config: V2,
    ts: { file: 'deploy/vercel-env.ts', from: '|NEXT_PUBLIC_MUNSHI_SITE_SAMPLE)$/;', to: '|NEXT_PUBLIC_MUNSHI_SITE_SAMPLE|MUNSHI_API_URL|MUNSHI_SITE_KEY)$/;' },
  },
  // a checkout linked to another project accepted
  {
    sabotage: 'v2-vercel-env-any-link',
    file: 'test/v2/deploy/vercel-env.test.ts',
    test: ENV2,
    config: V2,
    ts: { file: 'deploy/vercel-env.ts', from: '  if (linked !== project) {', to: '  if (false) {' },
  },
  // the wipe run on a live deployment
  { sabotage: 'v2-wipe-live', file: WIPE, test: WIPE_LIVE, config: V2, ts: { file: 'db/src/hosted-wipe.ts', from: '    if (plan.live) throw', to: '    if (false) throw' } },
  // the wipe's schema list widened past Munshi's own to Supabase's
  {
    sabotage: 'v2-wipe-widened',
    file: WIPE,
    test: WIPE_DROP,
    config: V2,
    ts: { file: 'db/src/hosted-wipe.ts', from: "order by 1', [MUNSHI_SCHEMAS])", to: "order by 1', [[...MUNSHI_SCHEMAS, \"auth\", \"storage\", \"realtime\"]])" },
  },
  // the wipe without its guard on Supabase's schemas
  { sabotage: 'v2-wipe-protected', file: WIPE, test: WIPE_GUARD, config: V2, ts: { file: 'db/src/hosted-wipe.ts', from: '    if (plan.protectedHits.length) throw', to: '    if (false) throw' } },
  // the bucket created public
  { sabotage: 'v2-bucket-public', file: BUCKET, test: BUCKET_MADE, config: V2, ts: { file: 'deploy/storage-bucket.ts', from: 'name: opts.bucket, public: false', to: 'name: opts.bucket, public: true' } },
  // a public bucket accepted as it is
  { sabotage: 'v2-bucket-public-kept', file: BUCKET, test: BUCKET_MADE, config: V2, ts: { file: 'deploy/storage-bucket.ts', from: 'if (bucket.public !== false) throw', to: 'if (false) throw' } },
];
