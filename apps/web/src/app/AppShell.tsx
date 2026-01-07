import { useMemo, useState } from 'react';
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
        <Outlet />
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
