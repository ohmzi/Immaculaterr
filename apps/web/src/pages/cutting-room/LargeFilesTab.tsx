import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  getCuttingRoomRules,
  listLargeFiles,
  startLargeFilesReplace,
} from '@/api/cutting-room';
import { getRun } from '@/api/jobs';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { APP_PRESSABLE_CLASS } from '@/lib/ui-classes';
import {
  CARD_CLASS,
  fmtBytes,
  lfItemKey,
} from './shared';
import { FaqPill, LargeFilesTable } from './shared-components';

export function LargeFilesTab() {
  const queryClient = useQueryClient();
  const rulesQuery = useQuery({
    queryKey: ['cuttingRoom', 'rules'],
    queryFn: getCuttingRoomRules,
  });
  const savedThresholdGb = rulesQuery.data?.rules.largeFilesThresholdGb ?? 10;
  const [thresholdGb, setThresholdGb] = useState<number | null>(null);
  const [appliedThreshold, setAppliedThreshold] = useState<number | null>(null);
  const effectiveThreshold = thresholdGb ?? savedThresholdGb;
  const effectiveApplied = appliedThreshold ?? savedThresholdGb;
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [confirmation, setConfirmation] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dryRun, setDryRun] = useState(true);
  const [runId, setRunId] = useState<string | null>(null);

  const largeQuery = useQuery({
    queryKey: ['cuttingRoom', 'largeFiles', effectiveApplied],
    queryFn: () => listLargeFiles(effectiveApplied),
  });
  const items = largeQuery.data?.items ?? [];
  const totalBytes = largeQuery.data?.totalBytes ?? 0;
  const scanWarnings = largeQuery.data?.warnings ?? [];

  const runQuery = useQuery({
    queryKey: ['cuttingRoom', 'largeFilesRun', runId],
    queryFn: () => getRun(runId as string),
    enabled: Boolean(runId),
    refetchInterval: (query) => {
      const status = query.state.data?.run.status;
      return status === 'PENDING' || status === 'RUNNING' ? 2000 : false;
    },
  });
  const run = runQuery.data?.run ?? null;
  const runFinished =
    run && run.status !== 'PENDING' && run.status !== 'RUNNING';
  const runHeadline = useMemo(() => {
    const summary = run?.summary as { headline?: string } | null | undefined;
    return summary?.headline ?? null;
  }, [run?.summary]);

  useEffect(() => {
    if (runFinished && run && !run.dryRun) {
      void queryClient.invalidateQueries({
        queryKey: ['cuttingRoom', 'largeFiles'],
      });
      void queryClient.invalidateQueries({ queryKey: ['cuttingRoom', 'prunes'] });
    }
  }, [runFinished, run, queryClient]);

  const selectedItems = items.filter((item) =>
    selectedKeys.has(lfItemKey(item)),
  );

  const startReplace = useMutation({
    mutationFn: (asDryRun: boolean) =>
      startLargeFilesReplace({
        items: selectedItems,
        confirmation,
        dryRun: asDryRun,
      }),
    onSuccess: (data, asDryRun) => {
      setRunId(data.run.id);
      setConfirmation('');
      if (!asDryRun) setSelectedKeys(new Set());
      toast.success(asDryRun ? 'Dry-run started' : 'Replacement started');
    },
    onError: (err) => toast.error((err as Error).message),
  });

  const armed =
    dryRun ||
    confirmation.trim() === String(selectedItems.length) ||
    confirmation.trim().toUpperCase() === 'PRUNE';

  return (
    <div className={CARD_CLASS}>
      <div className="p-4 border-b border-white/10 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm text-white/70">
            Movies and episodes whose files exceed the size threshold. Replacing
            deletes the file, re-monitors{' '}
            <span className="font-bold text-white">
              exactly the affected items
            </span>{' '}
            (episodes: only those episodes, their seasons, and the show), tags
            them <code className="text-[#fde68a]">size-reduction</code>,
            switches them to a size-capped quality profile (movies ~10 GB max,
            episodes 3 GB max preferring 1–2 GB), and triggers a fresh search
            for a smaller copy.
          </p>
          <FaqPill section="cutting-room-large-files" label="Large Files" />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-white/80">
            Larger than
            <input
              type="number"
              min={1}
              step={1}
              value={effectiveThreshold}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                setThresholdGb(Math.max(1, Number(e.target.value) || 10))
              }
              className="w-20 rounded-xl bg-black/30 border border-white/15 px-2 py-1.5 text-sm text-white focus:outline-none focus:border-[#facc15]/50"
            />
            GB
          </label>
          <button
            type="button"
            onClick={() => {
              setAppliedThreshold(effectiveThreshold);
              setSelectedKeys(new Set());
            }}
            className={`${APP_PRESSABLE_CLASS} px-3 py-1.5 rounded-full text-xs font-semibold border bg-[#facc15]/15 text-[#fde68a] border-[#facc15]/25`}
          >
            Scan
          </button>
          <button
            type="button"
            onClick={() =>
              setSelectedKeys(
                selectedItems.length === items.length
                  ? new Set()
                  : new Set(items.map((item) => lfItemKey(item))),
              )
            }
            className={`${APP_PRESSABLE_CLASS} px-3 py-1.5 rounded-full text-xs font-semibold border bg-white/5 text-white/70 border-white/10`}
          >
            {selectedItems.length === items.length && items.length > 0
              ? 'Clear selection'
              : `Select all ${items.length}`}
          </button>
          <span className="text-xs text-white/50">
            {items.length} files · {fmtBytes(totalBytes)} total
          </span>
        </div>
        {scanWarnings.length > 0 ? (
          <div className="rounded-xl border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-xs text-amber-100 space-y-0.5">
            {scanWarnings.map((warning) => (
              <div key={warning}>{warning}</div>
            ))}
          </div>
        ) : null}
      </div>

      {largeQuery.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-white/60 p-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Scanning file sizes…
        </div>
      ) : items.length === 0 ? (
        <div className="p-8 text-center text-white/50 text-sm">
          Nothing over {effectiveApplied} GB — your files are already lean.
        </div>
      ) : (
        <LargeFilesTable
          items={items}
          selectedKeys={selectedKeys}
          onSelect={(keys, selected) =>
            setSelectedKeys((prev) => {
              const next = new Set(prev);
              for (const key of keys) {
                if (selected) next.add(key);
                else next.delete(key);
              }
              return next;
            })
          }
        />
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
          {!dryRun && selectedItems.length > 0 ? (
            <input
              value={confirmation}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                setConfirmation(e.target.value)
              }
              placeholder={`type ${selectedItems.length} to arm`}
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
          disabled={selectedItems.length === 0 || !armed || startReplace.isPending}
          onClick={() => {
            if (dryRun) startReplace.mutate(true);
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
          {dryRun
            ? 'Rehearse replacement'
            : `Replace ${selectedItems.length || ''} files`}
        </button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          startReplace.mutate(false);
        }}
        title={`Replace ${selectedItems.length} oversized files (${fmtBytes(selectedItems.reduce((sum, item) => sum + item.sizeBytes, 0))})?`}
        label="Large Files"
        variant="danger"
        description="Files are deleted, exactly the affected items are re-monitored (episodes: only those episodes, their seasons, and the show), tagged size-reduction, and a fresh search grabs smaller copies automatically."
        confirmText="Replace"
        confirming={startReplace.isPending}
      />
    </div>
  );
}

