import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  listDuplicates,
  startDuplicateCleanup,
} from '@/api/cutting-room';
import { getRun } from '@/api/jobs';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { APP_PRESSABLE_CLASS } from '@/lib/ui-classes';
import {
  CARD_CLASS,
  fmtBytes,
  useShiftRangeSelect,
} from './shared';
import { FaqPill } from './shared-components';

export function DuplicatesTab() {
  const queryClient = useQueryClient();
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [preference, setPreference] = useState<'smallest_file' | 'largest_file'>(
    'smallest_file',
  );
  const [confirmation, setConfirmation] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dryRun, setDryRun] = useState(true);
  const [runId, setRunId] = useState<string | null>(null);

  const duplicatesQuery = useQuery({
    queryKey: ['cuttingRoom', 'duplicates'],
    queryFn: () => listDuplicates(),
  });
  const groups = duplicatesQuery.data?.groups ?? [];
  const rangeFor = useShiftRangeSelect(groups);
  const totalWaste = duplicatesQuery.data?.wasteBytes ?? 0;

  const runQuery = useQuery({
    queryKey: ['cuttingRoom', 'duplicatesRun', runId],
    queryFn: () => getRun(runId as string),
    enabled: Boolean(runId),
    refetchInterval: (query) => {
      const status = query.state.data?.run.status;
      return status === 'PENDING' || status === 'RUNNING' ? 2000 : false;
    },
  });
  const run = runQuery.data?.run ?? null;
  const runFinished = run && run.status !== 'PENDING' && run.status !== 'RUNNING';
  const runHeadline = useMemo(() => {
    const summary = run?.summary as { headline?: string } | null | undefined;
    return summary?.headline ?? null;
  }, [run?.summary]);

  useEffect(() => {
    if (runFinished && run && !run.dryRun) {
      void queryClient.invalidateQueries({
        queryKey: ['cuttingRoom', 'duplicates'],
      });
    }
  }, [runFinished, run, queryClient]);

  const startCleanup = useMutation({
    mutationFn: (asDryRun: boolean) =>
      startDuplicateCleanup({
        ratingKeys: Array.from(selectedKeys),
        deletePreference: preference,
        confirmation,
        dryRun: asDryRun,
      }),
    onSuccess: (data, asDryRun) => {
      setRunId(data.run.id);
      setConfirmation('');
      if (!asDryRun) setSelectedKeys(new Set());
      toast.success(asDryRun ? 'Dry-run started' : 'Duplicate cleanup started');
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const armed =
    dryRun ||
    confirmation.trim() === String(selectedKeys.size) ||
    confirmation.trim().toUpperCase() === 'PRUNE';

  return (
    <div className={CARD_CLASS}>
      <div className="p-4 border-b border-white/10 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm text-white/70">
            Movies with <span className="font-bold text-white">more than one version</span> in
            Plex. Cleanup keeps one copy per movie and deletes the rest through
            Plex —{' '}
            <span className="font-bold text-[#fde68a]">
              {fmtBytes(totalWaste)}
            </span>{' '}
            reclaimable across {groups.length} movies.
          </p>
          <FaqPill section="cutting-room-duplicates" label="Duplicates" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ['smallest_file', 'Keep largest copy'],
              ['largest_file', 'Keep smallest copy'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setPreference(key)}
              className={[
                APP_PRESSABLE_CLASS,
                'px-3 py-1.5 rounded-full text-xs font-semibold border',
                preference === key
                  ? 'bg-[#facc15]/15 text-[#fde68a] border-[#facc15]/25'
                  : 'bg-white/5 text-white/60 border-white/10',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={() =>
              setSelectedKeys(
                selectedKeys.size === groups.length
                  ? new Set()
                  : new Set(groups.map((g) => g.ratingKey)),
              )
            }
            className={`${APP_PRESSABLE_CLASS} px-3 py-1.5 rounded-full text-xs font-semibold border bg-white/5 text-white/70 border-white/10`}
          >
            {selectedKeys.size === groups.length && groups.length > 0
              ? 'Clear selection'
              : `Select all ${groups.length}`}
          </button>
        </div>
      </div>

      {duplicatesQuery.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-white/60 p-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Scanning for duplicates…
        </div>
      ) : groups.length === 0 ? (
        <div className="p-8 text-center text-white/50 text-sm">
          No duplicate versions found — every movie has a single copy.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-white/60 text-xs uppercase">
              <tr>
                <th className="p-3 text-left w-10" />
                <th className="p-3 text-left">Title</th>
                <th className="p-3 text-left">Versions</th>
                <th className="p-3 text-right">Reclaimable</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group, index) => {
                const checked = selectedKeys.has(group.ratingKey);
                const largest = Math.max(
                  ...group.versions.map((v) => v.sizeBytes),
                );
                return (
                  <tr key={group.ratingKey} className="border-t border-white/5">
                    <td className="p-3">
                      <input
                        type="checkbox"
                        checked={checked}
                        onClick={(e) => {
                          const nextSelected = !selectedKeys.has(
                            group.ratingKey,
                          );
                          const [from, to] = rangeFor(index, e.shiftKey);
                          setSelectedKeys((prev) => {
                            const next = new Set(prev);
                            for (let i = from; i <= to; i += 1) {
                              if (nextSelected) next.add(groups[i].ratingKey);
                              else next.delete(groups[i].ratingKey);
                            }
                            return next;
                          });
                        }}
                        onChange={() => undefined}
                        onMouseDown={(e) => {
                          if (e.shiftKey) e.preventDefault();
                        }}
                        className="h-4 w-4 accent-[#facc15]"
                        aria-label={`Select ${group.title}`}
                      />
                    </td>
                    <td className="p-3 font-semibold text-white">
                      {group.title}
                      {group.year ? (
                        <span className="text-white/40"> ({group.year})</span>
                      ) : null}
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {group.versions.map((v, index) => (
                          <span
                            key={`${group.ratingKey}-${v.mediaId ?? index}`}
                            className={[
                              'px-2 py-0.5 rounded-full text-[10px] font-semibold border',
                              v.sizeBytes === largest
                                ? 'bg-emerald-500/15 text-emerald-100 border-emerald-500/25'
                                : 'bg-white/10 text-white/60 border-white/10',
                            ].join(' ')}
                            title={v.file ?? undefined}
                          >
                            {v.videoResolution ?? '?'} · {fmtBytes(v.sizeBytes)}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="p-3 text-right font-mono text-white/80">
                      {fmtBytes(group.wasteBytes)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="p-4 border-t border-white/10 flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-white/80 cursor-pointer">
            <input
              type="checkbox"
              checked={dryRun}
              onChange={() => setDryRun((v) => !v)}
              className="h-4 w-4 accent-[#facc15]"
            />
            Dry run first
          </label>
          {!dryRun && selectedKeys.size > 0 ? (
            <input
              value={confirmation}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                setConfirmation(e.target.value)
              }
              placeholder={`type ${selectedKeys.size} to arm`}
              className="rounded-xl bg-black/30 border border-white/15 px-3 py-1.5 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-[#facc15]/50 w-36"
            />
          ) : null}
          {run && !runFinished ? (
            <span className="flex items-center gap-2 text-xs text-white/60">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> working…
            </span>
          ) : null}
          {runFinished && runHeadline ? (
            <span className="text-xs text-emerald-200">{runHeadline}</span>
          ) : null}
        </div>
        <button
          type="button"
          disabled={selectedKeys.size === 0 || !armed || startCleanup.isPending}
          onClick={() => {
            if (dryRun) startCleanup.mutate(true);
            else setConfirmOpen(true);
          }}
          className={[
            APP_PRESSABLE_CLASS,
            'px-4 py-2 rounded-xl font-bold text-sm disabled:opacity-40',
            dryRun
              ? 'bg-sky-500/20 text-sky-100 border border-sky-500/30'
              : 'bg-rose-500/90 text-white',
          ].join(' ')}
        >
          {dryRun ? 'Rehearse cleanup' : `Clean up ${selectedKeys.size || ''}`}
        </button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          startCleanup.mutate(false);
        }}
        title={`Remove extra versions of ${selectedKeys.size} movies?`}
        label="Duplicates"
        variant="danger"
        description="One copy per movie is kept according to your preference; the rest are deleted through Plex. This requires Plex's 'Allow media deletion' setting."
        confirmText="Clean up"
        confirming={startCleanup.isPending}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Large Files tab

