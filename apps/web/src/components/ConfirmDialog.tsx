import { AnimatePresence, motion } from 'motion/react';
import { CircleAlert, Loader2, X } from 'lucide-react';
import type { ReactNode } from 'react';

export type ConfirmDialogVariant = 'danger' | 'primary';

export function ConfirmDialog(props: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  label?: string;
  description?: ReactNode;
  confirmText: string;
  cancelText?: string;
  variant?: ConfirmDialogVariant;
  confirming?: boolean;
  error?: string | null;
  details?: ReactNode;
}) {
  const {
    open,
    onClose,
    onConfirm,
    title,
    label = 'Confirm',
    description,
    confirmText,
    cancelText = 'Cancel',
    variant = 'danger',
    confirming = false,
    error = null,
    details,
  } = props;

  const confirmClass =
    variant === 'primary'
      ? 'bg-[#facc15] text-black font-bold shadow-[0_0_20px_rgba(250,204,21,0.25)] hover:shadow-[0_0_28px_rgba(250,204,21,0.35)] hover:scale-[1.02]'
      : 'bg-red-500/90 text-white font-bold shadow-[0_0_20px_rgba(239,68,68,0.25)] hover:shadow-[0_0_28px_rgba(239,68,68,0.35)] hover:scale-[1.02]';

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[100000] flex items-center justify-center p-4 sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => {
            if (confirming) return;
            onClose();
          }}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 24, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 260, damping: 26 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full sm:max-w-lg rounded-[32px] bg-[#1a1625]/80 backdrop-blur-2xl border border-white/10 shadow-2xl shadow-purple-500/10 overflow-hidden"
          >
            <div className="p-6 sm:p-7">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-xs font-bold text-white/50 uppercase tracking-wider">
                    {label}
                  </div>
                  <h2 className="mt-2 text-2xl font-black tracking-tight text-white">
                    {title}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (confirming) return;
                    onClose();
                  }}
                  className="shrink-0 w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 transition active:scale-[0.98] flex items-center justify-center disabled:opacity-60 disabled:cursor-not-allowed"
                  aria-label="Close"
                  disabled={confirming}
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {description ? (
                <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
                  <div className="flex items-start gap-3">
                    <CircleAlert
                      className={`w-4 h-4 mt-0.5 shrink-0 ${
                        variant === 'primary' ? 'text-amber-200' : 'text-red-200'
                      }`}
                    />
                    <div className="min-w-0">{description}</div>
                  </div>
                </div>
              ) : null}

              {details ? <div className="mt-4">{details}</div> : null}

              {error ? (
                <div className="mt-4 flex items-start gap-2 text-sm text-red-200/90">
                  <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              ) : null}

              <div className="mt-6 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="h-12 rounded-full px-6 border border-white/15 bg-white/5 text-white/80 hover:bg-white/10 transition active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
                  disabled={confirming}
                >
                  {cancelText}
                </button>
                <button
                  type="button"
                  onClick={onConfirm}
                  className={[
                    'h-12 rounded-full px-6 transition active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed',
                    confirmClass,
                  ].join(' ')}
                  disabled={confirming}
                >
                  {confirming ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Working…
                    </>
                  ) : (
                    confirmText
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

