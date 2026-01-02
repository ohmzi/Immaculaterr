import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

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
import { clearOnboarding } from '@/lib/onboarding';

export default function App() {
  // One-time cleanup: stop using legacy localStorage onboarding/secrets.
  try {
    clearOnboarding();
  } catch {
    // ignore
  }

  return (
    <AuthGate>
      <BrowserRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<DashboardPage />} />
            <Route path="setup" element={<SetupPage />} />
          <Route path="integrations" element={<Navigate to="/connections" replace />} />
          <Route path="connections" element={<ConnectionsPage />} />
          <Route path="collections" element={<CollectionsPage />} />
          <Route path="import" element={<ImportPage />} />
            <Route path="jobs" element={<JobsPage />} />
          <Route path="runs" element={<RunsPage />} />
            <Route path="jobs/runs/:runId" element={<JobRunDetailPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthGate>
  );
}
