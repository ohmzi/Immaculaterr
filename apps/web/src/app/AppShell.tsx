import { useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { MobileNavigation } from '@/components/MobileNavigation';
import { Navigation } from '@/components/Navigation';
import { logout } from '@/api/auth';
import { getAppMeta } from '@/api/app';
import { getPublicSettings, putSettings } from '@/api/settings';
import { SetupWizardModal } from '@/app/SetupWizardModal';
import { WhatsNewModal } from '@/app/WhatsNewModal';
import { getVersionHistoryEntry, normalizeVersion } from '@/lib/version-history';
import { clearClientUserData } from '@/lib/security/clearClientUserData';

function readOnboardingCompleted(settings: unknown): boolean {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return false;
  const onboarding = (settings as Record<string, unknown>)['onboarding'];
  if (!onboarding || typeof onboarding !== 'object' || Array.isArray(onboarding)) return false;
  return Boolean((onboarding as Record<string, unknown>)['completed']);
}

function readAcknowledgedWhatsNewVersion(settings: unknown): string | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
  const ui = (settings as Record<string, unknown>)['ui'];
  if (!ui || typeof ui !== 'object' || Array.isArray(ui)) return null;
  const whatsNew = (ui as Record<string, unknown>)['whatsNew'];
  if (!whatsNew || typeof whatsNew !== 'object' || Array.isArray(whatsNew)) return null;
  const acknowledgedVersion = (whatsNew as Record<string, unknown>)['acknowledgedVersion'];
  return normalizeVersion(typeof acknowledgedVersion === 'string' ? acknowledgedVersion : null);
}

export function AppShell() {
  const location = useLocation();
  const queryClient = useQueryClient();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [sessionDismissedVersion, setSessionDismissedVersion] = useState<string | null>(null);

  // Safety cleanup: ensure Observatory-only global CSS never lingers across routes
  // (especially important for mobile/PWA where scroll-snap can interfere with taps).
  useEffect(() => {
    try {
      // Track the current router path for navigation fallbacks.
      document.body.dataset.routerPath = location.pathname;

      document.documentElement.classList.remove('observatory-snap');
      document.body.classList.remove('observatory-snap');

      // Extra safety: some mobile browsers + drag interactions (Motion/Framer drag)
      // can leave behind global styles that effectively "block" taps/clicks until refresh.
      // We aggressively clear the most common culprits on every route change.
      const clearStyle = (el: HTMLElement) => {
        el.style.removeProperty('touch-action');
        el.style.removeProperty('user-select');
        el.style.removeProperty('-webkit-user-select');
        el.style.removeProperty('pointer-events');
        el.style.removeProperty('overflow');
        el.style.removeProperty('overscroll-behavior');
        el.style.removeProperty('overscroll-behavior-y');
      };
      clearStyle(document.documentElement);
      clearStyle(document.body);

      // Clear any selection that can linger after drag gestures.
      try {
        window.getSelection?.()?.removeAllRanges?.();
      } catch {
        // ignore
      }

      // Ensure no element is holding focus/capture unexpectedly.
      try {
        (document.activeElement as HTMLElement | null)?.blur?.();
      } catch {
        // ignore
      }
    } catch {
      // ignore
    }
  }, [location.pathname]);

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: getPublicSettings,
    staleTime: 5_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const appMetaQuery = useQuery({
    queryKey: ['app', 'meta'],
    queryFn: getAppMeta,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  // Tri-state: null = unknown (loading/error), boolean = known value.
  // This prevents the setup wizard from flashing open during initial settings fetch.
  const onboardingCompleted = useMemo<null | boolean>(() => {
    if (settingsQuery.status !== 'success') return null;
    return readOnboardingCompleted(settingsQuery.data?.settings);
  }, [settingsQuery.status, settingsQuery.data?.settings]);

  const currentVersion = useMemo(
    () => normalizeVersion(appMetaQuery.data?.version ?? null),
    [appMetaQuery.data?.version],
  );

  const acknowledgedWhatsNewVersion = useMemo(() => {
    if (settingsQuery.status !== 'success') return null;
    return readAcknowledgedWhatsNewVersion(settingsQuery.data?.settings);
  }, [settingsQuery.status, settingsQuery.data?.settings]);

  const matchingVersionHistoryEntry = useMemo(
    () => getVersionHistoryEntry(currentVersion),
    [currentVersion],
  );

  const shouldShowWhatsNew = useMemo(() => {
    if (onboardingCompleted !== true) return false;
    if (location.pathname === '/version-history') return false;
    if (!currentVersion || !matchingVersionHistoryEntry) return false;
    if (acknowledgedWhatsNewVersion === currentVersion) return false;
    if (sessionDismissedVersion === currentVersion) return false;
    return true;
  }, [
    onboardingCompleted,
    location.pathname,
    currentVersion,
    matchingVersionHistoryEntry,
    acknowledgedWhatsNewVersion,
    sessionDismissedVersion,
  ]);

  const acknowledgeWhatsNewMutation = useMutation({
    mutationFn: async (version: string) => {
      await putSettings({
        settings: {
          ui: {
            whatsNew: {
              acknowledgedVersion: version,
              acknowledgedAt: new Date().toISOString(),
            },
          },
        },
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: () => {
      toast.error('Could not save update acknowledgment. You may see this again after reload.');
    },
  });

  useEffect(() => {
    setSessionDismissedVersion((prev) => {
      if (!prev) return prev;
      if (!currentVersion) return prev;
      return prev === currentVersion ? prev : null;
    });
  }, [currentVersion]);

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: async () => {
      queryClient.clear();
      await clearClientUserData();
      window.location.href = '/';
    },
  });

  const handleLogout = () => {
    logoutMutation.mutate();
  };

  const handleAcknowledgeWhatsNew = () => {
    if (!currentVersion) return;
    setSessionDismissedVersion(currentVersion);
    acknowledgeWhatsNewMutation.mutate(currentVersion);
  };

  const isHomePage = location.pathname === '/';

  return (
    <div className="min-h-screen bg-background transition-colors duration-300">
      {/* Desktop navigation (same on every screen) */}
      <Navigation />

      {/* Main Content */}
      <main className={isHomePage ? 'pb-24 lg:pb-0' : 'pt-24 pb-24 lg:pb-8'}>
        {/* Force route content to remount on path change.
            This avoids rare cases where a previous page's state/overlays prevent the next page from rendering,
            even though the URL changes (observed leaving Observatory). */}
        <Outlet key={location.pathname} />
      </main>

      {/* Mobile app navigation */}
      <div className="lg:hidden">
        <MobileNavigation onLogout={handleLogout} />
      </div>

      {/* What's New Modal */}
      <WhatsNewModal
        open={shouldShowWhatsNew}
        entry={matchingVersionHistoryEntry}
        versionLabel={currentVersion ? `v${currentVersion}` : ''}
        onAcknowledge={handleAcknowledgeWhatsNew}
        acknowledging={acknowledgeWhatsNewMutation.isPending}
      />

      {/* Setup Wizard Modal */}
      <SetupWizardModal
        open={wizardOpen || onboardingCompleted === false}
        required={onboardingCompleted === false}
        onClose={() => setWizardOpen(false)}
        onFinished={() => setWizardOpen(false)}
      />
    </div>
  );
}
