import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, Loader2, LogIn, UserPlus } from 'lucide-react';

import { bootstrap, getMeOrNull, login, register } from '@/api/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

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

  const mode = useMemo<'register' | 'login'>(() => {
    if (bootstrapQuery.data?.needsAdminSetup) return 'register';
    return 'login';
  }, [bootstrapQuery.data?.needsAdminSetup]);

  const authMutation = useMutation({
    mutationFn: async () => {
      const u = username.trim();
      const p = password;
      if (mode === 'register') return register({ username: u, password: p });
      return login({ username: u, password: p });
    },
    onSuccess: async () => {
      setPassword('');
      await queryClient.invalidateQueries({ queryKey: ['auth', 'bootstrap'] });
      await queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
    },
  });

  // Errors (bootstrap errors are important; auth/me errors other than 401 are handled in getMeOrNull).
  if (bootstrapQuery.error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="flex items-start gap-2 text-sm text-destructive max-w-lg">
          <CircleAlert className="mt-0.5 h-4 w-4" />
          <div>{(bootstrapQuery.error as Error).message}</div>
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
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      </div>
    );
  }

  const title = mode === 'register' ? 'Create admin account' : 'Sign in';
  const subtitle =
    mode === 'register'
      ? 'First-time setup: create the initial admin user to continue.'
      : 'Sign in to continue to the dashboard.';

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl flex items-center gap-2">
            {mode === 'register' ? <UserPlus className="h-5 w-5" /> : <LogIn className="h-5 w-5" />}
            {title}
          </CardTitle>
          <CardDescription>{subtitle}</CardDescription>
        </CardHeader>

        <CardContent>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              authMutation.mutate();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {authMutation.error ? (
              <div className="flex items-start gap-2 text-sm text-destructive">
                <CircleAlert className="mt-0.5 h-4 w-4" />
                <div>{(authMutation.error as Error).message}</div>
              </div>
            ) : null}

            <Button
              type="submit"
              className="w-full"
              disabled={authMutation.isPending || !username.trim() || !password}
            >
              {authMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Please wait…
                </>
              ) : mode === 'register' ? (
                'Create account'
              ) : (
                'Sign in'
              )}
            </Button>
          </form>
        </CardContent>

        <CardFooter className="text-xs text-muted-foreground">
          Authentication is session-based; your browser stores a secure httpOnly cookie.
        </CardFooter>
      </Card>
    </div>
  );
}

