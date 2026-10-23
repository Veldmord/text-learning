import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { installGlobalErrorHandlers } from './app/errors';
import { applyDisplay, getSettings, useApp } from './app/store';
import { setupServiceWorker } from './app/sw';
import './app/styles.css';

applyDisplay(getSettings());
installGlobalErrorHandlers();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/** Выполнить после первой отрисовки: стартовый экран не ждёт ни текста пьесы, ни Service Worker (LCP, NFR-01). */
function afterFirstPaint(fn: () => void): void {
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    fn();
  };
  try {
    const po = new PerformanceObserver((list) => {
      if (list.getEntriesByName('first-contentful-paint').length) {
        po.disconnect();
        setTimeout(run, 0);
      }
    });
    po.observe({ type: 'paint', buffered: true });
  } catch {
    // Нет PerformanceObserver — сработает таймер
  }
  setTimeout(run, 500);
}

afterFirstPaint(() => {
  void useApp.getState().init();
  setupServiceWorker();
});
