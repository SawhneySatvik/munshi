// An operator's second factor (BLUEPRINT §6.5, review N4): RFC 6238 TOTP with HMAC-SHA-1, 6 digits and 30-second steps,
// one step of drift each way; and the secret at rest, sealed with AES-256-GCM under a key derived from
// MUNSHI_PLATFORM_SECRET, with the operator's subject as associated data so a sealed secret copied onto another
// operator's row does not open. That a code counts once is platform.ts's (totp_last_step).
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { CoreError } from './errors.ts';

export const STEP_SECONDS = 30;
export const stepAt = (ms: number) => Math.floor(ms / 1000 / STEP_SECONDS);

// RFC 4226 HOTP: the HMAC of the 8-byte big-endian counter, dynamically truncated (RFC 6238 counts steps with it).
export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', secret).update(msg).digest();
  const at = (mac[mac.length - 1] as number) & 0x0f;
  return String((mac.readUInt32BE(at) & 0x7fffffff) % 10 ** digits).padStart(digits, '0');
}

// The step whose code this is, among the current one and one either side, or null.
export function matchStep(secret: Buffer, code: string, nowStep: number): number | null {
  if (!/^[0-9]{6}$/.test(code)) return null;
  for (const step of [nowStep + 1, nowStep, nowStep - 1]) {
    if (timingSafeEqual(Buffer.from(hotp(secret, step)), Buffer.from(code))) return step;
  }
  return null;
}

// RFC 4648 base32 without padding, as authenticator apps read a secret.
export function base32(bytes: Buffer): string {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let out = '';
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return bits > 0 ? out + ALPHABET[(value << (5 - bits)) & 31] : out;
}

export const newTotpSecret = () => randomBytes(20);

export const otpauthUri = (secret: Buffer, label: string) =>
  `otpauth://totp/Munshi:${encodeURIComponent(label)}?secret=${base32(secret)}&issuer=Munshi&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;

function keyOf(platformSecret: string): Buffer {
  if (platformSecret.length < 32) throw new CoreError('invalid', { fields: ['platformSecret'] });
  return Buffer.from(hkdfSync('sha256', platformSecret, 'munshi.platform', 'operator totp secret', 32));
}

// iv (12) · tag (16) · ciphertext: 48 bytes for a 20-byte secret.
export function sealSecret(secret: Buffer, subject: string, platformSecret: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyOf(platformSecret), iv);
  cipher.setAAD(Buffer.from(subject));
  const body = Buffer.concat([cipher.update(secret), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

export function openSecret(sealed: Buffer, subject: string, platformSecret: string): Buffer | null {
  const decipher = createDecipheriv('aes-256-gcm', keyOf(platformSecret), sealed.subarray(0, 12));
  decipher.setAAD(Buffer.from(subject));
  decipher.setAuthTag(sealed.subarray(12, 28));
  try {
    return Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]);
  } catch {
    return null; // another key, another operator's row, or edited bytes
  }
}
