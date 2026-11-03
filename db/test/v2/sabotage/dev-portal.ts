// Red-proofs of the developer portal: apps/web/test/{developers.test.tsx,kit.test.ts}, run by the web vitest
// config (its sabotage plugin applies the ts cases). Each breaks one thing the portal promises; the named test must fail.
import type { Case } from './case.ts';

const WEB = { dir: 'apps/web', config: 'vitest.config.ts' } as const;
const DEV = 'test/developers.test.tsx';
const KIT = 'test/kit.test.ts';

const FRESH = 'the bundle the portal imports is a fresh build of docs/kit, the examples, openapi.json and the SDK tarball';
const REF =
  'every route of the route table is on the reference with its method, path, auth, status and errors; every published read shows its example';
const PAGES =
  "every portal page renders in the site's frame with its title; an unknown one is a 404; errors and the SDK as the contracts and the tarball say";
const EX = 'every published read has a recorded example that parses with its schema and still answers now';
const SDK = 'the offered tarball is the file in public/, at the sha256 shown, with no dependencies, packed from the SDK as it stands';

export const DEV_PORTAL_CASES: Case[] = [
  // the bundle drops the recorded examples from the reference: the committed bundle is no longer a fresh build
  { sabotage: 'v2-dev-kit-stale', file: DEV, test: FRESH, ...WEB, ts: { file: 'apps/web/scripts/kit.ts', from: 'example: ex ? {', to: 'example: false ? {' } },
  // the reference hides the deferred routes
  {
    sabotage: 'v2-dev-ref-deferred-hidden',
    file: DEV,
    test: REF,
    ...WEB,
    ts: { file: 'apps/web/components/dev/Reference.tsx', from: 'const shown = routes.filter(', to: 'const shown = routes.filter((r) => !r.deferred).filter(' },
  },
  // the error table leaves the auth page
  {
    sabotage: 'v2-dev-errors-dropped',
    file: DEV,
    test: PAGES,
    ...WEB,
    ts: { file: 'apps/web/components/dev/KitPageView.tsx', from: '{slug === "auth-and-errors" ? <ErrorTable /> : null}', to: '{null}' },
  },
  // the contracts change under the recorded examples: a catalogue item gains a field the examples lack
  {
    sabotage: 'v2-dev-example-stale',
    file: KIT,
    test: EX,
    ...WEB,
    ts: { file: 'packages/contracts/src/v1/catalogue.ts', from: 'export const CatalogueItem = z.strictObject({ id: Id,', to: 'export const CatalogueItem = z.strictObject({ id: Id, sku: Id,' },
  },
  // the portal shows a sha256 that is not the tarball's
  {
    sabotage: 'v2-dev-sdk-sha',
    file: KIT,
    test: SDK,
    ...WEB,
    ts: { file: 'apps/web/lib/kit.ts', from: 'export const KIT = bundle as', to: 'export const KIT = { ...bundle, sdk: { ...bundle.sdk, sha256: "0".repeat(64) } } as' },
  },
];
