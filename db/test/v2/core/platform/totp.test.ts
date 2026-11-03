// TOTP1's code arithmetic: RFC 6238 with HMAC-SHA-1, 6 digits and 30-second steps, one step of drift
// each way and no more; the secret at rest opens only under its key and for its own operator. No database: the codes'
// single use is in propose.test.ts. Red-proofs: test/v2/sabotage/core-platform.ts.
import { expect, it } from 'vitest';
import { base32, hotp, matchStep, openSecret, sealSecret, stepAt } from '../../../../../packages/core/src/platform-totp.ts';

const RFC_KEY = Buffer.from('12345678901234567890'); // RFC 6238 Appendix B, the SHA-1 seed

it('codes are RFC 6238 (SHA-1, 30-second steps), accepted one step either side and no further; a secret opens only under its key for its own operator', () => {
  // Appendix B's SHA-1 rows (8 digits there; the 6-digit code is the low six).
  const vectors: [number, string][] = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ];
  for (const [seconds, code] of vectors) {
    expect(hotp(RFC_KEY, stepAt(seconds * 1000), 8), `T=${seconds}`).toBe(code);
    expect(hotp(RFC_KEY, stepAt(seconds * 1000))).toBe(code.slice(2));
  }
  const now = stepAt(Date.now());
  for (const drift of [-1, 0, 1]) expect(matchStep(RFC_KEY, hotp(RFC_KEY, now + drift), now)).toBe(now + drift);
  for (const drift of [-3, -2, 2, 3]) expect(matchStep(RFC_KEY, hotp(RFC_KEY, now + drift), now), `drift ${drift}`).toBeNull();
  expect(matchStep(RFC_KEY, '12345', now)).toBeNull();
  expect(matchStep(RFC_KEY, ' 287082', now)).toBeNull();
  // RFC 4648 base32, as authenticator apps read the secret.
  expect(base32(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
  expect(base32(RFC_KEY)).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');

  const key = 'platform-secret-for-the-v2-tests-only-0001';
  const sealed = sealSecret(RFC_KEY, 'subject-a', key);
  expect(sealed.length).toBe(48);
  expect(openSecret(sealed, 'subject-a', key)).toEqual(RFC_KEY);
  expect(openSecret(sealed, 'subject-b', key)).toBeNull();
  expect(openSecret(sealed, 'subject-a', `${key}x`)).toBeNull();
});
