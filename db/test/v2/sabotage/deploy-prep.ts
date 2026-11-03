// Red-proofs of the three-project Vercel layout (test/v2/deploy/vercel.test.ts), vercel-env's per-project names
// (VERCEL-ENV2, test/v2/deploy/vercel-env.test.ts), the hosted wipe (WIPE1, test/v2/deploy/hosted-wipe.test.ts) and the
// Storage bucket script (BUCKET1, test/v2/deploy/storage-bucket.test.ts). Each breaks one protection; the named test
// must then fail.
import type { Case } from './case.ts';

const V2 = 'vitest.v2.config.ts';
const VERCEL = 'test/v2/deploy/vercel.test.ts';
const SITES = 'a site project builds into .next with no base path, and takes its business only from the project’s MUNSHI_SITE';
const IGNORE = 'the root has no multi-service vercel.json, and .vercelignore keeps settings files and the local database out of the upload';
const ENV2 = 'each project gets only its own names: the web app the database, secrets and model keys; a site its business, the API origin and its own key';
const WIPE = 'test/v2/deploy/hosted-wipe.test.ts';
const WIPE_LIVE = 'refuses a live deployment and changes nothing';
const WIPE_DROP = 'drops every Munshi schema, stray object and role, and leaves Supabase’s schemas, the extension and the admin’s own objects';
const WIPE_GUARD = 'refuses when a Munshi role owns anything in a Supabase schema, and changes nothing';
const BUCKET = 'test/v2/deploy/storage-bucket.test.ts';
const BUCKET_MADE = 'an absent bucket is created private; a private one is left alone; a public one is refused and nothing is sent';

export const DEPLOY_PREP_CASES: Case[] = [
  // harness-level: the sites' build without its output folder, or with a business fixed in the file
  { sabotage: 'v2-vercel-sites-dist', file: VERCEL, test: SITES, config: V2 },
  { sabotage: 'v2-vercel-sites-slug-in-file', file: VERCEL, test: SITES, config: V2 },
  // harness-level: .vercelignore without its rule for settings files, or for the local database
  { sabotage: 'v2-vercelignore-env', file: VERCEL, test: IGNORE, config: V2 },
  { sabotage: 'v2-vercelignore-run', file: VERCEL, test: IGNORE, config: V2 },
  // a site project handed the web app's database URLs and secrets
  {
    sabotage: 'v2-vercel-env-site-secrets',
    file: 'test/v2/deploy/vercel-env.test.ts',
    test: ENV2,
    config: V2,
    ts: { file: 'deploy/vercel-env.ts', from: '    values.MUNSHI_SITE = site;\n', to: '    values.MUNSHI_SITE = site;\n    Object.assign(values, production);\n' },
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
