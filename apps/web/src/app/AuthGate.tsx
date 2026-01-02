import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, Loader2, Lock, User } from 'lucide-react';

import { getBootstrap, getMe, login, registerAdmin } from '@/api/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <div className="relative flex min-h-screen items-center justify-center px-4 py-10">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-primary/20 blur-3xl" />
          <div className="absolute -right-24 top-1/3 h-72 w-72 rounded-full bg-emerald-500/10 blur-3xl" />
        </div>
        <div className="relative w-full max-w-md">{children}</div>
      </div>
    </div>
  );
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');

  const bootstrapQuery = useQuery({
    queryKey: ['auth', 'bootstrap'],
    queryFn: getBootstrap,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const meQuery = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: getMe,
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
  });

  const needsAdminSetup = Boolean(bootstrapQuery.data?.needsAdminSetup);
  const user = meQuery.data?.user ?? null;

  const authMutation = useMutation({
    mutationFn: async () => {
      if (needsAdminSetup) {
        return await registerAdmin({ username, password });
      }
      return await login({ username, password });
    },
    onSuccess: async () => {
      setPassword('');
      await queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });

  const modeLabel = useMemo(
    () => (needsAdminSetup ? 'Create admin account' : 'Sign in'),
    [needsAdminSetup],
  );

  if (bootstrapQuery.isLoading || meQuery.isLoading) {
    return (
      <AuthShell>
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      </AuthShell>
    );
  }

  if (bootstrapQuery.error) {
    return (
      <AuthShell>
        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          <CircleAlert className="mt-0.5 h-4 w-4" />
          <div>{(bootstrapQuery.error as Error).message}</div>
        </div>
      </AuthShell>
    );
  }

  if (user) return <>{children}</>;

  return (
    <AuthShell>
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground">
              TC
            </span>
            <span>{modeLabel}</span>
          </CardTitle>
          <CardDescription>
            {needsAdminSetup
              ? 'First run: create the admin account to protect your API keys and settings.'
              : 'Login is required to access settings, jobs, and integrations.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label>Username</Label>
            <div className="relative">
              <User className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                className="pl-9"
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Password</Label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={needsAdminSetup ? 'new-password' : 'current-password'}
                placeholder={needsAdminSetup ? 'At least 10 characters' : 'Your password'}
                className="pl-9"
              />
            </div>
          </div>

          {authMutation.error ? (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              <CircleAlert className="mt-0.5 h-4 w-4" />
              <div>{(authMutation.error as Error).message}</div>
            </div>
          ) : null}

          <Button
            className="w-full"
            onClick={() => authMutation.mutate()}
            disabled={authMutation.isPending || !username.trim() || !password.trim()}
          >
            {authMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Please wait…
              </>
            ) : needsAdminSetup ? (
              'Create admin + sign in'
            ) : (
              'Sign in'
            )}
          </Button>

          <div className="text-xs text-muted-foreground">
            Session is stored in a <span className="font-medium">session cookie</span> (clears when
            the browser closes). API keys are encrypted server-side and never shown again after
            saving.
          </div>
        </CardContent>
      </Card>
    </AuthShell>
  );
}


