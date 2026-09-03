import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Download, Share, SquarePlus, X } from 'lucide-react';

import {
  clearDeferredInstallPrompt,
  getDeferredInstallPrompt,
  isAndroid,
  isInstallPromptEligible,
  isIosSafari,
  markInstallPromptDismissed,
  markInstallPromptInstalled,
  onDeferredInstallPromptChange,
} from '@/lib/install-prompt';

type Variant = 'android' | 'ios';

// Give the page a moment to settle before suggesting anything — the very
// first thing a mobile visitor sees should be the app, not a pitch for it.
const SHOW_DELAY_MS = 4000;

function computeVariant(): Variant | null {
  if (!isInstallPromptEligible()) return null;
  if (isAndroid() && getDeferredInstallPrompt()) return 'android';
  if (isIosSafari()) return 'ios';
  return null;
}

export function InstallAppBanner() {
  const [variant, setVariant] = useState<Variant | null>(computeVariant);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Chrome can fire beforeinstallprompt after mount (it waits on its own
    // engagement heuristics), so keep listening rather than checking once.
    return onDeferredInstallPromptChange(() => {
      setVariant(computeVariant());
    });
  }, []);

  useEffect(() => {
    if (!variant) return;
    const timer = window.setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [variant]);

  const handleDismiss = useCallback(() => {
    markInstallPromptDismissed();
    setVisible(false);
    setVariant(null);
  }, []);

  const handleInstall = useCallback(() => {
    const prompt = getDeferredInstallPrompt();
    if (!prompt) return;
    setVisible(false);
    void prompt
      .prompt()
      .then(() => prompt.userChoice)
      .then((choice) => {
        if (choice.outcome === 'accepted') {
          markInstallPromptInstalled();
        } else {
          markInstallPromptDismissed();
        }
      })
      .finally(() => {
        clearDeferredInstallPrompt();
        setVariant(null);
      });
  }, []);

  return (
    <AnimatePresence>
      {visible && variant ? (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          role="status"
          className="fixed bottom-28 left-4 right-4 z-[900] lg:hidden"
        >
          <div className="mx-auto flex max-w-md items-start gap-3 rounded-2xl border border-white/10 bg-[#0b0c0f]/90 p-4 shadow-2xl backdrop-blur-2xl">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#facc15]/15">
              {variant === 'android' ? (
                <Download className="h-4 w-4 text-[#facc15]" aria-hidden="true" />
              ) : (
                <Share className="h-4 w-4 text-[#facc15]" aria-hidden="true" />
              )}
            </div>

            <div className="min-w-0 flex-1">
              {variant === 'android' ? (
                <>
                  <p className="text-sm font-semibold text-white">Install Immaculaterr</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-white/60">
                    Add it to your home screen for quicker, full-screen access.
                  </p>
                  <div className="mt-2.5 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleInstall}
                      className="min-h-[32px] rounded-lg bg-[#facc15] px-3 py-1.5 text-xs font-bold text-black transition hover:bg-[#fde68a] active:scale-[0.98]"
                    >
                      Install
                    </button>
                    <button
                      type="button"
                      onClick={handleDismiss}
                      className="min-h-[32px] rounded-lg px-3 py-1.5 text-xs font-semibold text-white/55 transition hover:text-white/85"
                    >
                      Not now
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold text-white">Add to Home Screen</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-white/60">
                    Tap <Share className="inline h-3 w-3 -translate-y-px" aria-hidden="true" />{' '}
                    Share, then{' '}
                    <SquarePlus className="inline h-3 w-3 -translate-y-px" aria-hidden="true" />{' '}
                    &quot;Add to Home Screen&quot;.
                  </p>
                </>
              )}
            </div>

            <button
              type="button"
              onClick={handleDismiss}
              aria-label="Dismiss install suggestion"
              className="shrink-0 rounded-lg p-1 text-white/40 transition hover:bg-white/10 hover:text-white/80"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
