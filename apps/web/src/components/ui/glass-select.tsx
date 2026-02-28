import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

import { cn } from '@/components/ui/utils';

export type GlassSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export function GlassSelect(props: {
  value: string;
  placeholder: string;
  options: GlassSelectOption[];
  onValueChange: (value: string) => void;
  triggerClassName?: string;
  contentClassName?: string;
}) {
  const { value, placeholder, options, onValueChange, triggerClassName, contentClassName } =
    props;

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(
    null,
  );

  const selectedLabel = useMemo(() => {
    const found = options.find((o) => o.value === value);
    return found?.label ?? '';
  }, [options, value]);

  const recomputePosition = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ left: r.left, top: r.bottom + 6, width: r.width });
  };

  useLayoutEffect(() => {
    if (!open) return;
    recomputePosition();
  }, [open, value]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (triggerRef.current?.contains(t)) return;
      if (contentRef.current?.contains(t)) return;
      setOpen(false);
    };

    const onScrollOrResize = () => {
      recomputePosition();
    };

    window.addEventListener('keydown', onKeyDown, { passive: false });
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('scroll', onScrollOrResize, true);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
    };
  }, [open]);

  const triggerText = selectedLabel || placeholder;
  const handleOptionClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      const { optionValue } = event.currentTarget.dataset;
      if (!optionValue) return;
      onValueChange(optionValue);
      setOpen(false);
    },
    [onValueChange],
  );
  const handleTriggerClick = useCallback(() => {
    setOpen((value) => !value);
  }, []);

  const triggerClasses = cn(
    // Matches our Radix Select trigger "glassy" style.
    'flex items-center justify-between gap-2 rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-sm text-white/90 shadow-[0_12px_32px_rgba(0,0,0,0.35)] backdrop-blur-2xl backdrop-saturate-150 transition',
    'focus:outline-none focus:ring-2 focus:ring-white/25 focus:ring-offset-0',
    open && 'bg-white/15',
    triggerClassName,
  );

  const contentNode = open && pos
    ? createPortal(
        <div className="fixed inset-0 z-[9999]">
          <div
            ref={contentRef}
            className={cn(
              // Matches our Radix Select content style.
              "absolute z-[10000] min-w-[8rem] overflow-hidden rounded-2xl border border-white/15 bg-[#0b0c0f]/85 text-white shadow-[0_22px_60px_rgba(0,0,0,0.45)] backdrop-blur-2xl backdrop-saturate-150 ring-1 ring-white/10",
              "before:pointer-events-none before:absolute before:inset-0 before:content-[''] before:bg-gradient-to-br before:from-white/10 before:via-transparent before:to-transparent before:opacity-70",
              contentClassName,
            )}
            style={{ left: pos.left, top: pos.top, minWidth: pos.width }}
            role="listbox"
            aria-label={placeholder}
          >
            <div className="max-h-[320px] overflow-auto p-1">
              {/* Placeholder row (disabled) */}
              <div className="px-2 py-1.5 text-xs font-semibold text-white/60">
                {placeholder}
              </div>

              {options.map((o) => {
                const isSelected = o.value === value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    disabled={o.disabled}
                    data-option-value={o.value}
                    onClick={handleOptionClick}
                    className={cn(
                      'relative flex w-full select-none items-center rounded-xl py-2 pl-8 pr-3 text-left text-sm outline-none transition',
                      'text-white/90 hover:bg-white/12 hover:text-white',
                      isSelected && 'bg-white/10 text-white',
                      o.disabled && 'pointer-events-none opacity-50',
                    )}
                  >
                    <span className="absolute left-2 flex h-4 w-4 items-center justify-center">
                      {isSelected ? <Check className="h-4 w-4 text-[#facc15]" /> : null}
                    </span>
                    <span className="truncate">{o.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClasses}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={handleTriggerClick}
      >
        <span className={cn('truncate', selectedLabel ? 'text-white/90' : 'text-white/60')}>
          {triggerText}
        </span>
        <ChevronDown className="h-4 w-4 text-white/70" />
      </button>
      {contentNode}
    </>
  );
}
