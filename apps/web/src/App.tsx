import { useEffect } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';

import { AppShell } from '@/app/AppShell';
import { AuthGate } from '@/app/AuthGate';
import { DashboardPage } from '@/pages/DashboardPage';
import { SetupPage } from '@/pages/SetupPage';
import { ConnectionsPage } from '@/pages/ConnectionsPage';
import { CollectionsPage } from '@/pages/CollectionsPage';
import { ImportPage } from '@/pages/ImportPage';
import { JobsPage } from '@/pages/JobsPage';
import { RunsPage } from '@/pages/RunsPage';
import { JobRunDetailPage } from '@/pages/JobRunDetailPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

const LEGACY_ONBOARDING_STORAGE_KEY = 'tcp_onboarding_v1';

function ProtectedAppShell() {
  return (
    <AuthGate>
      <AppShell />
    </AuthGate>
  );
}

export default function App() {
  useEffect(() => {
    // One-time cleanup: stop using legacy localStorage onboarding/secrets.
    // Note: we only remove the legacy key; we never store secrets in browser storage.
    try {
      localStorage.removeItem(LEGACY_ONBOARDING_STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Outlet />}>
          {/* Public landing page */}
          <Route index element={<DashboardPage />} />

          {/* Protected app pages */}
          <Route element={<ProtectedAppShell />}>
            <Route path="app" element={<Navigate to="/jobs" replace />} />
            <Route path="setup" element={<SetupPage />} />
            <Route path="integrations" element={<Navigate to="/connections" replace />} />
            <Route path="connections" element={<ConnectionsPage />} />
            <Route path="collections" element={<CollectionsPage />} />
            <Route path="import" element={<ImportPage />} />
            <Route path="jobs" element={<JobsPage />} />
            <Route path="runs" element={<RunsPage />} />
            <Route path="jobs/runs/:runId" element={<JobRunDetailPage />} />
          </Route>

          {/* Public 404 */}
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
