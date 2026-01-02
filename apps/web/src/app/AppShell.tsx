import { useMemo, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Navigation, MobileNavigation } from '@/components/Navigation';
import { getMe, logout, resetDev } from '@/api/auth';
import { getPublicSettings } from '@/api/settings';
import { SetupWizardModal } from '@/app/SetupWizardModal';
import { getInitialTheme, setTheme, type Theme } from '@/app/theme';

export function AppShell() {
  const queryClient = useQueryClient();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [currentTheme, setCurrentTheme] = useState<Theme>(() => getInitialTheme());

  const meQuery = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: getMe,
    staleTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: getPublicSettings,
    staleTime: 5_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const onboardingCompleted = useMemo(() => {
    const s = settingsQuery.data?.settings;
    if (!s || typeof s !== 'object' || Array.isArray(s)) return false;
    const onboarding = (s as Record<string, unknown>)['onboarding'];
    if (!onboarding || typeof onboarding !== 'object' || Array.isArray(onboarding)) return false;
    return Boolean((onboarding as Record<string, unknown>)['completed']);
  }, [settingsQuery.data?.settings]);

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
      queryClient.removeQueries({ queryKey: ['settings'] });
    },
  });

  const toggleTheme = () => {
    const next: Theme = currentTheme === 'dark' ? 'light' : 'dark';
    setCurrentTheme(next);
    setTheme(next);
  };

  const handleLogout = () => {
    logoutMutation.mutate();
  };

  const username = meQuery.data?.user?.username ?? 'User';

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop Navigation - Curved floating style */}
      <div className="hidden lg:block">
        <Navigation
          theme={currentTheme}
          onToggleTheme={toggleTheme}
          onLogout={handleLogout}
          username={username}
        />
      </div>

      {/* Main Content */}
      <main className="min-h-screen pb-24 lg:pb-0">
        <Outlet />
      </main>

      {/* Mobile Bottom Navigation */}
      <MobileNavigation />

      {/* Setup Wizard Modal */}
      <SetupWizardModal
        open={wizardOpen || !onboardingCompleted}
        required={!onboardingCompleted}
        onClose={() => setWizardOpen(false)}
        onFinished={() => setWizardOpen(false)}
      />
    </div>
  );
}
