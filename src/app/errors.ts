// Глобальные обработчики ошибок пишут кольцевой журнал в IndexedDB (раздел 13).
// Хранилище подгружается лениво, чтобы Dexie не попадал в стартовый бандл.

export function reportError(e: unknown, source = 'app'): void {
  const err = e instanceof Error ? e : new Error(typeof e === 'string' ? e : JSON.stringify(e));
  console.error(`[${source}]`, err);
  void Promise.all([import('../storage/db'), import('../storage/repo')])
    .then(([{ getDb }, { Repo }]) =>
      new Repo(getDb()).logError({ ts: Date.now(), source, message: err.message, ...(err.stack ? { stack: err.stack.slice(0, 2000) } : {}) }),
    )
    .catch(() => undefined);
}

export function installGlobalErrorHandlers(): void {
  window.addEventListener('error', (e) => reportError(e.error ?? e.message, 'window'));
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason, 'promise'));
}
