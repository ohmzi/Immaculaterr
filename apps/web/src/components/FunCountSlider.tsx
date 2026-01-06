import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export function FunCountSlider(props: {
  value: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  onValueChange: (value: number) => void;
  onValueCommit: (value: number) => void;
  'aria-label'?: string;
}) {
  const {
    value,
    min = 0,
    max = 100,
    disabled = false,
    onValueChange,
    onValueCommit,
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const lastValueRef = useRef<number>(value);

  useEffect(() => {
    lastValueRef.current = value;
  }, [value]);

  const minV = Number.isFinite(min) ? Math.trunc(min) : 0;
  const maxV = Number.isFinite(max) ? Math.trunc(max) : 100;
  const lo = Math.min(minV, maxV);
  const hi = Math.max(minV, maxV);

  const clamp = (n: number) => {
    if (!Number.isFinite(n)) return lo;
    return Math.max(lo, Math.min(hi, Math.trunc(n)));
  };

  const v = clamp(value);
  const range = Math.max(1, hi - lo);
  const pct = ((v - lo) / range) * 100;
  const pctClamped = Math.max(0, Math.min(100, pct));
  const showFill = pctClamped > 0;
  const showSeparator = pctClamped > 0 && pctClamped < 100;

  const handleMove = (clientX: number) => {
    if (disabled) return;
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left;
    const p = rect.width > 0 ? x / rect.width : 0;
    const next = lo + Math.round(Math.max(0, Math.min(1, p)) * range);
    onValueChange(clamp(next));
  };

  const endDrag = () => {
    setIsDragging(false);
    onValueCommit(lastValueRef.current);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
    handleMove(e.clientX);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    handleMove(e.clientX);
  };

  const onPointerUp = () => {
    if (!isDragging) return;
    endDrag();
  };

  const onPointerCancel = () => {
    if (!isDragging) return;
    endDrag();
  };

  return (
    <div
      ref={containerRef}
      role="slider"
      aria-label={props['aria-label'] ?? 'Recommendation count'}
      aria-valuemin={lo}
      aria-valuemax={hi}
      aria-valuenow={v}
      aria-disabled={disabled ? 'true' : 'false'}
      tabIndex={disabled ? -1 : 0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      className={cn(
        'relative h-16 w-full rounded-2xl bg-[#0F0B15] overflow-visible border border-white/10 group select-none touch-none shadow-inner',
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
      )}
    >
      {/* Track internals (clipped to rounded corners) */}
      <div className="absolute inset-0 rounded-2xl overflow-hidden">
        {/* Filled bar */}
        {showFill ? (
          <div
            className="absolute top-0 left-0 h-full overflow-hidden shadow-[4px_0_24px_rgba(0,0,0,0.5)] z-10"
            style={{
              width: `${pctClamped}%`,
              transition: isDragging
                ? 'none'
                : 'width 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
            }}
          >
            <div className="absolute inset-0 bg-gradient-to-r from-[#2a1a00] via-[#facc15] to-[#fde68a]" />
            <div className="absolute inset-0 opacity-35 mix-blend-overlay bg-[url('https://grainy-gradients.vercel.app/noise.svg')]" />
            <div
              className="absolute inset-0 opacity-25"
              style={{
                backgroundImage:
                  'radial-gradient(circle, rgba(255,255,255,0.35) 1px, transparent 1px)',
                backgroundSize: '16px 16px',
              }}
            />
            <div className="absolute inset-0 bg-gradient-to-b from-white/15 to-transparent" />
          </div>
        ) : null}

        {/* Separator line (hide at edges to avoid the half-pixel \"outside\" artifact) */}
        {showSeparator ? (
          <div
            className="absolute top-0 bottom-0 w-px bg-white/20 z-10"
            style={{
              left: `${pctClamped}%`,
              transform: 'translateX(-50%)',
              transition: isDragging
                ? 'none'
                : 'left 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
            }}
          />
        ) : null}
      </div>

      {/* 3D Floating knob */}
      <div
        className="absolute top-1/2 -translate-y-1/2 z-30 pointer-events-none"
        style={{
          left: `${pctClamped}%`,
          transform: 'translate(-50%, -50%)',
          transition: isDragging
            ? 'none'
            : 'left 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
      >
        <div
          className={cn(
            'relative bg-black/65 backdrop-blur-2xl backdrop-saturate-200 rounded-xl flex flex-col items-center justify-center transition-all duration-200 ease-out border border-white/10',
            isDragging
              ? 'w-14 h-14 shadow-[0_15px_30px_rgba(0,0,0,0.5),0_0_0_1px_rgba(255,255,255,0.1)] scale-110 -translate-y-2'
              : 'w-12 h-12 shadow-[0_8px_20px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.1)] scale-100',
          )}
        >
          <div className="flex flex-col items-center z-10">
            <span className="text-xl font-black text-[#facc15] leading-none tracking-tighter drop-shadow-md">
              {v}
            </span>
          </div>
        </div>
      </div>

      {/* End caps (subtle) */}
      <div className="absolute inset-0 rounded-2xl pointer-events-none ring-1 ring-white/5" />
    </div>
  );
}

