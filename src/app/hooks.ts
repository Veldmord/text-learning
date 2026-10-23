// Хуки: живые запросы к IndexedDB, Wake Lock, свайпы, горячие клавиши.
import { liveQuery } from 'dexie';
import { useEffect, useRef, useState, type DependencyList, type PointerEvent } from 'react';
import { reportError } from './services';

/** Перезапрашивает данные при любом изменении затронутых таблиц IndexedDB. */
export function useLiveQuery<T>(query: () => Promise<T>, deps: DependencyList, initial: T): T {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    const sub = liveQuery(query).subscribe({
      next: setValue,
      error: (e: unknown) => reportError(e, 'db'),
    });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}

/** Экран не гаснет, пока идёт сессия (Screen Wake Lock API, если доступен). */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        if (document.visibilityState === 'visible') lock = await navigator.wakeLock.request('screen');
        if (cancelled) await lock?.release();
      } catch {
        // Отказ браузера (энергосбережение) — работаем без блокировки
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void acquire();
    };
    void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => undefined);
    };
  }, [active]);
}

/** Свайп влево — «Далее», вправо — «Назад». */
export function useSwipe(onLeft: () => void, onRight: () => void, enabled = true) {
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  const handlers = useRef({ onLeft, onRight });
  handlers.current = { onLeft, onRight };
  return {
    onPointerDown: (e: PointerEvent) => {
      if (!enabled || e.pointerType === 'mouse') return;
      start.current = { x: e.clientX, y: e.clientY, t: Date.now() };
    },
    onPointerUp: (e: PointerEvent) => {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.5 || Date.now() - s.t > 800) return;
      if (dx < 0) handlers.current.onLeft();
      else handlers.current.onRight();
    },
    onPointerCancel: () => {
      start.current = null;
    },
  };
}

/** Горячие клавиши на десктопе; не срабатывают при вводе текста. */
export function useHotkeys(map: Record<string, () => void>, enabled = true): void {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (t instanceof Element && t.closest('[role="dialog"]')) return;
      const key = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const fn = ref.current[key] ?? ref.current[e.code];
      if (fn) {
        e.preventDefault();
        fn();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

/** Однократно прокрутить к элементу по id после рендера. */
export function useScrollTo(id: string | null | undefined, ready: boolean): void {
  useEffect(() => {
    if (!id || !ready) return;
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    el.classList.add('item--target');
    const t = setTimeout(() => el.classList.remove('item--target'), 1700);
    return () => clearTimeout(t);
  }, [id, ready]);
}
