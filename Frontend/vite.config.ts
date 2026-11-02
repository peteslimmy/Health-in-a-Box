import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
};

// Everything the app loads comes from its own origin; nothing is inline. (Not applied to the dev
// server, whose hot-reload client needs inline script.) Serve the same policy as an HTTP header
// in production; the meta tag is a second layer.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

// In development the browser talks only to this origin; /api is proxied to the Nest API, so the
// httpOnly refresh cookie stays same-origin and CORS is not involved.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'hnb-csp-meta',
        transformIndexHtml(html: string, context: { server?: unknown }) {
          if (context.server) return html;
          return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
        },
      },
    ],
    server: {
      port: 5173,
      strictPort: true,
      headers: securityHeaders,
      proxy: { '/api': { target: env.VITE_API_TARGET || 'http://localhost:4000', changeOrigin: false } },
    },
    preview: {
      port: 4173,
      headers: { ...securityHeaders, 'Content-Security-Policy': CSP },
      proxy: { '/api': { target: env.VITE_API_TARGET || 'http://localhost:4000', changeOrigin: false } },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      css: false,
      // Form tests type character by character; a busy machine can exceed the 5 s default.
      testTimeout: 20_000,
    },
  };
});
