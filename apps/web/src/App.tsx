import { lazy, Suspense, useEffect, type ComponentType } from 'react';
import { Loader2 } from 'lucide-react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';

import { AppShell } from '@/app/AppShell';
import { AuthGate } from '@/app/AuthGate';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { getPublicBasePath } from '@/lib/public-path';
import {
  APP_BG_DARK_WASH_CLASS,
  APP_BG_HIGHLIGHT_CLASS,
  APP_BG_IMAGE_URL,
} from '@/lib/ui-classes';

// Route-level code splitting: each page loads on first visit instead of
// shipping the whole app as one bundle.
const lazyPage = <T extends Record<string, unknown>>(
  loader: () => Promise<T>,
  name: keyof T,
) =>
  lazy(() =>
    loader().then((module) => ({
      default: module[name] as ComponentType,
    })),
  );

const DashboardPage = lazyPage(() => import('@/pages/DashboardPage'), 'DashboardPage');
const ObservatoryPage = lazyPage(() => import('@/pages/ObservatoryPage'), 'ObservatoryPage');
const TaskManagerPage = lazyPage(() => import('@/pages/TaskManagerPage'), 'TaskManagerPage');
const RewindPage = lazyPage(() => import('@/pages/RewindPage'), 'RewindPage');
const LogsPage = lazyPage(() => import('@/pages/LogsPage'), 'LogsPage');
const JobRunDetailPage = lazyPage(() => import('@/pages/JobRunDetailPage'), 'JobRunDetailPage');
const VaultPage = lazyPage(() => import('@/pages/VaultPage'), 'VaultPage');
const CommandCenterPage = lazyPage(() => import('@/pages/CommandCenterPage'), 'CommandCenterPage');
const CuttingRoomPage = lazyPage(() => import('@/pages/CuttingRoomPage'), 'CuttingRoomPage');
const FaqPage = lazyPage(() => import('@/pages/FaqPage'), 'FaqPage');
const SetupPage = lazyPage(() => import('@/pages/SetupPage'), 'SetupPage');
const SetupTrueNasPage = lazyPage(() => import('@/pages/SetupTrueNasPage'), 'SetupTrueNasPage');
const SetupUnraidPage = lazyPage(() => import('@/pages/SetupUnraidPage'), 'SetupUnraidPage');
const VersionHistoryPage = lazyPage(() => import('@/pages/VersionHistoryPage'), 'VersionHistoryPage');
const DebuggerPage = lazyPage(() => import('@/pages/DebuggerPage'), 'DebuggerPage');
const ProfilePage = lazyPage(() => import('@/pages/ProfilePage'), 'ProfilePage');

// The fallback renders the exact page backdrop (image + washes) so a slow
// chunk load on mobile looks like the next screen fading in, not a black
// flash.
const RouteFallback = () => (
  <div className="relative min-h-screen overflow-hidden bg-gray-50 dark:bg-gray-900">
    <div className="pointer-events-none fixed inset-0 z-0">
      <img
        src={APP_BG_IMAGE_URL}
        alt=""
        className="h-full w-full object-cover object-center opacity-80"
      />
      <div className="absolute inset-0 bg-gradient-to-br from-amber-400/25 via-purple-900/45 to-zinc-950/70" />
      <div className={`absolute inset-0 ${APP_BG_HIGHLIGHT_CLASS}`} />
      <div className={`absolute inset-0 ${APP_BG_DARK_WASH_CLASS}`} />
    </div>
    <div className="relative z-10 flex min-h-screen items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-white/40" />
    </div>
  </div>
);

// skipcq: SCT-A000 - Legacy localStorage cleanup key, not a credential.
const LEGACY_ONBOARDING_STORAGE_KEY = 'tcp_onboarding_v1';

const ProtectedAppShell = () => {
  return (
    <AuthGate>
      <AppShell />
    </AuthGate>
  );
};

const LegacyJobsRedirect = () => {
  const location = useLocation();

  return (
    <Navigate
      to={{ pathname: '/task-manager', search: location.search, hash: location.hash }}
      replace
    />
  );
};

const App = () => {
  const publicBasePath = getPublicBasePath();

  useEffect(() => {
    // One-time cleanup: stop using legacy localStorage onboarding/secrets.
    // Note: we only remove the legacy key; we never store secrets in browser storage.
    try {
      localStorage.removeItem(LEGACY_ONBOARDING_STORAGE_KEY);
    } catch {
      // ignore
    }
    // Decode the shared page backdrop once at boot; route transitions and
    // suspense fallbacks then paint it instantly from the image cache.
    const backdrop = new Image();
    backdrop.src = APP_BG_IMAGE_URL;

    // Prefetch every page chunk once the first screen has settled. With the
    // modules already in cache, navigation never suspends, so React swaps
    // screens in one paint with no fallback frame at all.
    const prefetch = window.setTimeout(() => {
      void Promise.allSettled([
        import('@/pages/DashboardPage'),
        import('@/pages/ObservatoryPage'),
        import('@/pages/TaskManagerPage'),
        import('@/pages/RewindPage'),
        import('@/pages/LogsPage'),
        import('@/pages/JobRunDetailPage'),
        import('@/pages/VaultPage'),
        import('@/pages/CommandCenterPage'),
        import('@/pages/CuttingRoomPage'),
        import('@/pages/FaqPage'),
        import('@/pages/SetupPage'),
        import('@/pages/VersionHistoryPage'),
        import('@/pages/ProfilePage'),
      ]);
    }, 2_000);
    return () => window.clearTimeout(prefetch);
  }, []);

  return (
    <BrowserRouter basename={publicBasePath || undefined}>
      <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<Outlet />}>
          {/* All pages require authentication and wizard completion */}
          <Route element={<ProtectedAppShell />}>
            <Route index element={<DashboardPage />} />
            <Route path="observatory" element={<ObservatoryPage />} />
            <Route path="app" element={<Navigate to="/" replace />} />
            <Route path="vault" element={<VaultPage />} />
            <Route path="command-center" element={<CommandCenterPage />} />
            <Route path="cutting-room" element={<CuttingRoomPage />} />
            <Route path="cutting-room/history" element={<CuttingRoomPage />} />
            <Route path="cutting-room/wanted" element={<CuttingRoomPage />} />
            <Route path="cutting-room/duplicates" element={<CuttingRoomPage />} />
            <Route path="cutting-room/large-files" element={<CuttingRoomPage />} />
            {/* Legacy routes from before the Cutting Room rename */}
            <Route path="curation" element={<Navigate to="/cutting-room" replace />} />
            <Route path="curation/history" element={<Navigate to="/cutting-room/history" replace />} />
            <Route path="curation/wanted" element={<Navigate to="/cutting-room/wanted" replace />} />
            <Route path="curation/duplicates" element={<Navigate to="/cutting-room/duplicates" replace />} />
            <Route path="faq" element={<FaqPage />} />
            <Route path="setup" element={<SetupPage />} />
            <Route path="setup/truenas" element={<SetupTrueNasPage />} />
            <Route path="setup/unraid" element={<SetupUnraidPage />} />
            <Route path="profile" element={<ProfilePage />} />
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
            <Route path="jobs" element={<LegacyJobsRedirect />} />
            <Route path="connections" element={<Navigate to="/vault" replace />} />
            <Route path="integrations" element={<Navigate to="/vault" replace />} />
            {/* 404 also requires auth */}
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>
      </Routes>
      </Suspense>
    </BrowserRouter>
  );
};

export default App;
