import { describe, expect, test } from 'vitest';
import { parseBuildArgs } from '../../../src/build.ts';

// BUILD-ARGS: the build CLI records a hosted deployment row only for an exact --deployment flag, in either spelling, and
// refuses anything else, so a mistyped flag never builds a hosted database without its row (Munim gotcha 17).
describe('BUILD-ARGS the build CLI flag', () => {
  test('no arguments: no deployment row', () => {
    expect(parseBuildArgs([])).toEqual({});
  });
  test('--deployment demo and --deployment=demo both record a hosted demo row; live likewise', () => {
    expect(parseBuildArgs(['--deployment', 'demo'])).toEqual({ deployment: { kind: 'demo', hosted: true } });
    expect(parseBuildArgs(['--deployment=demo'])).toEqual({ deployment: { kind: 'demo', hosted: true } });
    expect(parseBuildArgs(['--deployment=live'])).toEqual({ deployment: { kind: 'live', hosted: true } });
  });
  test('an unknown value, a missing value, an extra argument or another flag is refused', () => {
    for (const args of [['--deployment=staging'], ['--deployment'], ['--deployment', 'demo', 'x'], ['--deploy=demo'], ['demo']]) {
      expect(() => parseBuildArgs(args), args.join(' ')).toThrow(/--deployment demo\|live/);
    }
  });
});
