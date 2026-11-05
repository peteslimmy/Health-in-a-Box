import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useAuth, useUser } from '../auth/AuthContext';
import { api } from '../lib/api';
import { can } from '../lib/permissions';
import type { WorkQueue } from '../lib/types';
import { BrandMark, useBranding } from './Branding';
import { Button, cx } from './ui';

type NavItem = { to: string; label: string; permission?: string; end?: boolean };

const NAV: Array<{ heading: string; items: NavItem[] }> = [
  {
    heading: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', permission: 'dashboard.read', end: true },
      { to: '/work', label: 'My work' },
    ],
  },
  {
    heading: 'Setup',
    items: [{ to: '/hospitals', label: 'Hospitals', permission: 'hospitals.read' }],
  },
  {
    heading: 'Revenue and charges',
    items: [
      { to: '/imports', label: 'Revenue imports', permission: 'imports.read' },
      { to: '/charge-runs', label: 'Service charges', permission: 'charge_runs.read' },
    ],
  },
  {
    heading: 'Collections',
    items: [
      { to: '/receivables', label: 'Receivables', permission: 'receivables.read' },
      { to: '/payments', label: 'Payments', permission: 'payments.read' },
      { to: '/adjustments', label: 'Adjustments', permission: 'adjustments.read' },
    ],
  },
  {
    heading: 'Insight',
    items: [{ to: '/reports', label: 'Reports', permission: 'reports.read' }],
  },
  {
    heading: 'Control',
    items: [
      { to: '/audit', label: 'Audit trail', permission: 'audit.read' },
      { to: '/admin/users', label: 'Users', permission: 'users.read' },
      { to: '/admin/roles', label: 'Roles', permission: 'roles.read' },
      { to: '/admin/platform', label: 'Platform settings', permission: 'platform.manage' },
      { to: '/security', label: 'My sign-in security' },
    ],
  },
];

/** The number of things waiting for the user, shown beside "My work". */
function WorkBadge() {
  const queue = useQuery({ queryKey: ['work-queue'], queryFn: () => api<WorkQueue>('/work-queue'), refetchInterval: 60_000, staleTime: 30_000, retry: false });
  const total = queue.data?.total ?? 0;
  if (total === 0) return null;
  return (
    <span
      className={cx(
        'ml-2 rounded-full px-1.5 py-0.5 text-xs font-semibold tabular-nums',
        queue.data?.urgent ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800',
      )}
      aria-label={`${total} waiting`}
    >
      {total}
    </span>
  );
}

export function Layout() {
  const user = useUser();
  const { signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const branding = useBranding();

  const sections = NAV.map((section) => ({
    ...section,
    items: section.items.filter((item) => !item.permission || can(user, item.permission)),
  })).filter((section) => section.items.length > 0);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15rem_1fr]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <aside className={cx('border-r border-slate-200 bg-white lg:block print:hidden', open ? 'block' : 'hidden')} aria-label="Main navigation">
        <div className="flex items-center gap-3 px-4 py-4">
          {branding.logoUrl && <BrandMark className="!h-9 !max-w-[3.5rem]" />}
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-brand-700">{branding.appName}</p>
            <p className="truncate text-xs text-slate-500">{branding.tagline ?? 'Service-charge management'}</p>
          </div>
        </div>
        <nav className="space-y-4 px-2 pb-4">
          {sections.map((section) => (
            <div key={section.heading}>
              <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{section.heading}</p>
              <ul>
                {section.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      onClick={() => setOpen(false)}
                      className={({ isActive }) =>
                        cx('block rounded-md px-2 py-1.5 text-sm', isActive ? 'bg-brand-50 font-medium text-brand-700' : 'text-slate-700 hover:bg-slate-100')
                      }
                    >
                      {item.label}
                      {item.to === '/work' && <WorkBadge />}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      <div className="min-w-0">
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2 print:hidden">
          <Button variant="secondary" className="lg:hidden" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
            Menu
          </Button>
          <p className="hidden text-sm text-slate-500 lg:block" aria-live="polite">
            {user.allHospitals ? 'All hospitals' : `${user.hospitalIds.length} assigned hospital${user.hospitalIds.length === 1 ? '' : 's'}`}
          </p>
          <div className="flex items-center gap-3">
            <div className="text-right text-sm">
              <p className="font-medium text-slate-800">{user.fullName}</p>
              <p className="text-xs text-slate-500">{user.roleCodes.join(', ')}</p>
            </div>
            <Button variant="secondary" onClick={() => void signOut()}>
              Sign out
            </Button>
          </div>
        </header>
        <main id="main" key={location.pathname} className="mx-auto max-w-7xl p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
