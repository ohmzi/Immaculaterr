import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import './index.css';
import App from './App.tsx';
import { applyTheme, getInitialTheme } from '@/app/theme';
import { Toaster } from '@/components/ui/sonner';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

// Apply theme before first paint.
applyTheme(getInitialTheme());

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
