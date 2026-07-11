import { useState, type ChangeEvent } from 'react';
import { Info, X } from 'lucide-react';

import type { LargeFileItem } from '@/api/cutting-room';
import { useSafeNavigate } from '@/lib/navigation';
import { fmtBytes, lfItemKey, SHIFT_RANGE_HINT, useShiftRangeSelect } from './shared';

export function TagPillInput(props: {
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
  ariaLabel: string;
}) {
  const { value, onChange, placeholder, ariaLabel } = props;
  const [draft, setDraft] = useState('');

  const commit = (raw: string) => {
    const additions = raw
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0 && !value.includes(t));
    if (additions.length > 0) onChange([...value, ...additions]);
    setDraft('');
  };

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 w-full rounded-xl bg-black/30 border border-white/15 px-2 py-1.5 focus-within:border-[#facc15]/50"
      onClick={(e) => {
        const input = (e.currentTarget as HTMLElement).querySelector('input');
        input?.focus();
      }}
    >
      {value.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 rounded-full bg-white/10 border border-white/10 px-2.5 py-1 text-xs font-semibold text-white/85"
        >
          {tag}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onChange(value.filter((t) => t !== tag));
            }}
            className="rounded-full p-0.5 text-white/50 hover:text-white hover:bg-white/15 transition"
            aria-label={`Remove tag ${tag}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          const next = e.target.value;
          if (next.includes(',')) commit(next);
          else setDraft(next);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit(draft);
          } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => {
          if (draft.trim()) commit(draft);
        }}
        placeholder={value.length === 0 ? placeholder : ''}
        aria-label={ariaLabel}
        className="flex-1 min-w-[8rem] bg-transparent px-1 py-1 text-sm text-white placeholder:text-white/30 focus:outline-none"
      />
    </div>
  );
}

export function FaqPill(props: { section: string; label: string }) {
  const navigate = useSafeNavigate();
  return (
    <button
      type="button"
      onClick={() => void navigate(`/faq#${props.section}`)}
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] font-semibold leading-none text-white/75 transition hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/20 sm:gap-1.5 sm:px-3 sm:py-1.5 sm:text-xs"
      aria-label={`Open FAQ for ${props.label}`}
      title={`Open FAQ for ${props.label}`}
    >
      <Info className="h-3.5 w-3.5 shrink-0" />
      <span className="max-[420px]:hidden">FAQ</span>
    </button>
  );
}

export function LargeFilesTable(props: {
  items: LargeFileItem[];
  selectedKeys: Set<string>;
  onSelect: (keys: string[], selected: boolean) => void;
}) {
  const { items, selectedKeys, onSelect } = props;
  const rangeFor = useShiftRangeSelect(items);
  const handleRowClick = (index: number, shiftKey: boolean) => {
    const nextSelected = !selectedKeys.has(lfItemKey(items[index]));
    const [from, to] = rangeFor(index, shiftKey);
    const keys: string[] = [];
    for (let i = from; i <= to; i += 1) keys.push(lfItemKey(items[i]));
    onSelect(keys, nextSelected);
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-white/5 text-white/60 text-xs uppercase">
          <tr>
            <th className="p-3 text-left w-10" />
            <th className="p-3 text-left">Title</th>
            <th className="p-3 text-left">Type</th>
            <th className="p-3 text-right">Size</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => {
            const key = lfItemKey(item);
            return (
              <tr key={key} className="border-t border-white/5">
                <td className="p-3">
                  <input
                    type="checkbox"
                    checked={selectedKeys.has(key)}
                    onClick={(e) => handleRowClick(index, e.shiftKey)}
                    onChange={() => undefined}
                    onMouseDown={(e) => {
                      if (e.shiftKey) e.preventDefault();
                    }}
                    className="h-4 w-4 accent-[#facc15]"
                    aria-label={`Select ${item.title}`}
                    title={SHIFT_RANGE_HINT}
                  />
                </td>
                <td
                  className="p-3 font-semibold text-white"
                  title={item.path ?? undefined}
                >
                  {item.kind === 'episode' && item.showTitle ? (
                    <>
                      {item.showTitle}
                      <span className="text-white/40">
                        {' '}
                        {item.seasonNumber !== null && item.episodeNumber !== null
                          ? `S${String(item.seasonNumber).padStart(2, '0')}E${String(item.episodeNumber).padStart(2, '0')} · `
                          : '· '}
                      </span>
                      <span className="text-white/70">{item.title}</span>
                    </>
                  ) : (
                    item.title
                  )}
                </td>
                <td className="p-3 text-white/60">{item.kind}</td>
                <td className="p-3 text-right font-mono text-white/80">
                  {fmtBytes(item.sizeBytes)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}


// ---------------------------------------------------------------------------

