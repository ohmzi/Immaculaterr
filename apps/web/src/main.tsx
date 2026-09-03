import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import './index.css';
import App from './App.tsx';
import { applyTheme } from '@/app/theme';
import { Toaster } from '@/components/ui/sonner';
// Side-effect import: attaches the beforeinstallprompt listener immediately,
// before React mounts. A listener added later can miss an event that fires
// during initial load. See InstallAppBanner for the consumer.
import '@/lib/install-prompt';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

// The app is designed dark-only (every surface is colour-themed); apply it
// before first paint regardless of any previously stored preference.
applyTheme('dark');

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root was not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* Respect the OS reduced-motion preference for all motion/react animations. */}
      <MotionConfig reducedMotion="user">
        <App />
      </MotionConfig>
      <Toaster />
    </QueryClientProvider>
  </StrictMode>,
)
