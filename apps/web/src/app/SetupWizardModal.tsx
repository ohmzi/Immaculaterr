import { motion } from 'motion/react';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { MultiStepWizard } from '@/app/MultiStepWizard';

export function SetupWizardModal(params: {
  open: boolean;
  required: boolean;
  onClose: () => void;
  onFinished: () => void;
}) {
  const { open, required, onClose, onFinished } = params;
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 backdrop-blur-sm sm:items-center sm:p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.98, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        className="relative max-h-[92dvh] w-full overflow-auto rounded-t-3xl rounded-b-none border border-white/10 bg-zinc-900/90 shadow-2xl backdrop-blur-xl sm:max-h-[92vh] sm:max-w-5xl sm:rounded-3xl"
      >
        {!required ? (
          <div className="sticky top-0 z-10 border-b border-white/10 bg-zinc-900/70 backdrop-blur">
            <div className="relative flex items-center justify-end px-3 py-2">
              {/* Mobile drag handle */}
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 sm:hidden">
                <div className="h-1 w-10 rounded-full bg-white/20" />
              </div>

              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                aria-label="Close setup"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : (
          // Mobile-only drag handle when setup is required (no close button)
          <div className="sticky top-0 z-10 border-b border-white/10 bg-zinc-900/70 backdrop-blur sm:hidden">
            <div className="flex items-center justify-center px-3 py-3">
              <div className="h-1 w-10 rounded-full bg-white/20" />
            </div>
          </div>
        )}

        <div className="p-4 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] sm:p-6 sm:pb-6">
          <MultiStepWizard key="wizard-instance" onFinish={onFinished} />
        </div>

        {required ? (
          <div className="sticky bottom-0 border-t border-white/10 bg-black/20 px-6 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] text-center text-xs text-zinc-400 backdrop-blur">
            Setup is required before running jobs. Your API keys are saved encrypted and never shown again.
          </div>
        ) : null}
      </motion.div>
    </div>
  );
}


