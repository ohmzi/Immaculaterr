import { useCallback, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, UserRoundCog } from 'lucide-react';
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
} from '@/lib/ui-classes';

const MIN_PASSWORD_LENGTH = 10;

export function ProfilePage() {
  const queryClient = useQueryClient();
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
      window.location.href = '/';
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
    'rounded-3xl border border-white/10 bg-[#0b0c0f]/60 backdrop-blur-2xl p-6 lg:p-8 shadow-2xl';
  const inputClass =
    'w-full px-4 py-3 rounded-xl border border-white/15 bg-white/10 text-white placeholder-white/40 focus:ring-2 focus:ring-white/20 focus:border-transparent outline-none transition';

  return (
    <div className="relative min-h-screen overflow-hidden bg-gray-50 dark:bg-gray-900 select-none [-webkit-touch-callout:none] [&_input]:select-text [&_textarea]:select-text [&_select]:select-text">
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

      <section className="relative z-10 min-h-screen pt-10 lg:pt-16">
        <div className="container mx-auto max-w-5xl px-4 pb-20">
          <div className="mb-8 flex items-center gap-4">
            <div className="rounded-2xl border border-white/20 bg-[#facc15] p-3 shadow-[0_0_30px_rgba(250,204,21,0.3)]">
              <UserRoundCog className="h-8 w-8 text-black" />
            </div>
            <div>
              <h1 className="text-4xl font-black tracking-tight text-white">Profile</h1>
              <p className="mt-1 text-sm text-white/70">
                Manage your password and password recovery settings.
              </p>
            </div>
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
        </div>
      </section>
    </div>
  );
}
