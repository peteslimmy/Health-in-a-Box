import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { BrandingEffects } from './components/Branding';
import { Layout } from './components/Layout';
import { can } from './lib/permissions';
import { Loading } from './components/ui';
import { AdjustmentsPage } from './pages/AdjustmentsPage';
import { AuditPage } from './pages/AuditPage';
import { HospitalDetailPage } from './pages/HospitalDetailPage';
import { HospitalFormPage } from './pages/HospitalFormPage';
import { HospitalSetupWizardPage } from './pages/HospitalSetupWizardPage';
import { HospitalsPage } from './pages/HospitalsPage';
import { ChargeRunDetailPage } from './pages/ChargeRunDetailPage';
import { ChargeRunNewPage } from './pages/ChargeRunNewPage';
import { ChargeRunsPage } from './pages/ChargeRunsPage';
import { DashboardPage } from './pages/DashboardPage';
import { ImportDetailPage } from './pages/ImportDetailPage';
import { ImportNewPage } from './pages/ImportNewPage';
import { ImportsPage } from './pages/ImportsPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PaymentDetailPage } from './pages/PaymentDetailPage';
import { PlatformSettingsPage } from './pages/PlatformSettingsPage';
import { PaymentNewPage } from './pages/PaymentNewPage';
import { PaymentsPage } from './pages/PaymentsPage';
import { ReceivableDetailPage } from './pages/ReceivableDetailPage';
import { ReceivablesPage } from './pages/ReceivablesPage';
import { ReportViewPage } from './pages/ReportViewPage';
import { ReportsPage } from './pages/ReportsPage';
import { RolesPage } from './pages/RolesPage';
import { SecurityPage } from './pages/SecurityPage';
import { UsersPage } from './pages/UsersPage';
import { WorkQueuePage } from './pages/WorkQueuePage';

function RequirePermission({ permission, children }: { permission: string; children: React.ReactNode }) {
  const { user } = useAuth();
  if (!can(user, permission)) {
    return (
      <div role="alert" className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-medium">You do not have access to this page.</p>
        <p className="mt-1">Ask an administrator if you need the {permission} permission.</p>
      </div>
    );
  }
  return <>{children}</>;
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const location = useLocation();
  if (auth.status === 'loading') return <Loading label="Restoring your session…" />;
  if (auth.status === 'signedOut') return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}

export function App() {
  return (
    <>
    <BrandingEffects />
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route
          index
          element={
            <RequirePermission permission="dashboard.read">
              <DashboardPage />
            </RequirePermission>
          }
        />
        <Route
          path="hospitals"
          element={
            <RequirePermission permission="hospitals.read">
              <HospitalsPage />
            </RequirePermission>
          }
        />
        <Route
          path="hospitals/setup"
          element={
            <RequirePermission permission="hospitals.onboard">
              <HospitalSetupWizardPage />
            </RequirePermission>
          }
        />
        <Route
          path="hospitals/new"
          element={
            <RequirePermission permission="hospitals.create">
              <HospitalFormPage />
            </RequirePermission>
          }
        />
        <Route
          path="hospitals/:id"
          element={
            <RequirePermission permission="hospitals.read">
              <HospitalDetailPage />
            </RequirePermission>
          }
        />
        <Route
          path="imports"
          element={
            <RequirePermission permission="imports.read">
              <ImportsPage />
            </RequirePermission>
          }
        />
        <Route
          path="imports/new"
          element={
            <RequirePermission permission="imports.manage">
              <ImportNewPage />
            </RequirePermission>
          }
        />
        <Route
          path="imports/:id"
          element={
            <RequirePermission permission="imports.read">
              <ImportDetailPage />
            </RequirePermission>
          }
        />
        <Route
          path="charge-runs"
          element={
            <RequirePermission permission="charge_runs.read">
              <ChargeRunsPage />
            </RequirePermission>
          }
        />
        <Route
          path="charge-runs/new"
          element={
            <RequirePermission permission="charge_runs.create">
              <ChargeRunNewPage />
            </RequirePermission>
          }
        />
        <Route
          path="charge-runs/:id"
          element={
            <RequirePermission permission="charge_runs.read">
              <ChargeRunDetailPage />
            </RequirePermission>
          }
        />
        <Route
          path="receivables"
          element={
            <RequirePermission permission="receivables.read">
              <ReceivablesPage />
            </RequirePermission>
          }
        />
        <Route
          path="receivables/:id"
          element={
            <RequirePermission permission="receivables.read">
              <ReceivableDetailPage />
            </RequirePermission>
          }
        />
        <Route
          path="payments"
          element={
            <RequirePermission permission="payments.read">
              <PaymentsPage />
            </RequirePermission>
          }
        />
        <Route
          path="payments/new"
          element={
            <RequirePermission permission="payments.create">
              <PaymentNewPage />
            </RequirePermission>
          }
        />
        <Route
          path="payments/:id"
          element={
            <RequirePermission permission="payments.read">
              <PaymentDetailPage />
            </RequirePermission>
          }
        />
        <Route path="work" element={<WorkQueuePage />} />
        <Route
          path="adjustments"
          element={
            <RequirePermission permission="adjustments.read">
              <AdjustmentsPage />
            </RequirePermission>
          }
        />
        <Route
          path="reports"
          element={
            <RequirePermission permission="reports.read">
              <ReportsPage />
            </RequirePermission>
          }
        />
        <Route
          path="reports/:id"
          element={
            <RequirePermission permission="reports.read">
              <ReportViewPage />
            </RequirePermission>
          }
        />
        <Route
          path="audit"
          element={
            <RequirePermission permission="audit.read">
              <AuditPage />
            </RequirePermission>
          }
        />
        <Route path="security" element={<SecurityPage />} />
        <Route
          path="admin/platform"
          element={
            <RequirePermission permission="platform.manage">
              <PlatformSettingsPage />
            </RequirePermission>
          }
        />
        <Route
          path="admin/users"
          element={
            <RequirePermission permission="users.read">
              <UsersPage />
            </RequirePermission>
          }
        />
        <Route
          path="admin/roles"
          element={
            <RequirePermission permission="roles.read">
              <RolesPage />
            </RequirePermission>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
    </>
  );
}
