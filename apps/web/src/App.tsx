import { useEffect } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';

import { AppShell } from '@/app/AppShell';
import { AuthGate } from '@/app/AuthGate';
import { DashboardPage } from '@/pages/DashboardPage';
import { JobsPage } from '@/pages/JobsPage';
import { HistoryPage } from '@/pages/HistoryPage';
import { LogsPage } from '@/pages/LogsPage';
import { JobRunDetailPage } from '@/pages/JobRunDetailPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { ConfigurationPage } from '@/pages/ConfigurationPage';

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
          {/* All pages require authentication and wizard completion */}
          <Route element={<ProtectedAppShell />}>
            <Route index element={<DashboardPage />} />
            <Route path="app" element={<Navigate to="/" replace />} />
            <Route path="configuration" element={<ConfigurationPage />} />
            <Route path="jobs" element={<JobsPage />} />
            <Route path="history" element={<HistoryPage />} />
            <Route path="history/:runId" element={<JobRunDetailPage />} />
            <Route path="logs" element={<LogsPage />} />
            <Route path="logs/:runId" element={<LogsPage />} />
            {/* Redirect old routes */}
            <Route path="connections" element={<Navigate to="/configuration" replace />} />
            <Route path="integrations" element={<Navigate to="/configuration" replace />} />
            {/* 404 also requires auth */}
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
