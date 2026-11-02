import {
  checkApprovableDomain,
  emailDomain,
  evaluateAccess,
  normaliseDomain,
} from './access-rules';

const approved = new Set(['4coretech.com', 'uath.gov.ng']);
const check = (email: string, isSuperAdmin = false) =>
  evaluateAccess({ email, isSuperAdmin, approvedDomains: approved });

describe('who may sign in by email address', () => {
  it('lets a registered super admin use Gmail without any list', () => {
    expect(check('owner@gmail.com', true)).toEqual({ allowed: true });
    expect(check('OWNER@GMAIL.COM', true)).toEqual({ allowed: true });
    expect(check('owner@googlemail.com', true)).toEqual({ allowed: true });
  });

  it('blocks every other Gmail address, whatever the list says', () => {
    const decision = check('someone@gmail.com');
    expect(decision).toMatchObject({ allowed: false, code: 'GMAIL_RESERVED' });
    const even = evaluateAccess({
      email: 'someone@gmail.com',
      isSuperAdmin: false,
      approvedDomains: new Set(['gmail.com']),
    });
    expect(even).toMatchObject({ allowed: false, code: 'GMAIL_RESERVED' });
    expect(check('x@googlemail.com')).toMatchObject({ allowed: false, code: 'GMAIL_RESERVED' });
  });

  it('requires a super admin to be registered with a Gmail address', () => {
    expect(check('boss@4coretech.com', true)).toMatchObject({
      allowed: false,
      code: 'SUPER_ADMIN_NEEDS_GMAIL',
    });
  });

  it('allows other people only at an approved domain', () => {
    expect(check('peter@4coretech.com')).toEqual({ allowed: true });
    expect(check('Peter@4CoreTech.com')).toEqual({ allowed: true });
    expect(check('nurse@uath.gov.ng')).toEqual({ allowed: true });
    expect(check('a@other.com')).toMatchObject({ allowed: false, code: 'DOMAIN_NOT_APPROVED' });
  });

  it('does not treat a look-alike or a sub-domain as approved', () => {
    expect(check('a@evil-4coretech.com')).toMatchObject({ allowed: false });
    expect(check('a@4coretech.com.evil.org')).toMatchObject({ allowed: false });
    expect(check('a@mail.4coretech.com')).toMatchObject({ allowed: false });
    expect(check('a@4coretech.co')).toMatchObject({ allowed: false });
  });

  it('has nobody approved when the list is empty, except super admins', () => {
    const none = (email: string, isSuperAdmin: boolean) =>
      evaluateAccess({ email, isSuperAdmin, approvedDomains: new Set() });
    expect(none('peter@4coretech.com', false)).toMatchObject({ allowed: false });
    expect(none('owner@gmail.com', true)).toEqual({ allowed: true });
  });

  it('refuses addresses without a usable domain', () => {
    for (const bad of ['', 'plain', '@4coretech.com', 'a@', 'a b']) {
      expect(check(bad)).toMatchObject({ allowed: false });
    }
  });

  it('reads the domain after the last @', () => {
    expect(emailDomain('a@b.com')).toBe('b.com');
    expect(emailDomain('"a@b"@4coretech.com')).toBe('4coretech.com');
    expect(emailDomain('nope')).toBeNull();
  });
});

describe('the approved domain list', () => {
  it('normalises what people paste', () => {
    expect(normaliseDomain('  @4CoreTech.com ')).toBe('4coretech.com');
    expect(normaliseDomain('https://4coretech.com/path')).toBe('4coretech.com');
  });

  it('accepts ordinary domains', () => {
    expect(checkApprovableDomain('4coretech.com')).toEqual({ ok: true, domain: '4coretech.com' });
    expect(checkApprovableDomain('mail.uath.gov.ng')).toEqual({
      ok: true,
      domain: 'mail.uath.gov.ng',
    });
  });

  it('never accepts Gmail, however it is written', () => {
    for (const gmail of [
      'gmail.com',
      'GMAIL.COM',
      '@gmail.com',
      'googlemail.com',
      'https://gmail.com',
    ]) {
      const result = checkApprovableDomain(gmail);
      expect(result).toMatchObject({ ok: false });
      expect((result as { message: string }).message).toMatch(/Gmail/);
    }
  });

  it.each(['*.com', 'com', 'a b.com', '-x.com', 'x..com', 'localhost', '4coretech', 'x.c', ''])(
    'rejects %p',
    (bad) => {
      expect(checkApprovableDomain(bad)).toMatchObject({ ok: false });
    },
  );
});
