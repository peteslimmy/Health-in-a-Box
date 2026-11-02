import { describe, expect, it } from 'vitest';
import { safeInternalPath } from './safePath';

describe('safeInternalPath (post-sign-in redirect)', () => {
  it('keeps ordinary in-app paths, including query strings', () => {
    expect(safeInternalPath('/payments')).toBe('/payments');
    expect(safeInternalPath('/receivables?openOnly=true&page=2')).toBe('/receivables?openOnly=true&page=2');
    expect(safeInternalPath('/centres/6f0b3c2e-1111-2222-3333-444455556666')).toBe('/centres/6f0b3c2e-1111-2222-3333-444455556666');
  });

  it.each([
    'https://evil.example/phish',
    'http://evil.example',
    '//evil.example',
    '///evil.example',
    '/\\evil.example',
    '\\\\evil.example',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'evil.example',
    '/ok\r\nSet-Cookie: x=1',
    '/ok\\..\\evil',
    '',
    'x'.repeat(600),
  ])('falls back to the home page for %j', (candidate) => {
    expect(safeInternalPath(candidate)).toBe('/');
  });

  it('falls back for non-strings and honours a custom fallback', () => {
    expect(safeInternalPath(undefined)).toBe('/');
    expect(safeInternalPath({ to: '/x' })).toBe('/');
    expect(safeInternalPath('//x', '/login')).toBe('/login');
  });
});
