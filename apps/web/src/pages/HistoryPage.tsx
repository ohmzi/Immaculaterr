import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CircleAlert, Loader2 } from 'lucide-react';

import { listJobs, listRuns, type JobRun } from '@/api/jobs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

function statusPill(status: string) {
  switch (status) {
    case 'SUCCESS':
      return 'bg-emerald-600 text-white';
    case 'FAILED':
      return 'bg-destructive text-destructive-foreground';
    case 'RUNNING':
      return 'bg-amber-500 text-white';
    default:
      return 'bg-muted text-foreground';
  }
}

function durationMs(run: JobRun): number | null {
  if (!run.finishedAt) return null;
  const a = Date.parse(run.startedAt);
  const b = Date.parse(run.finishedAt);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, b - a);
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return `${m}m ${r}s`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h ${mm}m`;
}

export function HistoryPage() {
  const [jobId, setJobId] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');

  const jobsQuery = useQuery({
    queryKey: ['jobs'],
    queryFn: listJobs,
    staleTime: 10_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const historyQuery = useQuery({
    queryKey: ['jobRuns', 'historyPage'],
    queryFn: () => listRuns({ take: 200 }),
    staleTime: 2_000,
    refetchInterval: 3_000,
    refetchOnWindowFocus: false,
    retry: false,
  });

  const filtered = useMemo(() => {
    const runs = historyQuery.data?.runs ?? [];
    const query = q.trim().toLowerCase();
    return runs.filter((r) => {
      if (jobId && r.jobId !== jobId) return false;
      if (status && r.status !== status) return false;
      if (!query) return true;
      const hay = `${r.jobId} ${r.status} ${r.errorMessage ?? ''}`.toLowerCase();
      return hay.includes(query);
    });
  }, [historyQuery.data?.runs, jobId, status, q]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">History</h1>
          <p className="text-sm text-muted-foreground">
            History of job runs (logs, summary, errors).
          </p>
        </div>
        <Button asChild variant="outline">
          <Link to="/jobs">Back to Jobs</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
          <CardDescription>Filter by job, status, or a quick text search.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-3">
          <div className="grid gap-2">
            <Label>Job</Label>
            <select
              value={jobId}
              onChange={(e) => setJobId(e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">All jobs</option>
              {(jobsQuery.data?.jobs ?? []).map((j) => (
                <option key={j.id} value={j.id}>
                  {j.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-2">
            <Label>Status</Label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Any</option>
              <option value="RUNNING">RUNNING</option>
              <option value="SUCCESS">SUCCESS</option>
              <option value="FAILED">FAILED</option>
              <option value="PENDING">PENDING</option>
            </select>
          </div>

          <div className="grid gap-2">
            <Label>Search</Label>
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="jobId, status, error text…"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent history</CardTitle>
          <CardDescription>
            {historyQuery.isLoading ? 'Loading…' : `${filtered.length} shown`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {historyQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : historyQuery.error ? (
            <div className="flex items-start gap-2 text-sm text-destructive">
              <CircleAlert className="mt-0.5 h-4 w-4" />
              <div>{(historyQuery.error as Error).message}</div>
            </div>
          ) : filtered.length ? (
            <div className="overflow-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Time</th>
                    <th className="px-3 py-2">Job</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Mode</th>
                    <th className="px-3 py-2">Duration</th>
                    <th className="px-3 py-2">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((run) => {
                    const ms = durationMs(run);
                    return (
                      <tr key={run.id} className="border-t hover:bg-muted/20">
                        <td className="px-3 py-2 whitespace-nowrap">
                          <Link
                            className="font-mono text-xs underline-offset-4 hover:underline"
                            to={`/history/${run.id}`}
                          >
                            {new Date(run.startedAt).toLocaleString()}
                          </Link>
                        </td>
                        <td className="px-3 py-2">{run.jobId}</td>
                        <td className="px-3 py-2">
                          <span
                            className={cn(
                              'rounded-full px-2 py-1 text-xs font-medium',
                              statusPill(run.status),
                            )}
                          >
                            {run.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {run.dryRun ? 'dry-run' : 'live'}
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {ms === null ? '—' : formatDuration(ms)}
                        </td>
                        <td className="px-3 py-2 text-destructive">
                          {run.errorMessage
                            ? run.errorMessage.length > 80
                              ? `${run.errorMessage.slice(0, 80)}…`
                              : run.errorMessage
                            : ''}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">No history found.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}


