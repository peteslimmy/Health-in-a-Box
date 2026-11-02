/**
 * Who may sign in, by email address.
 *
 *  - A Gmail address can belong only to a super admin. Every other Gmail address is blocked.
 *  - A super admin must be registered with a Gmail address.
 *  - Everyone else needs an email at a domain on the approved list.
 */
export const SUPER_ADMIN_ROLE = 'SUPER_ADMIN';

/** Consumer mailbox domains reserved for super admins; they can never be placed on the approved list. */
export const GMAIL_DOMAINS: ReadonlySet<string> = new Set(['gmail.com', 'googlemail.com']);

export type AccessDecision =
  | { allowed: true }
  | {
      allowed: false;
      code: 'GMAIL_RESERVED' | 'SUPER_ADMIN_NEEDS_GMAIL' | 'DOMAIN_NOT_APPROVED' | 'INVALID_EMAIL';
      message: string;
    };

/** The part after the last "@", lower case; null when there is none. */
export function emailDomain(email: string): string | null {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at < 1 || at === trimmed.length - 1) return null;
  return trimmed.slice(at + 1);
}

export const isGmailDomain = (domain: string) => GMAIL_DOMAINS.has(domain.trim().toLowerCase());

/** A plain host name such as `4coretech.com`: letters, digits and hyphens in labels, at least one dot. */
const DOMAIN_PATTERN = /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function normaliseDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '');
}

export function checkApprovableDomain(
  input: string,
): { ok: true; domain: string } | { ok: false; message: string } {
  const domain = normaliseDomain(input);
  if (!DOMAIN_PATTERN.test(domain)) {
    return {
      ok: false,
      message: 'Enter a domain such as example.com (no @, no spaces, no wildcards)',
    };
  }
  if (isGmailDomain(domain)) {
    return {
      ok: false,
      message: 'Gmail cannot be approved. Gmail addresses are reserved for registered super admins',
    };
  }
  return { ok: true, domain };
}

export function evaluateAccess(input: {
  email: string;
  isSuperAdmin: boolean;
  approvedDomains: ReadonlySet<string>;
}): AccessDecision {
  const domain = emailDomain(input.email);
  if (!domain) {
    return { allowed: false, code: 'INVALID_EMAIL', message: 'The email address is not valid' };
  }
  const gmail = isGmailDomain(domain);
  if (input.isSuperAdmin) {
    return gmail
      ? { allowed: true }
      : {
          allowed: false,
          code: 'SUPER_ADMIN_NEEDS_GMAIL',
          message: 'A super admin must be registered with a Gmail address',
        };
  }
  if (gmail) {
    return {
      allowed: false,
      code: 'GMAIL_RESERVED',
      message: 'Gmail addresses are blocked. Only registered super admins may use Gmail',
    };
  }
  if (!input.approvedDomains.has(domain)) {
    return {
      allowed: false,
      code: 'DOMAIN_NOT_APPROVED',
      message: `The email domain "${domain}" is not on the approved list for this application`,
    };
  }
  return { allowed: true };
}
