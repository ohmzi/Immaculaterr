import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { MobileNavigation } from '@/components/MobileNavigation';
import { Navigation } from '@/components/Navigation';
import {
  configurePasswordRecovery,
  getPasswordRecoveryStatus,
  listPasswordRecoveryQuestions,
  logout,
} from '@/api/auth';
import {
  PasswordRecoveryQuestionFields,
} from '@/components/PasswordRecoveryQuestionFields';
import {
  PASSWORD_RECOVERY_QUESTION_COUNT,
  createEmptyPasswordRecoveryDrafts,
} from '@/lib/password-recovery';
import { getAppMeta } from '@/api/app';
import { getPublicSettings, putSettings } from '@/api/settings';
import { SetupWizardModal } from '@/app/SetupWizardModal';
import { WhatsNewModal } from '@/app/WhatsNewModal';
import {
  formatDisplayVersion,
  getVersionHistoryEntry,
  normalizeVersion,
} from '@/lib/version-history';
import { clearClientUserData } from '@/lib/security/clearClientUserData';

const readOnboardingCompleted = (settings: unknown): boolean => {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return false;
  const onboarding = (settings as Record<string, unknown>)['onboarding'];
  if (!onboarding || typeof onboarding !== 'object' || Array.isArray(onboarding)) return false;
  return Boolean((onboarding as Record<string, unknown>)['completed']);
};

const readAcknowledgedWhatsNewVersion = (
  settings: unknown,
): string | null => {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
  const ui = (settings as Record<string, unknown>)['ui'];
  if (!ui || typeof ui !== 'object' || Array.isArray(ui)) return null;
  const whatsNew = (ui as Record<string, unknown>)['whatsNew'];
  if (!whatsNew || typeof whatsNew !== 'object' || Array.isArray(whatsNew)) return null;
  const acknowledgedVersion = (whatsNew as Record<string, unknown>)['acknowledgedVersion'];
  return normalizeVersion(typeof acknowledgedVersion === 'string' ? acknowledgedVersion : null);
};

const shouldShowWhatsNewModal = (params: {
  onboardingCompleted: null | boolean;
  pathname: string;
  currentVersion: string | null;
  hasMatchingVersionHistoryEntry: boolean;
  acknowledgedWhatsNewVersion: string | null;
  sessionDismissedVersion: string | null;
}): boolean => {
  if (params.onboardingCompleted !== true) return false;
  if (params.pathname === '/version-history') return false;
  if (!params.currentVersion || !params.hasMatchingVersionHistoryEntry) return false;
  if (params.acknowledgedWhatsNewVersion === params.currentVersion) return false;
  return params.sessionDismissedVersion !== params.currentVersion;
};

