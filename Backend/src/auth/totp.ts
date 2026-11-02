import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/** RFC 6238 time-based one-time passwords (HMAC-SHA1, 6 digits, 30-second steps), as used by every authenticator app. */
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Steps accepted either side of the current one, to tolerate clock drift between phone and server. */
export const TOTP_WINDOW = 1;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Invalid base32 text');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new 160-bit secret, base32 encoded for the authenticator app. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpStep(timeMs: number): number {
  return Math.floor(timeMs / 1000 / TOTP_STEP_SECONDS);
}

export function hotp(secret: string, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', base32Decode(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

export function totpAt(secret: string, timeMs: number): string {
  return hotp(secret, totpStep(timeMs));
}

/**
 * Returns the time step the code belongs to, or null when it is wrong. A step at or before
 * `lastUsedStep` is refused, so a code that was already accepted (or one older than it) cannot be replayed.
 */
export function verifyTotp(
  secret: string,
  code: string,
  timeMs: number,
  lastUsedStep: number | null,
): number | null {
  const cleaned = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(cleaned)) return null;
  const current = totpStep(timeMs);
  let match: number | null = null;
  // Every candidate is compared, so timing does not reveal which step matched.
  for (let step = current - TOTP_WINDOW; step <= current + TOTP_WINDOW; step += 1) {
    const expected = Buffer.from(hotp(secret, step));
    if (timingSafeEqual(expected, Buffer.from(cleaned)) && match === null) match = step;
  }
  if (match === null) return null;
  if (lastUsedStep !== null && match <= lastUsedStep) return null;
  return match;
}

/** The address an authenticator app turns into an account entry (shown as text and as a typed-in key). */
export function otpauthUri(secret: string, accountEmail: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${accountEmail}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
