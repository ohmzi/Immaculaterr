import {
  useCallback,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, Eye, EyeOff, Loader2, LogIn, UserPlus } from 'lucide-react';

import {
  bootstrap,
  getMeOrNull,
  listPasswordRecoveryQuestions,
  login,
  register,
  requestPasswordResetQuestions,
  resetPasswordWithRecovery,
  type PasswordResetChallengeResponse,
} from '@/api/auth';
import { ApiError } from '@/api/http';
import { PasswordRecoveryQuestionFields } from '@/components/PasswordRecoveryQuestionFields';
import {
  PASSWORD_RECOVERY_QUESTION_COUNT,
  createEmptyPasswordRecoveryDrafts,
} from '@/lib/password-recovery';
import {
  APP_BG_DARK_WASH_CLASS,
  APP_BG_HIGHLIGHT_CLASS,
  APP_BG_IMAGE_URL,
  APP_CARD_ICON_GLOW_CLASS,
  APP_CARD_INTERACTIVE_CLASS,
} from '@/lib/ui-classes';
import { cn } from '@/lib/utils';

const MIN_PASSWORD_LENGTH = 10;

type AuthMode = 'register' | 'login';

type ResetAnswerDraftMap = Partial<Record<1 | 2 | 3, string>>;

function readNumberField(body: unknown, field: string): number | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const value = (body as Record<string, unknown>)[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// skipcq: JS-0757 - Username autofocus is intentional on the login/register screen.
export function AuthGate({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  const bootstrapQuery = useQuery({
    queryKey: ['auth', 'bootstrap'],
    queryFn: bootstrap,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const meQuery = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: getMeOrNull,
    staleTime: 5_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [registerStep, setRegisterStep] = useState<1 | 2>(1);
  const [recoveryDrafts, setRecoveryDrafts] = useState(
    createEmptyPasswordRecoveryDrafts(),
  );
  const [postAuthError, setPostAuthError] = useState<string | null>(null);

  const [resetOpen, setResetOpen] = useState(false);
  const [resetUsername, setResetUsername] = useState('');
  const [resetChallenge, setResetChallenge] =
    useState<PasswordResetChallengeResponse | null>(null);
  const [resetAnswers, setResetAnswers] = useState<ResetAnswerDraftMap>({});
  const [resetNewPassword, setResetNewPassword] = useState('');
  const [resetConfirmPassword, setResetConfirmPassword] = useState('');
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetHint, setResetHint] = useState<string | null>(null);

  const mode = useMemo<AuthMode>(() => {
    if (bootstrapQuery.data?.needsAdminSetup) return 'register';
    return 'login';
  }, [bootstrapQuery.data?.needsAdminSetup]);

  const recoveryQuestionsQuery = useQuery({
    queryKey: ['auth', 'recovery-questions'],
    queryFn: listPasswordRecoveryQuestions,
    enabled: mode === 'register',
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const recoveryAnswersComplete = useMemo(() => {
    return recoveryDrafts.every(
      (entry) => entry.questionKey.trim() && entry.answer.trim(),
    );
  }, [recoveryDrafts]);

  const authMutation = useMutation({
    mutationFn: async () => {
      setPostAuthError(null);
      const u = username.trim();
      const p = password;
      if (mode === 'register') {
        return register({
          username: u,
          password: p,
          recoveryAnswers: recoveryDrafts.map((entry) => ({
            questionKey: entry.questionKey.trim(),
            answer: entry.answer.trim(),
          })),
        });
      }
      return login({ username: u, password: p });
    },
    onSuccess: async () => {
      setPassword('');
      setConfirmPassword('');
      setRegisterStep(1);
      setRecoveryDrafts(createEmptyPasswordRecoveryDrafts());
      await queryClient.invalidateQueries({ queryKey: ['auth', 'bootstrap'] });
      const me = await queryClient.fetchQuery({
        queryKey: ['auth', 'me'],
        queryFn: getMeOrNull,
      });
      if (!me) {
        setPostAuthError(
          'Sign-in failed to establish a session. Please try again. If you are using HTTP, ensure the server is allowed to set non-secure cookies (set COOKIE_SECURE=false) or access the app over HTTPS.',
        );
      }
    },
  });

  const requestResetQuestionsMutation = useMutation({
    mutationFn: async (name: string) => {
      return await requestPasswordResetQuestions({ username: name });
    },
    onSuccess: (data) => {
      setResetChallenge(data);
      setResetAnswers({});
      setResetError(null);
      setResetHint(
        `Answer both questions correctly. ${data.attemptsRemaining} attempts are available before lockout.`,
      );
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        const retryAfterSeconds = readNumberField(error.body, 'retryAfterSeconds');
        if (error.status === 429) {
          const retryMins = retryAfterSeconds
            ? Math.max(1, Math.ceil(retryAfterSeconds / 60))
            : 15;
          setResetError(
            `Too many failed attempts. Try again in about ${retryMins} minutes.`,
          );
          return;
        }
        setResetError(error.message || 'Could not load recovery questions.');
        return;
      }
      setResetError(
        error instanceof Error ? error.message : 'Could not load recovery questions.',
      );
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async () => {
      if (!resetChallenge) {
        throw new Error('Password reset challenge is missing.');
      }
      return await resetPasswordWithRecovery({
        challengeId: resetChallenge.challengeId,
        newPassword: resetNewPassword,
        answers: resetChallenge.questions.map((question) => ({
          slot: question.slot,
          answer: (resetAnswers[question.slot] ?? '').trim(),
        })),
      });
    },
    onSuccess: () => {
      const name = resetUsername.trim();
      if (name) setUsername(name);
      setPassword('');
      setConfirmPassword('');
      setResetOpen(false);
      setResetChallenge(null);
      setResetAnswers({});
      setResetNewPassword('');
      setResetConfirmPassword('');
      setResetError(null);
      setResetHint('Password reset complete. Sign in with your new password.');
      requestResetQuestionsMutation.reset();
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        if (error.status === 401) {
          const attemptsRemaining = readNumberField(error.body, 'attemptsRemaining');
          const message =
            attemptsRemaining === 4
              ? 'Incorrect answers. You have 4 more attempts before a 15-minute lockout.'
              : error.message || 'Security answers did not match.';
          setResetError(message);

          const name = resetUsername.trim();
          if (name) {
            requestResetQuestionsMutation.mutate(name);
          }
          return;
        }

        if (error.status === 429) {
          const retryAfterSeconds = readNumberField(error.body, 'retryAfterSeconds');
          const retryMins = retryAfterSeconds
            ? Math.max(1, Math.ceil(retryAfterSeconds / 60))
            : 15;
          setResetError(
            `Too many failed attempts. Try again in about ${retryMins} minutes.`,
          );
          return;
        }

        setResetError(error.message || 'Password reset failed.');
        return;
      }
      setResetError(
        error instanceof Error ? error.message : 'Password reset failed.',
      );
    },
  });

  const handleFormSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (mode === 'register' && registerStep === 1) {
        if (password.length < MIN_PASSWORD_LENGTH) {
          setPostAuthError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
          return;
        }
        if (password !== confirmPassword) {
          setPostAuthError('Password confirmation does not match.');
          return;
        }
        setPostAuthError(null);
        setRegisterStep(2);
        return;
      }

      if (mode === 'register') {
        if (recoveryQuestionsQuery.isLoading) {
          setPostAuthError('Loading security questions. Please wait.');
          return;
        }
        if (recoveryQuestionsQuery.error) {
          setPostAuthError('Could not load security questions. Refresh and try again.');
          return;
        }
        if (!recoveryAnswersComplete) {
          setPostAuthError(
            `Fill all ${PASSWORD_RECOVERY_QUESTION_COUNT} security questions and answers.`,
          );
          return;
        }
      }

      authMutation.mutate();
    },
    [
      authMutation,
      confirmPassword,
      mode,
      password,
      recoveryAnswersComplete,
      recoveryQuestionsQuery.error,
      recoveryQuestionsQuery.isLoading,
      registerStep,
    ],
  );

  const handleUsernameChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setUsername(event.target.value);
    },
    [],
  );

  const handlePasswordChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setPassword(event.target.value);
    },
    [],
  );

  const handleConfirmPasswordChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setConfirmPassword(event.target.value);
    },
    [],
  );

  const handlePasswordToggleClick = useCallback(() => {
    setShowPassword((value) => !value);
  }, []);

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

  const openResetModal = useCallback(() => {
    setResetOpen(true);
    setResetChallenge(null);
    setResetAnswers({});
    setResetNewPassword('');
    setResetConfirmPassword('');
    setResetError(null);
    setResetHint(null);
    setResetUsername((current) => {
      if (current.trim()) return current;
      return username.trim();
    });
    requestResetQuestionsMutation.reset();
    resetPasswordMutation.reset();
  }, [requestResetQuestionsMutation, resetPasswordMutation, username]);

  const closeResetModal = useCallback(() => {
    if (requestResetQuestionsMutation.isPending || resetPasswordMutation.isPending) {
      return;
    }
    setResetOpen(false);
  }, [requestResetQuestionsMutation.isPending, resetPasswordMutation.isPending]);

  const handleResetUsernameChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setResetUsername(event.target.value);
    },
    [],
  );

  const loadResetQuestions = useCallback(() => {
    const name = resetUsername.trim();
    if (!name) {
      setResetError('Enter your username first.');
      return;
    }
    setResetError(null);
    requestResetQuestionsMutation.mutate(name);
  }, [requestResetQuestionsMutation, resetUsername]);

  const handleResetAnswerChange = useCallback(
    (slot: 1 | 2 | 3, value: string) => {
      setResetAnswers((current) => ({
        ...current,
        [slot]: value,
      }));
    },
    [],
  );

  const handleResetNewPasswordChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setResetNewPassword(event.target.value);
    },
    [],
  );

  const handleResetConfirmPasswordChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setResetConfirmPassword(event.target.value);
    },
    [],
  );

  const handleResetSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!resetChallenge) {
        loadResetQuestions();
        return;
      }

      if (resetNewPassword.length < MIN_PASSWORD_LENGTH) {
        setResetError(`New password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
        return;
      }
      if (resetNewPassword !== resetConfirmPassword) {
        setResetError('New password confirmation does not match.');
        return;
      }

      const hasMissingAnswer = resetChallenge.questions.some(
        (question) => !(resetAnswers[question.slot] ?? '').trim(),
      );
      if (hasMissingAnswer) {
        setResetError('Answer both questions before submitting.');
        return;
      }

      setResetError(null);
      resetPasswordMutation.mutate();
    },
    [
      loadResetQuestions,
      resetAnswers,
      resetChallenge,
      resetConfirmPassword,
      resetNewPassword,
      resetPasswordMutation,
    ],
  );

  if (bootstrapQuery.error) {
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

        <div className="relative z-10 min-h-screen flex items-center justify-center p-6">
          <div className="max-w-lg w-full">
            <div className={cn(APP_CARD_INTERACTIVE_CLASS, 'p-6 lg:p-8')}>
              <div className="flex items-start gap-3 text-white/90">
                <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-200" />
                <div className="text-sm leading-relaxed text-red-100/90">
                  {(bootstrapQuery.error as Error).message}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (meQuery.data) return children;

  if (
    bootstrapQuery.isLoading ||
    meQuery.isLoading ||
    bootstrapQuery.isFetching ||
    meQuery.isFetching
  ) {
    return (
      <div className="relative min-h-screen overflow-hidden bg-gray-50 dark:bg-gray-900 select-none [-webkit-touch-callout:none]">
        <div className="pointer-events-none fixed inset-0 z-0">
          <img
            src={APP_BG_IMAGE_URL}
            alt=""
            className="h-full w-full object-cover object-center opacity-80"
          />
          <div className="absolute inset-0 bg-gradient-to-br from-yellow-400/90 via-yellow-300/85 to-green-400/90" />
          <div className={`absolute inset-0 ${APP_BG_HIGHLIGHT_CLASS}`} />
          <div className={`absolute inset-0 ${APP_BG_DARK_WASH_CLASS}`} />
        </div>

        <div className="relative z-10 min-h-screen flex items-center justify-center p-6">
          <div className="flex items-center gap-3 text-sm text-white/70">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking session...
          </div>
        </div>
      </div>
    );
  }

  const title = mode === 'register' ? 'Create admin login' : 'Sign in';
  const subtitle =
    mode === 'register'
      ? registerStep === 1
        ? 'Step 1 of 2: Create your username and password.'
        : 'Step 2 of 2: Configure three security questions for password recovery.'
      : 'Use your admin credentials to continue.';

  const inputClass =
    'w-full px-4 py-3 rounded-xl border border-white/15 bg-white/10 text-white placeholder-white/40 focus:ring-2 focus:ring-white/20 focus:border-transparent outline-none transition';

  const showAuthError = postAuthError ?? ((authMutation.error as Error | null)?.message ?? null);
  const submitDisabled =
    authMutation.isPending ||
    !username.trim() ||
    !password ||
    (mode === 'register' && registerStep === 1 && !confirmPassword) ||
    (mode === 'register' && registerStep === 2 && (!recoveryAnswersComplete || recoveryQuestionsQuery.isLoading));

  const resetBusy =
    requestResetQuestionsMutation.isPending || resetPasswordMutation.isPending;

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

      <div className="relative z-10 min-h-screen flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-md">
          <div className={cn(APP_CARD_INTERACTIVE_CLASS, 'p-6 lg:p-8')}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-start gap-3">
                  <div className="w-14 h-14 rounded-2xl bg-[#0F0B15] border border-white/10 flex items-center justify-center shadow-inner shrink-0 text-[#facc15]">
                    <span className={APP_CARD_ICON_GLOW_CLASS}>
                      {mode === 'register' ? (
                        <UserPlus className="w-7 h-7" />
                      ) : (
                        <LogIn className="w-7 h-7" />
                      )}
                    </span>
                  </div>

                  <div className="min-w-0">
                    <h1 className="text-2xl font-semibold text-white tracking-tight">{title}</h1>
                    <p className="mt-1 text-sm text-white/70 leading-relaxed">{subtitle}</p>
                  </div>
                </div>
              </div>
            </div>

            <form className="mt-6 space-y-4" onSubmit={handleFormSubmit}>
              <div className="space-y-2">
                <label
                  htmlFor="username"
                  className="block text-xs font-bold text-white/60 uppercase tracking-wider"
                >
                  Username
                </label>
                <input
                  id="username"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  autoCorrect="off"
                  autoFocus
                  value={username}
                  onChange={handleUsernameChange}
                  placeholder="admin"
                  className={inputClass}
                />
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="password"
                  className="block text-xs font-bold text-white/60 uppercase tracking-wider"
                >
                  Password
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                    value={password}
                    onChange={handlePasswordChange}
                    className={cn(inputClass, 'pr-12')}
                  />
                  <button
                    type="button"
                    onClick={handlePasswordToggleClick}
                    className="absolute right-3 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-9 h-9 rounded-full border border-white/10 bg-white/5 text-white/60 hover:text-white/90 hover:bg-white/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
                {mode === 'register' ? (
                  <div className="text-xs text-white/50">Use {MIN_PASSWORD_LENGTH}+ characters.</div>
                ) : null}
              </div>

              {mode === 'register' && registerStep === 1 ? (
                <div className="space-y-2">
                  <label
                    htmlFor="confirm-password"
                    className="block text-xs font-bold text-white/60 uppercase tracking-wider"
                  >
                    Confirm Password
                  </label>
                  <input
                    id="confirm-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={handleConfirmPasswordChange}
                    className={inputClass}
                  />
                </div>
              ) : null}

              {mode === 'register' && registerStep === 2 ? (
                <div className="space-y-3">
                  {recoveryQuestionsQuery.isLoading ? (
                    <div className="flex items-center gap-2 text-sm text-white/70">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading security questions...
                    </div>
                  ) : recoveryQuestionsQuery.error ? (
                    <div className="flex items-start gap-2 text-sm text-red-200/90">
                      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                      Could not load security questions. Refresh and try again.
                    </div>
                  ) : (
                    <PasswordRecoveryQuestionFields
                      idPrefix="register-recovery"
                      answers={recoveryDrafts}
                      questions={recoveryQuestionsQuery.data?.questions ?? []}
                      inputClassName={inputClass}
                      onQuestionKeyChange={handleRecoveryQuestionKeyChange}
                      onAnswerChange={handleRecoveryAnswerChange}
                    />
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setPostAuthError(null);
                      setRegisterStep(1);
                    }}
                    className="w-full min-h-[40px] rounded-xl border border-white/15 bg-white/5 text-sm font-medium text-white/80 hover:bg-white/10"
                  >
                    Back to step 1
                  </button>
                </div>
              ) : null}

              {showAuthError ? (
                <div className="flex items-start gap-2 text-sm text-red-200/90">
                  <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>{showAuthError}</div>
                </div>
              ) : null}

              <button
                type="submit"
                disabled={submitDisabled}
                className={cn(
                  'w-full min-h-[44px] rounded-xl font-semibold',
                  'bg-[#facc15] text-black hover:bg-[#fde68a]',
                  'transition-all duration-200 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed',
                  'flex items-center justify-center gap-2',
                )}
              >
                {authMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Please wait...
                  </>
                ) : mode === 'register' ? (
                  registerStep === 1 ? 'Continue to security questions' : 'Create admin login'
                ) : (
                  'Sign in'
                )}
              </button>

              {mode === 'login' ? (
                <button
                  type="button"
                  onClick={openResetModal}
                  className="w-full text-sm text-white/70 hover:text-white/90 underline underline-offset-4"
                >
                  Reset password
                </button>
              ) : null}
            </form>
          </div>
        </div>
      </div>

      {resetOpen ? (
        <div className="fixed inset-0 z-[100000] flex items-center justify-center p-4 sm:p-6">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          <div className="relative w-full max-w-lg rounded-3xl border border-white/10 bg-[#0b0c0f]/90 p-5 sm:p-6 shadow-2xl backdrop-blur-2xl">
            <h2 className="text-xl font-semibold text-white">Reset password</h2>
            <p className="mt-1 text-sm text-white/70">
              Enter your username, answer 2 randomly selected security questions, and set a new password.
            </p>

            <form className="mt-4 space-y-4" onSubmit={handleResetSubmit}>
              <div className="space-y-2">
                <label className="block text-xs font-bold text-white/60 uppercase tracking-wider" htmlFor="reset-username">
                  Username
                </label>
                <input
                  id="reset-username"
                  value={resetUsername}
                  onChange={handleResetUsernameChange}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  className={inputClass}
                />
              </div>

              {!resetChallenge ? (
                <button
                  type="button"
                  onClick={loadResetQuestions}
                  disabled={requestResetQuestionsMutation.isPending || !resetUsername.trim()}
                  className="w-full min-h-[42px] rounded-xl border border-white/20 bg-white/10 text-sm font-semibold text-white hover:bg-white/15 disabled:opacity-60"
                >
                  {requestResetQuestionsMutation.isPending ? 'Loading...' : 'Load security questions'}
                </button>
              ) : (
                <>
                  <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-3">
                    {resetChallenge.questions.map((question) => (
                      <div key={`reset-q-${question.slot}`} className="space-y-1">
                        <label
                          className="block text-xs font-bold text-white/60 uppercase tracking-wider"
                          htmlFor={`reset-answer-${question.slot}`}
                        >
                          {question.prompt}
                        </label>
                        <input
                          id={`reset-answer-${question.slot}`}
                          type="text"
                          autoComplete="off"
                          value={resetAnswers[question.slot] ?? ''}
                          onChange={(event) =>
                            handleResetAnswerChange(question.slot, event.target.value)
                          }
                          className={inputClass}
                        />
                      </div>
                    ))}
                  </div>

                  <div className="space-y-2">
                    <label
                      className="block text-xs font-bold text-white/60 uppercase tracking-wider"
                      htmlFor="reset-new-password"
                    >
                      New password
                    </label>
                    <input
                      id="reset-new-password"
                      type="password"
                      autoComplete="new-password"
                      value={resetNewPassword}
                      onChange={handleResetNewPasswordChange}
                      className={inputClass}
                    />
                  </div>

                  <div className="space-y-2">
                    <label
                      className="block text-xs font-bold text-white/60 uppercase tracking-wider"
                      htmlFor="reset-new-password-confirm"
                    >
                      Confirm new password
                    </label>
                    <input
                      id="reset-new-password-confirm"
                      type="password"
                      autoComplete="new-password"
                      value={resetConfirmPassword}
                      onChange={handleResetConfirmPasswordChange}
                      className={inputClass}
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={resetBusy}
                    className="w-full min-h-[44px] rounded-xl bg-[#facc15] text-black font-semibold hover:bg-[#fde68a] disabled:opacity-60"
                  >
                    {resetPasswordMutation.isPending ? 'Resetting...' : 'Reset password'}
                  </button>
                </>
              )}

              {resetHint ? <div className="text-xs text-white/60">{resetHint}</div> : null}

              {resetError ? (
                <div className="flex items-start gap-2 text-sm text-red-200/90">
                  <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{resetError}</span>
                </div>
              ) : null}

              <button
                type="button"
                onClick={closeResetModal}
                disabled={resetBusy}
                className="w-full min-h-[40px] rounded-xl border border-white/15 bg-white/5 text-sm text-white/80 hover:bg-white/10 disabled:opacity-60"
              >
                Close
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
