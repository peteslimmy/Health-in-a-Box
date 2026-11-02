import { checkImage, sniffImage } from './image-rules';
import { checkSmtpHost, isPrivateAddress } from './smtp-rules';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.alloc(4),
  Buffer.from('WEBP'),
  Buffer.alloc(16),
]);
const ICO = Buffer.concat([Buffer.from([0, 0, 1, 0]), Buffer.alloc(32)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

describe('images for the logo and favicon', () => {
  it('recognises the file from its first bytes, not its name', () => {
    expect(sniffImage(PNG)).toBe('image/png');
    expect(sniffImage(JPEG)).toBe('image/jpeg');
    expect(sniffImage(WEBP)).toBe('image/webp');
    expect(sniffImage(ICO)).toBe('image/x-icon');
    expect(sniffImage(Buffer.from('GIF89a'))).toBeNull();
    expect(sniffImage(Buffer.alloc(0))).toBeNull();
  });

  it('accepts a PNG, JPEG or WebP logo and a PNG or ICO favicon', () => {
    expect(checkImage('logo', PNG)).toEqual({ ok: true, contentType: 'image/png' });
    expect(checkImage('logo', JPEG)).toMatchObject({ ok: true });
    expect(checkImage('logo', WEBP)).toMatchObject({ ok: true });
    expect(checkImage('favicon', PNG)).toMatchObject({ ok: true });
    expect(checkImage('favicon', ICO)).toEqual({ ok: true, contentType: 'image/x-icon' });
  });

  it('refuses the wrong kind of image for each slot', () => {
    expect(checkImage('logo', ICO)).toMatchObject({ ok: false });
    expect(checkImage('favicon', JPEG)).toMatchObject({ ok: false });
    expect(checkImage('favicon', WEBP)).toMatchObject({ ok: false });
  });

  it('never accepts SVG, which can carry script, or a script renamed as an image', () => {
    expect(checkImage('logo', SVG)).toMatchObject({ ok: false });
    expect(checkImage('favicon', SVG)).toMatchObject({ ok: false });
    expect(checkImage('logo', Buffer.from('<script>alert(1)</script>'))).toMatchObject({
      ok: false,
    });
  });

  it('enforces the size limits and refuses an empty file', () => {
    expect(checkImage('logo', Buffer.concat([PNG, Buffer.alloc(1024 * 1024)]))).toMatchObject({
      ok: false,
    });
    expect(checkImage('favicon', Buffer.concat([ICO, Buffer.alloc(256 * 1024)]))).toMatchObject({
      ok: false,
    });
    expect(checkImage('logo', Buffer.alloc(0))).toMatchObject({ ok: false });
  });
});

describe('the mail server address', () => {
  it('accepts public host names', () => {
    expect(checkSmtpHost(' SMTP.SendGrid.net ')).toEqual({ ok: true, host: 'smtp.sendgrid.net' });
    expect(checkSmtpHost('smtp.gmail.com')).toMatchObject({ ok: true });
    expect(checkSmtpHost('203.0.113.7')).toMatchObject({ ok: true });
  });

  it.each([
    'localhost',
    'db.localhost',
    'host.internal',
    '127.0.0.1',
    '10.0.0.5',
    '172.16.4.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    '[::1]',
  ])('refuses %s, so the page cannot be used to probe the internal network', (host) => {
    expect(isPrivateAddress(host)).toBe(true);
    expect(checkSmtpHost(host)).toMatchObject({ ok: false });
  });

  it('does not mistake nearby public ranges for private ones', () => {
    expect(isPrivateAddress('172.32.0.1')).toBe(false);
    expect(isPrivateAddress('11.0.0.1')).toBe(false);
    expect(isPrivateAddress('192.169.0.1')).toBe(false);
  });

  it.each(['not a host', 'smtp', 'smtp..example.com', 'http://smtp.example.com', ''])(
    'rejects %p',
    (host) => {
      expect(checkSmtpHost(host)).toMatchObject({ ok: false });
    },
  );
});