export const AppShell = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [sessionDismissedVersion, setSessionDismissedVersion] = useState<string | null>(null);
  const [recoveryDrafts, setRecoveryDrafts] = useState(
    createEmptyPasswordRecoveryDrafts(),
  );
  const [recoveryCurrentPassword, setRecoveryCurrentPassword] = useState('');
  const [recoveryError, setRecoveryError] = useState<string | null>(null);

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

  const recoveryStatusQuery = useQuery({
    queryKey: ['auth', 'recovery-status'],
    queryFn: getPasswordRecoveryStatus,
    staleTime: 5_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const recoveryQuestionsQuery = useQuery({
    queryKey: ['auth', 'recovery-questions'],
    queryFn: listPasswordRecoveryQuestions,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
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
  const currentVersionLabel = useMemo(
    () => formatDisplayVersion(currentVersion),
    [currentVersion],
  );

  const acknowledgedWhatsNewVersion = useMemo(() => {
    if (settingsQuery.status !== 'success') return null;
    return readAcknowledgedWhatsNewVersion(settingsQuery.data?.settings);
  }, [settingsQuery.status, settingsQuery.data?.settings]);

  const matchingVersionHistoryEntry = useMemo(
    () => getVersionHistoryEntry(currentVersion),
    [currentVersion],
  );
  const effectiveSessionDismissedVersion = useMemo(() => {
    if (!sessionDismissedVersion) return null;
    if (!currentVersion) return sessionDismissedVersion;
    return sessionDismissedVersion === currentVersion
      ? sessionDismissedVersion
      : null;
  }, [sessionDismissedVersion, currentVersion]);

  const shouldShowWhatsNew = useMemo(() => {
    return shouldShowWhatsNewModal({
      onboardingCompleted,
      pathname: location.pathname,
      currentVersion,
      hasMatchingVersionHistoryEntry: Boolean(matchingVersionHistoryEntry),
      acknowledgedWhatsNewVersion,
      sessionDismissedVersion: effectiveSessionDismissedVersion,
    });
  }, [
    onboardingCompleted,
    location.pathname,
    currentVersion,
    matchingVersionHistoryEntry,
    acknowledgedWhatsNewVersion,
    effectiveSessionDismissedVersion,
  ]);

  const configuredRecoveryKeys = useMemo(
    () => recoveryStatusQuery.data?.configuredQuestionKeys ?? [],
    [recoveryStatusQuery.data?.configuredQuestionKeys],
  );
  const effectiveRecoveryDrafts = useMemo(
    () =>
      recoveryDrafts.map((entry, index) => ({
        ...entry,
        questionKey: entry.questionKey || configuredRecoveryKeys[index] || '',
      })),
    [configuredRecoveryKeys, recoveryDrafts],
  );

  const shouldShowRecoverySetup = useMemo(() => {
    return (
      onboardingCompleted === true &&
      recoveryStatusQuery.data?.required === true &&
      !shouldShowWhatsNew
    );
  }, [onboardingCompleted, recoveryStatusQuery.data?.required, shouldShowWhatsNew]);

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

  const configureRecoveryMutation = useMutation({
    mutationFn: async () => {
      await configurePasswordRecovery({
        currentPassword: recoveryCurrentPassword,
        recoveryAnswers: effectiveRecoveryDrafts.map((entry) => ({
          questionKey: entry.questionKey.trim(),
          answer: entry.answer.trim(),
        })),
      });
    },
    onSuccess: async () => {
      setRecoveryError(null);
      setRecoveryCurrentPassword('');
      setRecoveryDrafts((current) =>
        current.map((entry) => ({ ...entry, answer: '' })),
      );
      await queryClient.invalidateQueries({ queryKey: ['auth', 'recovery-status'] });
      toast.success('Password recovery is configured.');
    },
    onError: (error) => {
      setRecoveryError(error instanceof Error ? error.message : 'Could not save password recovery.');
    },
  });

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: async () => {
      queryClient.clear();
      await clearClientUserData();
      window.location.href = '/';
    },
  });

  const handleLogout = useCallback(() => {
    logoutMutation.mutate();
  }, [logoutMutation]);

  const handleAcknowledgeWhatsNew = useCallback(() => {
    if (!currentVersion) return;
    setSessionDismissedVersion(currentVersion);
    acknowledgeWhatsNewMutation.mutate(currentVersion);
  }, [acknowledgeWhatsNewMutation, currentVersion]);

  const handleRecoveryQuestionKeyChange = useCallback(
    (index: number, value: string) => {
      setRecoveryDrafts((current) => {
        const next = [...current];
        next[index] = { ...next[index], questionKey: value };
        return next;
      });
    },
    [],
  );

  const handleRecoveryAnswerChange = useCallback((index: number, value: string) => {
    setRecoveryDrafts((current) => {
      const next = [...current];
      next[index] = { ...next[index], answer: value };
      return next;
    });
  }, []);

  const handleRecoveryCurrentPasswordChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setRecoveryCurrentPassword(event.target.value);
    },
    [],
  );

  const handleRecoverySetupSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (configureRecoveryMutation.isPending) return;

      if (recoveryQuestionsQuery.isLoading) {
        setRecoveryError('Loading security questions. Please wait.');
        return;
      }
      if (recoveryQuestionsQuery.error) {
        setRecoveryError('Could not load security questions. Refresh and try again.');
        return;
      }

      const allFilled = effectiveRecoveryDrafts.every(
        (entry) => entry.questionKey.trim() && entry.answer.trim(),
      );
      if (!allFilled) {
        setRecoveryError(
          `Fill all ${PASSWORD_RECOVERY_QUESTION_COUNT} security questions and answers.`,
        );
        return;
      }
      if (!recoveryCurrentPassword) {
        setRecoveryError('Current password is required.');
        return;
      }

      setRecoveryError(null);
      configureRecoveryMutation.mutate();
    },
    [
      configureRecoveryMutation,
      recoveryCurrentPassword,
      effectiveRecoveryDrafts,
      recoveryQuestionsQuery.error,
      recoveryQuestionsQuery.isLoading,
    ],
  );

  const closeWizard = useCallback(() => {
    setWizardOpen(false);
  }, []);

  const handleWizardFinished = useCallback(() => {
    const wasRequiredOnboarding = onboardingCompleted === false;
    setWizardOpen(false);

    if (wasRequiredOnboarding && location.pathname !== '/') {
      navigate('/', { replace: true });
    }
  }, [location.pathname, navigate, onboardingCompleted]);

  const isHomePage = location.pathname === '/';
  const recoveryInputClass =
    'w-full px-4 py-3 rounded-xl border border-white/15 bg-white/10 text-white placeholder-white/40 focus:ring-2 focus:ring-white/20 focus:border-transparent outline-none transition';

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
        versionLabel={currentVersionLabel ? `v${currentVersionLabel}` : ''}
        onAcknowledge={handleAcknowledgeWhatsNew}
        acknowledging={acknowledgeWhatsNewMutation.isPending}
      />

      {shouldShowRecoverySetup ? (
        <div className="fixed inset-0 z-[100001] flex items-center justify-center p-4 sm:p-6">
          <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" />
          <div className="relative w-full max-w-2xl rounded-3xl border border-white/10 bg-[#0b0c0f]/90 p-5 sm:p-6 shadow-2xl backdrop-blur-2xl">
            <h2 className="text-xl font-semibold text-white">
              Password recovery setup required
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-white/75">
              Password recovery was added in this build. Because this account was
              created before recovery existed, you must configure all three security
              questions now before continuing.
            </p>

            <form className="mt-5 space-y-4" onSubmit={handleRecoverySetupSubmit}>
              {recoveryQuestionsQuery.isLoading ? (
                <div className="text-sm text-white/70">Loading security questions...</div>
              ) : recoveryQuestionsQuery.error ? (
                <div className="text-sm text-red-200/90">
                  Could not load security questions. Refresh and try again.
                </div>
              ) : (
                <PasswordRecoveryQuestionFields
                  idPrefix="forced-recovery"
                  answers={effectiveRecoveryDrafts}
                  questions={recoveryQuestionsQuery.data?.questions ?? []}
                  inputClassName={recoveryInputClass}
                  disabled={configureRecoveryMutation.isPending}
                  onQuestionKeyChange={handleRecoveryQuestionKeyChange}
                  onAnswerChange={handleRecoveryAnswerChange}
                />
              )}

              <div className="space-y-2">
                <label
                  htmlFor="forced-recovery-current-password"
                  className="block text-xs font-bold uppercase tracking-wider text-white/60"
                >
                  Current password
                </label>
                <input
                  id="forced-recovery-current-password"
                  type="password"
                  autoComplete="current-password"
                  value={recoveryCurrentPassword}
                  onChange={handleRecoveryCurrentPasswordChange}
                  disabled={configureRecoveryMutation.isPending}
                  className={recoveryInputClass}
                />
              </div>

              {recoveryError ? (
                <div className="text-sm text-red-200/90">{recoveryError}</div>
              ) : null}

              <button
                type="submit"
                disabled={configureRecoveryMutation.isPending}
                className="w-full min-h-[44px] rounded-xl bg-[#facc15] text-black font-semibold hover:bg-[#fde68a] disabled:cursor-not-allowed disabled:opacity-70"
              >
                {configureRecoveryMutation.isPending
                  ? 'Saving...'
                  : 'Save recovery setup and continue'}
              </button>
            </form>
          </div>
        </div>
      ) : null}

      {/* Setup Wizard Modal */}
      <SetupWizardModal
        open={wizardOpen || onboardingCompleted === false}
        required={onboardingCompleted === false}
        onClose={closeWizard}
        onFinished={handleWizardFinished}
      />
    </div>
  );
};
