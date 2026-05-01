import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, useAnimation } from 'motion/react';
import { ArrowUpRight, ShieldCheck, UserRoundCog } from 'lucide-react';
import { toast } from 'sonner';

import {
  changePassword,
  configurePasswordRecovery,
  getPasswordRecoveryStatus,
  listPasswordRecoveryQuestions,
} from '@/api/auth';
import {
  PasswordRecoveryQuestionFields,
} from '@/components/PasswordRecoveryQuestionFields';
import { clearClientUserData } from '@/lib/security/clearClientUserData';
import {
  PASSWORD_RECOVERY_QUESTION_COUNT,
  createEmptyPasswordRecoveryDrafts,
} from '@/lib/password-recovery';
import {
  APP_BG_DARK_WASH_CLASS,
  APP_BG_HIGHLIGHT_CLASS,
  APP_BG_IMAGE_URL,
  APP_SHORTCUT_CHIP_CLASS,
} from '@/lib/ui-classes';
import { getPublicBasePath, withPublicBasePath } from '@/lib/public-path';

const MIN_PASSWORD_LENGTH = 10;

export function ProfilePage() {
  const queryClient = useQueryClient();
  const titleIconControls = useAnimation();
  const titleIconGlowControls = useAnimation();
  const location = useLocation();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const [recoveryDrafts, setRecoveryDrafts] = useState(
    createEmptyPasswordRecoveryDrafts(),
  );
  const [recoveryCurrentPassword, setRecoveryCurrentPassword] = useState('');
  const [recoveryError, setRecoveryError] = useState<string | null>(null);

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

  const changePasswordMutation = useMutation({
    mutationFn: async () => {
      return await changePassword({
        currentPassword,
        newPassword,
      });
    },
    onSuccess: async () => {
      queryClient.clear();
      await clearClientUserData();
      toast.success('Password updated. Please sign in again.');
      window.location.href = withPublicBasePath('/');
    },
    onError: (error) => {
      setPasswordError(
        error instanceof Error ? error.message : 'Could not change password.',
      );
    },
  });

  const configureRecoveryMutation = useMutation({
    mutationFn: async () => {
      return await configurePasswordRecovery({
        currentPassword: recoveryCurrentPassword,
        recoveryAnswers: effectiveRecoveryDrafts.map((entry) => ({
          questionKey: entry.questionKey.trim(),
          answer: entry.answer.trim(),
        })),
      });
    },
    onSuccess: async () => {
      setRecoveryCurrentPassword('');
      setRecoveryDrafts((current) =>
        current.map((entry) => ({ ...entry, answer: '' })),
      );
      setRecoveryError(null);
      await queryClient.invalidateQueries({ queryKey: ['auth', 'recovery-status'] });
      toast.success('Password recovery questions updated.');
    },
    onError: (error) => {
      setRecoveryError(
        error instanceof Error ? error.message : 'Could not update recovery questions.',
      );
    },
  });

  const handleAnimateTitleIcon = useCallback(() => {
    titleIconControls.stop();
    titleIconGlowControls.stop();
    void titleIconControls.start({
      scale: [1, 1.06, 1],
      transition: { duration: 0.55, ease: 'easeOut' },
    });
    void titleIconGlowControls.start({
      opacity: [0, 0.7, 0, 0.55, 0, 0.4, 0],
      transition: { duration: 1.4, ease: 'easeInOut' },
    });
  }, [titleIconControls, titleIconGlowControls]);

  const handleCurrentPasswordChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setCurrentPassword(event.target.value);
    },
    [],
  );

  const handleNewPasswordChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setNewPassword(event.target.value);
    },
    [],
  );

  const handleNewPasswordConfirmChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setNewPasswordConfirm(event.target.value);
    },
    [],
  );

  const handlePasswordSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (changePasswordMutation.isPending) return;

      if (!currentPassword) {
        setPasswordError('Current password is required.');
        return;
      }
      if (newPassword.length < MIN_PASSWORD_LENGTH) {
        setPasswordError(
          `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
        );
        return;
      }
      if (newPassword !== newPasswordConfirm) {
        setPasswordError('New password confirmation does not match.');
        return;
      }

      setPasswordError(null);
      changePasswordMutation.mutate();
    },
    [
      changePasswordMutation,
      currentPassword,
      newPassword,
      newPasswordConfirm,
    ],
  );

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

  const handleRecoveryAnswerChange = useCallback(
    (index: number, value: string) => {
      setRecoveryDrafts((current) => {
        const next = [...current];
        next[index] = { ...next[index], answer: value };
        return next;
      });
    },
    [],
  );

  const handleRecoveryCurrentPasswordChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setRecoveryCurrentPassword(event.target.value);
    },
    [],
  );

  const handleRecoverySubmit = useCallback(
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
        setRecoveryError('Enter your current password to save changes.');
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

  const cardClass =
    'min-w-0 rounded-3xl border border-white/10 bg-[#0b0c0f]/60 p-6 shadow-2xl backdrop-blur-2xl lg:p-8';
  const anchorClass = 'scroll-mt-28 md:scroll-mt-32';
  const inputClass =
    'min-w-0 w-full rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-white placeholder-white/40 outline-none transition focus:border-transparent focus:ring-2 focus:ring-white/20';
  const publicBasePath = getPublicBasePath();
  const publicPathLabel = publicBasePath || '/';
  const centerElementInViewport = useCallback((id: string, behavior: ScrollBehavior) => {
    const el = document.getElementById(id);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const headingAnchorOffset = Math.min(56, Math.max(0, rect.height / 3));
    const anchorY = rect.top + headingAnchorOffset;
    const targetTop = window.scrollY + anchorY - window.innerHeight / 2;
    window.scrollTo({ top: Math.max(0, targetTop), behavior });
  }, []);

  useEffect(() => {
    const hash = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
    if (!hash) return;

    const rafId = window.requestAnimationFrame(() => {
      centerElementInViewport(hash, 'smooth');
    });
    const settleId = window.setTimeout(() => centerElementInViewport(hash, 'smooth'), 320);
    const finalId = window.setTimeout(() => centerElementInViewport(hash, 'auto'), 900);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(settleId);
      window.clearTimeout(finalId);
    };
  }, [centerElementInViewport, location.hash]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-gray-50 dark:bg-gray-900 text-white font-sans selection:bg-[#facc15] selection:text-black select-none [-webkit-touch-callout:none] [&_input]:select-text [&_textarea]:select-text [&_select]:select-text">
      <div className="pointer-events-none fixed inset-0 z-0">
        <img
          src={APP_BG_IMAGE_URL}
          alt=""
          className="h-full w-full object-cover object-center opacity-80"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-[#2e1065]/50 via-[#1e1b4b]/60 to-[#0f172a]/70" />
        <div className={`absolute inset-0 ${APP_BG_HIGHLIGHT_CLASS}`} />
        <div className={`absolute inset-0 ${APP_BG_DARK_WASH_CLASS}`} />
      </div>

      <section className="relative z-10 min-h-screen overflow-x-hidden pt-10 lg:pt-16">
        <div className="container mx-auto max-w-5xl min-w-0 px-4 pb-20">
          <div className="mb-12">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="space-y-6"
            >
              <div className="flex items-center gap-5">
                <motion.button
                  type="button"
                  onClick={handleAnimateTitleIcon}
                  animate={titleIconControls}
                  className="relative group focus:outline-none touch-manipulation"
                  aria-label="Animate Profile icon"
                  title="Animate"
                >
                  <motion.div
                    aria-hidden="true"
                    animate={titleIconGlowControls}
                    className="pointer-events-none absolute inset-0 bg-[#facc15] blur-xl opacity-0"
                  />
                  <div className="absolute inset-0 bg-[#facc15] blur-xl opacity-20 group-hover:opacity-40 transition-opacity duration-500" />
                  <div className="relative p-3 md:p-4 bg-[#facc15] rounded-2xl -rotate-6 shadow-[0_0_30px_rgba(250,204,21,0.3)] border border-white/20 group-hover:rotate-0 transition-transform duration-300 ease-spring">
                    <UserRoundCog className="h-8 w-8 md:h-10 md:w-10 text-black" />
                  </div>
                </motion.button>
                <h1 className="text-5xl md:text-6xl font-black text-white tracking-tighter drop-shadow-2xl">
                  Profile
                </h1>
              </div>

              <p className="text-purple-200/70 text-lg font-medium max-w-lg leading-relaxed ml-1">
                <span className="text-[#facc15] font-bold">Secure</span> your account. <br />
                <span className="text-sm opacity-60 font-normal">
                  Manage your password and keep password recovery ready when you need it.
                </span>
              </p>
            </motion.div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className={cardClass}>
              <div className="mb-4 flex items-center gap-2 text-white">
                <ShieldCheck className="h-5 w-5 text-[#facc15]" />
                <h2 className="text-xl font-semibold">Change password</h2>
              </div>
              <form className="space-y-4" onSubmit={handlePasswordSubmit}>
                <div className="space-y-1">
                  <label
                    htmlFor="profile-current-password"
                    className="block text-xs font-bold uppercase tracking-wider text-white/60"
                  >
                    Current password
                  </label>
                  <input
                    id="profile-current-password"
                    type="password"
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={handleCurrentPasswordChange}
                    disabled={changePasswordMutation.isPending}
                    className={inputClass}
                  />
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor="profile-new-password"
                    className="block text-xs font-bold uppercase tracking-wider text-white/60"
                  >
                    New password
                  </label>
                  <input
                    id="profile-new-password"
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={handleNewPasswordChange}
                    disabled={changePasswordMutation.isPending}
                    className={inputClass}
                  />
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor="profile-new-password-confirm"
                    className="block text-xs font-bold uppercase tracking-wider text-white/60"
                  >
                    Confirm new password
                  </label>
                  <input
                    id="profile-new-password-confirm"
                    type="password"
                    autoComplete="new-password"
                    value={newPasswordConfirm}
                    onChange={handleNewPasswordConfirmChange}
                    disabled={changePasswordMutation.isPending}
                    className={inputClass}
                  />
                </div>

                {passwordError ? (
                  <div className="text-sm text-red-200/90">{passwordError}</div>
                ) : null}

                <button
                  type="submit"
                  disabled={changePasswordMutation.isPending}
                  className="w-full min-h-[44px] rounded-xl bg-[#facc15] text-black font-semibold hover:bg-[#fde68a] disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {changePasswordMutation.isPending ? 'Updating...' : 'Update password'}
                </button>
              </form>
            </div>

            <div className={cardClass}>
              <div className="mb-4 flex items-center gap-2 text-white">
                <ShieldCheck className="h-5 w-5 text-[#facc15]" />
                <h2 className="text-xl font-semibold">Password recovery</h2>
              </div>
              <p className="mb-4 text-sm text-white/70">
                Select three questions and answers. You must confirm with your current
                password to save updates.
              </p>

              <form className="space-y-4" onSubmit={handleRecoverySubmit}>
                {recoveryQuestionsQuery.isLoading ? (
                  <div className="text-sm text-white/70">Loading security questions...</div>
                ) : recoveryQuestionsQuery.error ? (
                  <div className="text-sm text-red-200/90">
                    Could not load security questions. Refresh and try again.
                  </div>
                ) : (
                  <PasswordRecoveryQuestionFields
                    idPrefix="profile-recovery"
                    answers={effectiveRecoveryDrafts}
                    questions={recoveryQuestionsQuery.data?.questions ?? []}
                    inputClassName={inputClass}
                    disabled={configureRecoveryMutation.isPending}
                    onQuestionKeyChange={handleRecoveryQuestionKeyChange}
                    onAnswerChange={handleRecoveryAnswerChange}
                  />
                )}

                <div className="space-y-1">
                  <label
                    htmlFor="profile-recovery-current-password"
                    className="block text-xs font-bold uppercase tracking-wider text-white/60"
                  >
                    Current password (required to save)
                  </label>
                  <input
                    id="profile-recovery-current-password"
                    type="password"
                    autoComplete="current-password"
                    value={recoveryCurrentPassword}
                    onChange={handleRecoveryCurrentPasswordChange}
                    disabled={configureRecoveryMutation.isPending}
                    className={inputClass}
                  />
                </div>

                {recoveryStatusQuery.data?.required ? (
                  <div className="text-xs text-amber-200/90">
                    Recovery setup is currently required for this account.
                  </div>
                ) : null}

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
                    : 'Save recovery questions'}
                </button>
              </form>
            </div>
          </div>

          <div className="mt-6">
            <div id="profile-public-path-panel" className={`${cardClass} ${anchorClass}`}>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-white">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-[#facc15]" />
                  <h2 className="text-xl font-semibold">App base path</h2>
                </div>
                <Link
                  to="/setup#update-paths-public-path-hosting"
                  className={APP_SHORTCUT_CHIP_CLASS}
                  title="Open app base path setup"
                  aria-label="Open app base path setup"
                >
                  <ArrowUpRight className="h-3.5 w-3.5 shrink-0" />
                  <span>Setup</span>
                </Link>
              </div>
              <p className="mb-4 text-sm text-white/70">
                This is the active browser path prefix for this Immaculaterr instance.
                Use it when you are verifying reverse-proxy or tunnel subpath hosting.
                Root deployments show <span className="font-mono text-white/80">/</span>.
              </p>
              <div className="space-y-1">
                <label
                  htmlFor="profile-public-path"
                  className="block text-xs font-bold uppercase tracking-wider text-white/60"
                >
                  App base path
                </label>
                <input
                  id="profile-public-path"
                  type="text"
                  readOnly
                  value={publicPathLabel}
                  className={`${inputClass} font-mono text-sm text-white/80`}
                />
              </div>
              <p className="mt-4 text-sm text-white/65">
                Configure <code className="font-mono text-white/80">APP_BASE_PATH</code> and your
                reverse-proxy or tunnel subpath behavior in Setup, then come back here to verify
                the active value.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
