import {
  useCallback,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, Eye, EyeOff, Loader2, LogIn, UserPlus } from 'lucide-react';

import { bootstrap, getMeOrNull, login, register } from '@/api/auth';
import {
  APP_BG_DARK_WASH_CLASS,
  APP_BG_HIGHLIGHT_CLASS,
  APP_BG_IMAGE_URL,
  APP_CARD_ICON_GLOW_CLASS,
  APP_CARD_INTERACTIVE_CLASS,
} from '@/lib/ui-classes';
import { cn } from '@/lib/utils';

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
  const [showPassword, setShowPassword] = useState(false);
  const [postAuthError, setPostAuthError] = useState<string | null>(null);

  const mode = useMemo<'register' | 'login'>(() => {
    if (bootstrapQuery.data?.needsAdminSetup) return 'register';
    return 'login';
  }, [bootstrapQuery.data?.needsAdminSetup]);

  const authMutation = useMutation({
    mutationFn: () => {
      setPostAuthError(null);
      const u = username.trim();
      const p = password;
      if (mode === 'register') return register({ username: u, password: p });
      return login({ username: u, password: p });
    },
    onSuccess: async () => {
      setPassword('');
      await queryClient.invalidateQueries({ queryKey: ['auth', 'bootstrap'] });
      // Confirm the session actually works (cookie set + accepted).
      // If this fails (e.g., cookies blocked or Secure cookie on HTTP), show a visible error
      // instead of silently doing nothing.
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
  const handleFormSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      authMutation.mutate();
    },
    [authMutation],
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
  const handlePasswordToggleClick = useCallback(() => {
    setShowPassword((value) => !value);
  }, []);

  // Errors (bootstrap errors are important; auth/me errors other than 401 are handled in getMeOrNull).
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

  // If we are authenticated, render the app.
  if (meQuery.data) return <>{children}</>;

  // Loading states - show loading until BOTH queries have completed
  // This prevents flashing the auth form while checking authentication
  if (bootstrapQuery.isLoading || meQuery.isLoading || bootstrapQuery.isFetching || meQuery.isFetching) {
    return (
      <div className="relative min-h-screen overflow-hidden bg-gray-50 dark:bg-gray-900 select-none [-webkit-touch-callout:none]">
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
          <div className="flex items-center gap-3 text-sm text-white/70">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking session…
          </div>
        </div>
      </div>
    );
  }

  const title = mode === 'register' ? 'Create admin login' : 'Sign in';
  const subtitle =
    mode === 'register'
      ? 'First-time setup. This becomes your sign-in for all devices.'
      : 'Use your admin credentials to continue.';

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
                    <h1 className="text-2xl font-semibold text-white tracking-tight">
                      {title}
                    </h1>
                    <p className="mt-1 text-sm text-white/70 leading-relaxed">
                      {subtitle}
                    </p>
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
                  <div className="text-xs text-white/50">
                    Use 10+ characters.
                  </div>
                ) : null}
              </div>

              {authMutation.error || postAuthError ? (
                <div className="flex items-start gap-2 text-sm text-red-200/90">
                  <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    {postAuthError ?? (authMutation.error as Error).message ?? 'Sign-in failed.'}
                  </div>
                </div>
              ) : null}

              <button
                type="submit"
                disabled={authMutation.isPending || !username.trim() || !password}
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
                    Please wait…
                  </>
                ) : mode === 'register' ? (
                  'Create admin login'
                ) : (
                  'Sign in'
                )}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
