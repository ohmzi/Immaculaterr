import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { SetupWizard } from '@/app/SetupWizard';

export function SetupWizardModal(params: {
  open: boolean;
  required: boolean;
  onClose: () => void;
  onFinished: () => void;
}) {
  const { open, required, onClose, onFinished } = params;
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="relative max-h-[92vh] w-full max-w-5xl overflow-auto rounded-xl border bg-background shadow-lg">
        {!required ? (
          <div className="sticky top-0 z-10 flex items-center justify-end border-b bg-background/80 px-3 py-2 backdrop-blur">
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close setup">
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : null}

        <div className="p-4 sm:p-6">
          <SetupWizard onFinish={onFinished} />
        </div>

        {required ? (
          <div className="sticky bottom-0 border-t bg-background/80 p-3 text-xs text-muted-foreground backdrop-blur">
            Setup is required before running jobs. Your API keys are saved encrypted and never shown
            again.
          </div>
        ) : null}
      </div>
    </div>
  );
}


