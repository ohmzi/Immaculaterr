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
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="relative max-h-[92dvh] w-full overflow-auto rounded-t-2xl rounded-b-none border bg-background shadow-lg sm:max-h-[92vh] sm:max-w-5xl sm:rounded-xl">
        {!required ? (
          <div className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
            <div className="relative flex items-center justify-end px-3 py-2">
              {/* Mobile drag handle */}
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 sm:hidden">
                <div className="h-1 w-10 rounded-full bg-muted-foreground/25" />
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
          <div className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur sm:hidden">
            <div className="flex items-center justify-center px-3 py-3">
              <div className="h-1 w-10 rounded-full bg-muted-foreground/25" />
            </div>
          </div>
        )}

        <div className="p-4 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] sm:p-6 sm:pb-6">
          <MultiStepWizard key="wizard-instance" onFinish={onFinished} />
        </div>

        {required ? (
          <div className="sticky bottom-0 border-t bg-background/80 p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] text-xs text-muted-foreground backdrop-blur">
            Setup is required before running jobs. Your API keys are saved encrypted and never shown
            again.
          </div>
        ) : null}
      </div>
    </div>
  );
}


