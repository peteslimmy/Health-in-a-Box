import { decryptSecret, encryptSecret } from './mfa-crypto';
import { isPrivileged, mfaRequired, parseEnforcement } from './mfa-policy';
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  hotp,
  otpauthUri,
  totpAt,
  verifyTotp,
} from './totp';

// RFC 6238 appendix B secret ("12345678901234567890"); the RFC lists 8 digits, we use the last 6.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP (RFC 6238)', () => {
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ])('matches the published test vector at t=%i', (seconds, expected) => {
    expect(totpAt(RFC_SECRET, seconds * 1000)).toBe(expected);
  });

  it('round-trips base32 and generates distinct 160-bit secrets', () => {
    const a = generateTotpSecret();
    expect(base32Decode(a)).toHaveLength(20);
    expect(base32Encode(base32Decode(a))).toBe(a);
    expect(generateTotpSecret()).not.toBe(a);
    expect(() => base32Decode('not*valid')).toThrow();
  });

  it('accepts the current code and one step either side, nothing further', () => {
    const now = 1_700_000_000_000;
    const at = (offsetSteps: number) => totpAt(RFC_SECRET, now + offsetSteps * 30_000);
    expect(verifyTotp(RFC_SECRET, at(0), now, null)).not.toBeNull();
    expect(verifyTotp(RFC_SECRET, at(-1), now, null)).not.toBeNull();
    expect(verifyTotp(RFC_SECRET, at(1), now, null)).not.toBeNull();
    expect(verifyTotp(RFC_SECRET, at(-2), now, null)).toBeNull();
    expect(verifyTotp(RFC_SECRET, at(2), now, null)).toBeNull();
  });

  it('refuses a code from a step that was already used, or an earlier one', () => {
    const now = 1_700_000_000_000;
    const code = totpAt(RFC_SECRET, now);
    const step = verifyTotp(RFC_SECRET, code, now, null)!;
    expect(verifyTotp(RFC_SECRET, code, now, step)).toBeNull();
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, now - 30_000), now, step)).toBeNull();
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, now + 30_000), now, step)).not.toBeNull();
  });

  it('tolerates spaces and rejects anything that is not six digits', () => {
    const now = 1_700_000_000_000;
    const code = totpAt(RFC_SECRET, now);
    expect(
      verifyTotp(RFC_SECRET, `${code.slice(0, 3)} ${code.slice(3)}`, now, null),
    ).not.toBeNull();
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 34 5x']) {
      expect(verifyTotp(RFC_SECRET, bad, now, null)).toBeNull();
    }
  });

  it('keeps leading zeros', () => {
    expect(hotp(RFC_SECRET, 0)).toMatch(/^\d{6}$/);
    expect(totpAt(RFC_SECRET, 1234567890 * 1000)).toBe('005924');
  });

  it('builds an address an authenticator app understands', () => {
    const uri = otpauthUri('ABC234', 'a.b@hospital.org', 'HNB Receivables');
    expect(uri).toContain('otpauth://totp/HNB%20Receivables%3Aa.b%40hospital.org?');
    expect(uri).toContain('secret=ABC234');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });
});

describe('secret encryption', () => {
  it('round-trips and never stores the plain secret', () => {
    const stored = encryptSecret('JBSWY3DPEHPK3PXP', 'key-material-one');
    expect(stored).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decryptSecret(stored, 'key-material-one')).toBe('JBSWY3DPEHPK3PXP');
  });

  it('uses a fresh nonce each time and fails with the wrong key or altered data', () => {
    const a = encryptSecret('SECRET', 'k');
    expect(encryptSecret('SECRET', 'k')).not.toBe(a);
    expect(() => decryptSecret(a, 'other')).toThrow();
    const parts = a.split('.');
    parts[3] = Buffer.from('tampered').toString('base64');
    expect(() => decryptSecret(parts.join('.'), 'k')).toThrow();
    expect(() => decryptSecret('garbage', 'k')).toThrow();
  });
});

describe('who needs a second factor', () => {
  const approver = { permissions: ['payments.read', 'payments.approve'] };
  const reader = { permissions: ['payments.read', 'reports.read'] };

  it('treats approvers, posters and administrators as privileged', () => {
    for (const code of [
      'users.manage',
      'roles.manage',
      'charge_runs.approve',
      'charge_runs.post',
      'payments.approve',
      'payments.post',
      'payments.reverse',
      'adjustments.approve',
      'imports.commit',
    ]) {
      expect(isPrivileged({ permissions: [code] })).toBe(true);
    }
    expect(isPrivileged(reader)).toBe(false);
  });

  it('applies the chosen enforcement, and always asks anyone who has enrolled', () => {
    expect(mfaRequired(approver, false, 'privileged')).toBe(true);
    expect(mfaRequired(reader, false, 'privileged')).toBe(false);
    expect(mfaRequired(reader, true, 'privileged')).toBe(true);
    expect(mfaRequired(reader, false, 'all')).toBe(true);
    expect(mfaRequired(approver, false, 'off')).toBe(false);
    expect(mfaRequired(approver, true, 'off')).toBe(true);
  });

  it('defaults to privileged in production and off elsewhere', () => {
    expect(parseEnforcement(undefined, true)).toBe('privileged');
    expect(parseEnforcement(undefined, false)).toBe('off');
    expect(parseEnforcement('all', false)).toBe('all');
    expect(parseEnforcement('nonsense', true)).toBe('privileged');
  });
});
