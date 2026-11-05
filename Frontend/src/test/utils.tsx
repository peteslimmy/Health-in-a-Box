import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { SessionUser } from '../lib/api';

export function makeSessionUser(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: 'user-1',
    organizationId: 'org-1',
    email: 'user@test.local',
    fullName: 'Test User',
    roleCodes: ['TEST'],
    permissions: [],
    allHospitals: true,
    hospitalIds: [],
    hospitals: [{ id: 'hospital-1', code: 'HNB-1', name: 'Test Hospital' }],
    ...overrides,
  };
}

export function renderWithProviders(ui: ReactElement, options: { path?: string; route?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  const path = options.path ?? '/';
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[options.route ?? path]}>
        <Routes>
          <Route path={path} element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
