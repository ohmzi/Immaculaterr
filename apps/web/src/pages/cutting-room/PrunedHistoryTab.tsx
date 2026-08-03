import { useState, type ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';

import {
  listPruneHistory,
  restorePrune,
} from '@/api/cutting-room';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { APP_PRESSABLE_CLASS } from '@/lib/ui-classes';
import {
  CARD_CLASS,
  fmtBytes,
  fmtDate,
} from './shared';
import { FaqPill } from './shared-components';

export function PrunedHistoryTab() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState<'all' | 'movie' | 'show' | 'restored'>(
    'all',
  );
  const [search, setSearch] = useState('');
  const [restoreTarget, setRestoreTarget] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const take = 50;

  const historyQuery = useQuery({
    queryKey: ['cuttingRoom', 'prunes', page, filter, search],
    queryFn: () =>
      listPruneHistory({
        take,
        skip: page * take,
        mediaType:
          filter === 'movie' || filter === 'show' ? filter : undefined,
        restored: filter === 'restored' ? true : undefined,
        search: search || undefined,
      }),
  });
  const total = historyQuery.data?.total ?? 0;
  const items = historyQuery.data?.items ?? [];
  const allTime = historyQuery.data?.allTime ?? null;

  const restore = useMutation({
    mutationFn: (id: string) => restorePrune(id),
    onSuccess: () => {
      toast.success('Re-monitored and searching — it will re-download');
      setRestoreTarget(null);
      void queryClient.invalidateQueries({ queryKey: ['cuttingRoom', 'prunes'] });
    },
    onError: (err) => toast.error((err as Error).message),
  });

  return (
    <div className={CARD_CLASS}>
      <div className="p-4 border-b border-white/10 flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['all', 'All'],
              ['movie', 'Movies'],
              ['show', 'Shows'],
              ['restored', 'Restored'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => {
                setFilter(key);
                setPage(0);
              }}
              className={[
                APP_PRESSABLE_CLASS,
                'px-3 py-1.5 rounded-full text-xs font-semibold border',
                filter === key
                  ? 'bg-[#facc15]/15 text-[#fde68a] border-[#facc15]/25'
                  : 'bg-white/5 text-white/60 border-white/10',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
          <span className="self-center">
            <FaqPill section="cutting-room-pruned-tag-restore" label="Pruned History" />
          </span>
        </div>
        <input
          value={search}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          placeholder="Search pruned titles…"
          className="rounded-xl bg-black/30 border border-white/15 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#facc15]/50 md:w-64"
        />
      </div>

      {historyQuery.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-white/60 p-4">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading history…
        </div>
      ) : items.length === 0 ? (
        <div className="p-8 text-center text-white/50 text-sm">
          Nothing pruned yet. The wizard&rsquo;s deletions land here with a
          Restore button.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-white/60 text-xs uppercase">
              <tr>
                <th className="p-3 text-left">Title</th>
                <th className="p-3 text-left">Type</th>
                <th className="p-3 text-right">Size</th>
                <th className="p-3 text-left hidden md:table-cell">Pruned</th>
                <th className="p-3 text-left hidden md:table-cell">Action</th>
                <th className="p-3 text-right">Restore</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-t border-white/5">
                  <td className="p-3 font-semibold text-white">
                    {item.title}
                    {item.year ? (
                      <span className="text-white/40"> ({item.year})</span>
                    ) : null}
                  </td>
                  <td className="p-3 text-white/60">{item.mediaType}</td>
                  <td className="p-3 text-right font-mono text-white/70">
                    {item.sizeBytes > 0 ? fmtBytes(item.sizeBytes) : '—'}
                  </td>
                  <td className="p-3 hidden md:table-cell text-white/60">
                    {fmtDate(item.createdAt)}
                  </td>
                  <td className="p-3 hidden md:table-cell">
                    <span className="px-2 py-0.5 rounded-full text-[10px] bg-white/10 text-white/60 border border-white/10">
                      {item.action.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="p-3 text-right">
                    {item.restoredAt ? (
                      <span className="text-emerald-300 text-xs font-bold">
                        Restored
                      </span>
                    ) : item.action === 'replaced_for_size' ? (
                      <span
                        className="text-sky-300 text-xs"
                        title="A smaller copy re-downloads automatically"
                      >
                        auto re-downloads
                      </span>
                    ) : item.action === 'files_deleted_unmonitored' ? (
                      <button
                        type="button"
                        onClick={() =>
                          setRestoreTarget({ id: item.id, title: item.title })
                        }
                        className={`${APP_PRESSABLE_CLASS} px-3 py-1 rounded-lg text-xs font-bold bg-emerald-500/15 text-emerald-100 border border-emerald-500/25`}
                      >
                        Restore
                      </button>
                    ) : (
                      <span
                        className="text-white/30 text-xs"
                        title="Entry removed or Plex-only — re-add manually"
                      >
                        manual
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="p-3 flex items-center justify-between text-xs text-white/60 border-t border-white/10">
        <span>
          {total} pruned items
          {allTime && allTime.bytes > 0 ? (
            <span className="ml-2 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-0.5 font-semibold text-emerald-200">
              all-time reclaimed: {fmtBytes(allTime.bytes)} · {allTime.count}{' '}
              items
            </span>
          ) : null}
        </span>
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

      <ConfirmDialog
        open={Boolean(restoreTarget)}
        onClose={() => setRestoreTarget(null)}
        onConfirm={() => restoreTarget && restore.mutate(restoreTarget.id)}
        title={`Restore "${restoreTarget?.title ?? ''}"?`}
        label="Restore"
        variant="primary"
        description="Re-monitors the entry, removes the pruned tag, and triggers a search so it re-downloads automatically."
        confirmText="Restore"
        confirming={restore.isPending}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Wanted list tab

