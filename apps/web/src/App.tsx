import { useEffect } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';

import { AppShell } from '@/app/AppShell';
import { AuthGate } from '@/app/AuthGate';
import { DashboardPage } from '@/pages/DashboardPage';
import { ObservatoryPage } from '@/pages/ObservatoryPage';
import { TaskManagerPage } from '@/pages/TaskManagerPage';
import { RewindPage } from '@/pages/RewindPage';
import { LogsPage } from '@/pages/LogsPage';
import { JobRunDetailPage } from '@/pages/JobRunDetailPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { VaultPage } from '@/pages/VaultPage';
import { CommandCenterPage } from '@/pages/CommandCenterPage';
import { FaqPage } from '@/pages/FaqPage';
import { VersionHistoryPage } from '@/pages/VersionHistoryPage';
import { DebuggerPage } from '@/pages/DebuggerPage';

// skipcq: SCT-A000 - Legacy localStorage cleanup key, not a credential.
const LEGACY_ONBOARDING_STORAGE_KEY = 'tcp_onboarding_v1';

const ProtectedAppShell = () => {
  return (
    <AuthGate>
      <AppShell />
    </AuthGate>
  );
};

const App = () => {
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
            <Route path="observatory" element={<ObservatoryPage />} />
            <Route path="app" element={<Navigate to="/" replace />} />
            <Route path="vault" element={<VaultPage />} />
            <Route path="command-center" element={<CommandCenterPage />} />
            <Route path="faq" element={<FaqPage />} />
            <Route path="version-history" element={<VersionHistoryPage />} />
            <Route path="__debug/:token" element={<DebuggerPage />} />
            <Route path="task-manager" element={<TaskManagerPage />} />
            <Route path="rewind" element={<RewindPage />} />
            <Route path="rewind/:runId" element={<JobRunDetailPage />} />
            {/* Legacy Rewind routes */}
            <Route path="history" element={<Navigate to="/rewind" replace />} />
            <Route path="history/:runId" element={<JobRunDetailPage />} />
            <Route path="logs" element={<LogsPage />} />
            <Route path="logs/:runId" element={<LogsPage />} />
            {/* Redirect old routes */}
            <Route path="jobs" element={<Navigate to="/task-manager" replace />} />
            <Route path="connections" element={<Navigate to="/vault" replace />} />
            <Route path="integrations" element={<Navigate to="/vault" replace />} />
            {/* 404 also requires auth */}
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
};

export default App;
