import { afterEach, expect, it, vi } from 'vitest';
import { href } from '../lib/i18n.ts';

afterEach(() => vi.unstubAllEnvs());

it('BASEPATH every internal link stays under the site prefix, including locale and order links', () => {
  vi.stubEnv('NEXT_PUBLIC_MUNSHI_SITES_BASE_PATH', '/s/elite');
  expect(href('en', '/')).toBe('/s/elite/');
  expect(href('en', '/catalogue/item-1')).toBe('/s/elite/catalogue/item-1');
  expect(href('hi', '/catalogue')).toBe('/s/elite/hi/catalogue');
  expect(href('hi', '/')).toBe('/s/elite/hi');
  expect(href('en', '#opening-hours')).toBe('#opening-hours');
});
