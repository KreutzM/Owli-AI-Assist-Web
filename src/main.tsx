import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { App } from '@/app/App';
import { AppErrorBoundary } from '@/app/AppErrorBoundary';

registerSW({ immediate: true });

const root = document.getElementById('root');
if (!root) throw new Error('Root element is missing.');

createRoot(root).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
