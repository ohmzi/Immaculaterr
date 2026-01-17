import { useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { MobileNavigation } from '@/components/MobileNavigation';
import { Navigation } from '@/components/Navigation';
import { logout } from '@/api/auth';
import { getPublicSettings } from '@/api/settings';
import { SetupWizardModal } from '@/app/SetupWizardModal';

export function AppShell() {
  const location = useLocation();
  const queryClient = useQueryClient();
  const [wizardOpen, setWizardOpen] = useState(false);

  // Safety cleanup: ensure Observatory-only global CSS never lingers across routes
  // (especially important for mobile/PWA where scroll-snap can interfere with taps).
  useEffect(() => {
    try {
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

  // Tri-state: null = unknown (loading/error), boolean = known value.
  // This prevents the setup wizard from flashing open during initial settings fetch.
  const onboardingCompleted = useMemo<null | boolean>(() => {
    if (settingsQuery.status !== 'success') return null;

    const s = settingsQuery.data?.settings;
    if (!s || typeof s !== 'object' || Array.isArray(s)) return false;
    const onboarding = (s as Record<string, unknown>)['onboarding'];
    if (!onboarding || typeof onboarding !== 'object' || Array.isArray(onboarding)) return false;
    return Boolean((onboarding as Record<string, unknown>)['completed']);
  }, [settingsQuery.status, settingsQuery.data?.settings]);

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
      queryClient.removeQueries({ queryKey: ['settings'] });
    },
  });

  const handleLogout = () => {
    logoutMutation.mutate();
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
