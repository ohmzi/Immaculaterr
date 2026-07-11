import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  listPruneHistory,
  listWanted,
  restorePrune,
  startWantedPrune,
} from '@/api/cutting-room';
import { getRun } from '@/api/jobs';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { APP_PRESSABLE_CLASS } from '@/lib/ui-classes';
import {
  CARD_CLASS,
  SHIFT_RANGE_HINT,
  fmtDate,
  useShiftRangeSelect,
} from './shared';
import { FaqPill } from './shared-components';

export function WantedTab() {
  const queryClient = useQueryClient();
  const [type, setType] = useState<'radarr' | 'sonarr'>('radarr');
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [useAll, setUseAll] = useState(false);
  const [mode, setMode] = useState<'unmonitor' | 'remove'>('unmonitor');
  const [confirmation, setConfirmation] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const take = 50;

  const wantedQuery = useQuery({
    queryKey: ['cuttingRoom', 'wanted', type, page, search],
    queryFn: () =>
      listWanted({
        type,
        take,
        skip: page * take,
        search: search || undefined,
      }),
  });
  const total = wantedQuery.data?.total ?? 0;
  const items = wantedQuery.data?.items ?? [];
  const rangeFor = useShiftRangeSelect(items);

  const targetCount = useAll ? total : selectedIds.size;

  const runQuery = useQuery({
    queryKey: ['cuttingRoom', 'wantedRun', runId],
    queryFn: () => getRun(runId as string),
    enabled: Boolean(runId),
    refetchInterval: (query) => {
      const status = query.state.data?.run.status;
      return status === 'PENDING' || status === 'RUNNING' ? 2000 : false;
    },
  });
  const run = runQuery.data?.run ?? null;
  const runFinished = run && run.status !== 'PENDING' && run.status !== 'RUNNING';
  const lastRunModeRef = useRef<'unmonitor' | 'remove' | null>(null);
  const undoOfferedRunIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (runFinished) {
      void queryClient.invalidateQueries({ queryKey: ['cuttingRoom', 'wanted'] });
    }
  }, [runFinished, queryClient]);

  // Real unmonitor runs get a short undo window: restoring simply
  // re-monitors the entries this run touched.
  useEffect(() => {
    if (!runFinished || !run || run.dryRun || run.status !== 'SUCCESS') return;
    if (lastRunModeRef.current !== 'unmonitor') return;
    if (undoOfferedRunIdRef.current === run.id) return;
    undoOfferedRunIdRef.current = run.id;
    void listPruneHistory({ take: 200, runId: run.id }).then(({ items }) => {
      if (!items.length) return;
      toast(`Unmonitored ${items.length} item${items.length === 1 ? '' : 's'}`, {
        duration: 12_000,
        action: {
          label: 'Undo',
          onClick: () => {
            void Promise.allSettled(
              items.map((item) => restorePrune(item.id)),
            ).then((results) => {
              const restored = results.filter(
                (result) => result.status === 'fulfilled',
              ).length;
              if (restored > 0) {
                toast.success(
                  `Re-monitored ${restored} item${restored === 1 ? '' : 's'}`,
                );
              } else {
                toast.error('Undo failed — check Pruned History');
              }
              void queryClient.invalidateQueries({ queryKey: ['cuttingRoom'] });
            });
          },
        },
      });
    });
  }, [runFinished, run, queryClient]);

  const startPrune = useMutation({
    mutationFn: () =>
      startWantedPrune({
        type,
        mode,
        confirmation,
        ...(useAll ? { all: true } : { arrIds: Array.from(selectedIds) }),
      }),
    onSuccess: (data) => {
      lastRunModeRef.current = mode;
      setRunId(data.run.id);
      setSelectedIds(new Set());
      setUseAll(false);
      setConfirmation('');
      toast.success('Wanted-list prune started');
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const armed =
    confirmation.trim() === String(targetCount) ||
    confirmation.trim().toUpperCase() === 'PRUNE';

  return (
    <div className={CARD_CLASS}>
      <div className="p-4 border-b border-white/10 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm text-white/70">
            Monitored {type === 'radarr' ? 'movies' : 'shows'} that{' '}
            <span className="font-bold text-white">never downloaded anything</span>.
            Unmonitoring or removing them stops future downloads —{' '}
            <span className="text-emerald-300 font-semibold">no files are ever touched</span>.
          </p>
          <FaqPill section="cutting-room-wanted-list" label="Wanted List" />
        </div>
        <div className="flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['radarr', 'Radarr (movies)'],
                ['sonarr', 'Sonarr (shows)'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setType(key);
                  setPage(0);
                  setSelectedIds(new Set());
                  setUseAll(false);
                }}
                className={[
                  APP_PRESSABLE_CLASS,
                  'px-3 py-1.5 rounded-full text-xs font-semibold border',
                  type === key
                    ? 'bg-[#facc15]/15 text-[#fde68a] border-[#facc15]/25'
                    : 'bg-white/5 text-white/60 border-white/10',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setUseAll((v) => !v);
                setSelectedIds(new Set());
              }}
              className={[
                APP_PRESSABLE_CLASS,
                'px-3 py-1.5 rounded-full text-xs font-semibold border',
                useAll
                  ? 'bg-emerald-500/15 text-emerald-100 border-emerald-500/25'
                  : 'bg-white/5 text-white/60 border-white/10',
              ].join(' ')}
            >
              {useAll ? `All ${total} selected` : 'Select ALL matching'}
            </button>
          </div>
          <input
            value={search}
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="Search titles…"
            className="rounded-xl bg-black/30 border border-white/15 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#facc15]/50 md:w-64"
          />
        </div>
      </div>

      {wantedQuery.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-white/60 p-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading wanted list…
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-white/60 text-xs uppercase">
              <tr>
                <th className="p-3 text-left w-10" />
                <th className="p-3 text-left">Title</th>
                <th className="p-3 text-left hidden md:table-cell">Added</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => {
                const checked = useAll || selectedIds.has(item.arrId);
                return (
                  <tr key={item.arrId} className="border-t border-white/5">
                    <td className="p-3">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={useAll}
                        onClick={(e) => {
                          const nextSelected = !selectedIds.has(item.arrId);
                          const [from, to] = rangeFor(index, e.shiftKey);
                          setSelectedIds((prev) => {
                            const next = new Set(prev);
                            for (let i = from; i <= to; i += 1) {
                              if (nextSelected) next.add(items[i].arrId);
                              else next.delete(items[i].arrId);
                            }
                            return next;
                          });
                        }}
                        onChange={() => undefined}
                        onMouseDown={(e) => {
                          if (e.shiftKey) e.preventDefault();
                        }}
                        className="h-4 w-4 accent-[#facc15]"
                        aria-label={`Select ${item.title}`}
                        title={SHIFT_RANGE_HINT}
                      />
                    </td>
                    <td className="p-3 font-semibold text-white">
                      {item.title}
                      {item.year ? (
                        <span className="text-white/40"> ({item.year})</span>
                      ) : null}
                    </td>
                    <td className="p-3 hidden md:table-cell text-white/60">
                      {item.added ? fmtDate(item.added) : '—'}
                    </td>
                  </tr>
                );
              })}
              {items.length === 0 ? (
                <tr>
                  <td colSpan={3} className="p-6 text-center text-white/50">
                    Wanted list is empty — nothing queued for download.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

      <div className="p-3 flex items-center justify-between text-xs text-white/60 border-t border-white/10">
        <span>{total} entries</span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className={`${APP_PRESSABLE_CLASS} px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 disabled:opacity-30`}
          >
            Prev
          </button>
          <button
            type="button"
            disabled={(page + 1) * take >= total}
            onClick={() => setPage((p) => p + 1)}
            className={`${APP_PRESSABLE_CLASS} px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 disabled:opacity-30`}
          >
            Next
          </button>
        </div>
      </div>

      <div className="p-4 border-t border-white/10 flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ['unmonitor', 'Unmonitor (keep entries)'],
              ['remove', 'Remove entries'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setMode(key)}
              className={[
                APP_PRESSABLE_CLASS,
                'px-3 py-1.5 rounded-full text-xs font-semibold border',
                mode === key
                  ? 'bg-[#facc15]/15 text-[#fde68a] border-[#facc15]/25'
                  : 'bg-white/5 text-white/60 border-white/10',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
          {targetCount > 0 ? (
            <input
              value={confirmation}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                setConfirmation(e.target.value)
              }
              placeholder={`type ${targetCount} to arm`}
              className="rounded-xl bg-black/30 border border-white/15 px-3 py-1.5 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-[#facc15]/50 w-36"
            />
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          {run && !runFinished ? (
            <span className="flex items-center gap-2 text-xs text-white/60">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> working…
            </span>
          ) : null}
          <button
            type="button"
            disabled={targetCount === 0 || !armed || startPrune.isPending}
            onClick={() => setConfirmOpen(true)}
            className={`${APP_PRESSABLE_CLASS} px-4 py-2 rounded-xl bg-rose-500/90 text-white font-bold text-sm disabled:opacity-40`}
          >
            {mode === 'unmonitor' ? 'Unmonitor' : 'Remove'} {targetCount || ''}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          startPrune.mutate();
        }}
        title={`${mode === 'unmonitor' ? 'Unmonitor' : 'Remove'} ${targetCount} wanted entries?`}
        label="Wanted list"
        variant="danger"
        description="No files are touched — this only stops future downloads. Everything is recorded in Pruned History."
        confirmText={mode === 'unmonitor' ? 'Unmonitor' : 'Remove'}
        confirming={startPrune.isPending}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Duplicates tab

