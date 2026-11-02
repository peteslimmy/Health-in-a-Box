import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from '../lib/api';
import { cx } from './ui';

export type Branding = { appName: string; tagline: string | null; logoUrl: string | null; faviconUrl: string | null };

const DEFAULTS: Branding = { appName: 'HNB Receivables', tagline: null, logoUrl: null, faviconUrl: null };

/** The product name, logo and favicon set by the super admin. Public, so the sign-in page can use it. */
export function useBranding(): Branding {
  const { data } = useQuery({
    queryKey: ['branding'],
    queryFn: () => api<Branding>('/branding'),
    staleTime: 5 * 60_000,
    retry: false,
  });
  return data ?? DEFAULTS;
}

/** Puts the product name in the browser tab and swaps in the favicon, when one was uploaded. */
export function BrandingEffects() {
  const { appName, faviconUrl } = useBranding();
  useEffect(() => {
    document.title = appName;
  }, [appName]);
  useEffect(() => {
    if (!faviconUrl) return;
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = faviconUrl;
  }, [faviconUrl]);
  return null;
}

/** The uploaded logo, or the standard mark when none has been uploaded. */
export function BrandMark({ className }: { className?: string }) {
  const { logoUrl, appName } = useBranding();
  if (logoUrl) {
    return <img src={logoUrl} alt={`${appName} logo`} className={cx('h-11 w-auto max-w-[9rem] object-contain', className)} />;
  }
  return (
    <div className={cx('flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-lg shadow-brand-700/30', className)} aria-hidden="true">
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 19V9m5 10V5m5 14v-7m5 7V8" />
      </svg>
    </div>
  );
}
