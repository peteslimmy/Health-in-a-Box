/** Where the application is allowed to send mail from, and what a settings form may contain. */
export const SMTP_PORTS = [25, 465, 587, 2525] as const;

/** Ready-made settings for common providers; the person still supplies their own user and key. */
export const SMTP_PRESETS: Array<{
  id: string;
  label: string;
  host: string;
  port: number;
  secure: boolean;
  userHint: string;
  keyHint: string;
}> = [
  {
    id: 'sendgrid',
    label: 'SendGrid',
    host: 'smtp.sendgrid.net',
    port: 587,
    secure: false,
    userHint: 'apikey',
    keyHint: 'A SendGrid API key',
  },
  {
    id: 'mailgun',
    label: 'Mailgun',
    host: 'smtp.mailgun.org',
    port: 587,
    secure: false,
    userHint: 'postmaster@your-domain',
    keyHint: 'The SMTP password for that user',
  },
  {
    id: 'brevo',
    label: 'Brevo (Sendinblue)',
    host: 'smtp-relay.brevo.com',
    port: 587,
    secure: false,
    userHint: 'Your Brevo login email',
    keyHint: 'An SMTP key',
  },
  {
    id: 'postmark',
    label: 'Postmark',
    host: 'smtp.postmarkapp.com',
    port: 587,
    secure: false,
    userHint: 'Server API token',
    keyHint: 'The same server API token',
  },
  {
    id: 'ses',
    label: 'Amazon SES',
    host: 'email-smtp.eu-west-1.amazonaws.com',
    port: 587,
    secure: false,
    userHint: 'SMTP user name',
    keyHint: 'SMTP password',
  },
  {
    id: 'gmail',
    label: 'Gmail / Google Workspace',
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    userHint: 'Your full address',
    keyHint: 'An app password (not your login password)',
  },
  {
    id: 'office365',
    label: 'Microsoft 365',
    host: 'smtp.office365.com',
    port: 587,
    secure: false,
    userHint: 'Your full address',
    keyHint: 'The mailbox password or app password',
  },
];

const HOSTNAME = /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Addresses a mail server must never be, so the settings page cannot be used to probe the host's own network. */
export function isPrivateAddress(host: string): boolean {
  const lower = host.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.localhost') || lower.endsWith('.internal'))
    return true;
  if (lower.includes(':')) return true; // IPv6 literals are not accepted at all
  const match = IPV4.exec(lower);
  if (!match) return false;
  const [a, b] = [Number(match[1]), Number(match[2])];
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

export function checkSmtpHost(
  input: string,
): { ok: true; host: string } | { ok: false; message: string } {
  const host = input.trim().toLowerCase();
  if (isPrivateAddress(host)) {
    return {
      ok: false,
      message: 'The mail server must be a public address, not one inside this network',
    };
  }
  if (!HOSTNAME.test(host) && !IPV4.test(host)) {
    return { ok: false, message: 'Enter the mail server name, for example smtp.example.com' };
  }
  return { ok: true, host };
}
