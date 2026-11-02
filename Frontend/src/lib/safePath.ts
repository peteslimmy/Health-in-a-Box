/**
 * A post-sign-in redirect must stay inside this app. Anything that could leave the origin
 * (absolute URLs, protocol-relative `//host`, backslash tricks, scripts) falls back to the home page.
 */
export function safeInternalPath(candidate: unknown, fallback = '/'): string {
  if (typeof candidate !== 'string' || candidate.length === 0 || candidate.length > 500) return fallback;
  if (!candidate.startsWith('/')) return fallback;
  if (candidate.startsWith('//') || candidate.startsWith('/\\')) return fallback;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(candidate)) return fallback;
  try {
    const url = new URL(candidate, 'https://app.invalid');
    if (url.origin !== 'https://app.invalid') return fallback;
  } catch {
    return fallback;
  }
  return candidate;
}
