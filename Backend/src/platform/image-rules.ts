export type BrandingKindName = 'logo' | 'favicon';

export const IMAGE_LIMITS: Record<BrandingKindName, { maxBytes: number; types: string[] }> = {
  logo: { maxBytes: 1024 * 1024, types: ['image/png', 'image/jpeg', 'image/webp'] },
  favicon: { maxBytes: 256 * 1024, types: ['image/png', 'image/x-icon'] },
};

/**
 * What the file really is, from its first bytes (never from its name or the type the browser
 * claims). SVG is refused on purpose: it can carry script and would be served from this origin.
 */
export function sniffImage(
  buffer: Buffer,
): 'image/png' | 'image/jpeg' | 'image/webp' | 'image/x-icon' | null {
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buffer.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (
    buffer.length >= 4 &&
    buffer[0] === 0 &&
    buffer[1] === 0 &&
    buffer[2] === 1 &&
    buffer[3] === 0
  ) {
    return 'image/x-icon';
  }
  return null;
}

export function checkImage(
  kind: BrandingKindName,
  buffer: Buffer,
): { ok: true; contentType: string } | { ok: false; message: string } {
  const limit = IMAGE_LIMITS[kind];
  if (buffer.length === 0) return { ok: false, message: 'The file is empty' };
  if (buffer.length > limit.maxBytes) {
    return {
      ok: false,
      message: `The ${kind} must be ${Math.round(limit.maxBytes / 1024)} KB or smaller`,
    };
  }
  const type = sniffImage(buffer);
  if (!type || !limit.types.includes(type)) {
    return {
      ok: false,
      message: `The ${kind} must be a ${kind === 'logo' ? 'PNG, JPEG or WebP' : 'PNG or ICO'} image (SVG is not accepted)`,
    };
  }
  return { ok: true, contentType: type };
}
