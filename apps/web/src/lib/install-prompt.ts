/**
 * Home-screen install suggestion, shared state between main.tsx (which must
 * attach the beforeinstallprompt listener before React mounts — a listener
 * added later never sees an event that already fired) and InstallAppBanner
 * (which reads the captured event lazily).
 */

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notifyListeners(): void {
  listeners.forEach((listener) => listener());
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    notifyListeners();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    markInstallPromptInstalled();
    notifyListeners();
  });
}

export function getDeferredInstallPrompt(): BeforeInstallPromptEvent | null {
  return deferredPrompt;
}

export function clearDeferredInstallPrompt(): void {
  deferredPrompt = null;
}

/** Returns an unsubscribe function. Fires when the captured prompt changes. */
export function onDeferredInstallPromptChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isStandaloneDisplayMode(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  // iOS Safari has no display-mode media query for this; it exposes a
  // nonstandard flag on navigator instead once launched from the home screen.
  return (window.navigator as { standalone?: boolean }).standalone === true;
}

export function isAndroid(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /android/i.test(navigator.userAgent);
}

export function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  // iPadOS 13+ reports as "MacIntel" with touch support, not "iPad".
  const isIos =
    /iphone|ipad|ipod/i.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!isIos) return false;
  // Other iOS browsers (Chrome/Firefox/Edge) all run on WebKit but tag their
  // own UA token. Their "Add to Home Screen" only creates a bookmark that
  // reopens in that browser — only Safari's produces a true standalone PWA
  // honoring the manifest, so only Safari gets the suggestion.
  return !/crios|fxios|edgios|opios/i.test(ua);
}

const STORAGE_KEY = 'tcp.installPrompt.v1';
const DISMISS_COOLDOWN_MS = 21 * 24 * 60 * 60 * 1000; // ~3 weeks

type InstallPromptState = {
  dismissedAt: number | null;
  installed: boolean;
};

function readInstallPromptState(): InstallPromptState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { dismissedAt: null, installed: false };
    const parsed = JSON.parse(raw) as Partial<InstallPromptState>;
    return {
      dismissedAt: typeof parsed.dismissedAt === 'number' ? parsed.dismissedAt : null,
      installed: parsed.installed === true,
    };
  } catch {
    return { dismissedAt: null, installed: false };
  }
}

function writeInstallPromptState(state: InstallPromptState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Best-effort: private browsing / a full storage quota shouldn't crash the app.
  }
}

export function markInstallPromptDismissed(): void {
  writeInstallPromptState({ ...readInstallPromptState(), dismissedAt: Date.now() });
}

export function markInstallPromptInstalled(): void {
  writeInstallPromptState({ dismissedAt: null, installed: true });
}

/** Gates on "has this user opted out recently / already installed" — callers
 * still need to check platform (isAndroid + a captured prompt, or isIosSafari). */
export function isInstallPromptEligible(): boolean {
  if (isStandaloneDisplayMode()) return false;
  const state = readInstallPromptState();
  if (state.installed) return false;
  return (
    state.dismissedAt === null || Date.now() - state.dismissedAt >= DISMISS_COOLDOWN_MS
  );
}
