// Регистрация Service Worker с подтверждением обновления (раздел 11.4):
// новая версия не активируется сама — приложение показывает «Доступна новая версия — обновить».
import { registerSW } from 'virtual:pwa-register';
import { reportError } from './errors';
import { useApp } from './store';

const HOUR = 60 * 60 * 1000;

export function setupServiceWorker(): void {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  const updateSW = registerSW({
    onNeedRefresh() {
      useApp.getState().setUpdate(() => void updateSW(true));
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      // Проверяем обновления раз в час и при возвращении на вкладку
      setInterval(() => void registration.update().catch(() => undefined), HOUR);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void registration.update().catch(() => undefined);
      });
    },
    onRegisterError(e: unknown) {
      reportError(e, 'sw');
    },
  });
}
