// @vitest-environment node
// The file the app serves (apps/web/public/widgets/munshi-order.js) is a fresh build of packages/widgets, one classic
// script: no import, no require, no URL to fetch code from, so a page that embeds it runs no third-party code.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { bundle, OUT } from '../build.ts';

test('WID5 the served widget file is a fresh build of the source, a classic script with nothing loaded from elsewhere', async () => {
  const onDisk = readFileSync(OUT, 'utf8');
  expect(onDisk === (await bundle()), 'apps/web/public/widgets/munshi-order.js is stale: run node packages/widgets/build.ts').toBe(true);
  expect(onDisk).not.toMatch(/\bimport\s*\(|^\s*import\s|\brequire\(|\bimportScripts\(|<script|https?:\/\/[a-z]/m);
  expect(onDisk).toContain("customElements.define(\"munshi-order\"");
});
