import { expect, type Page } from '@playwright/test';

/**
 * Голос браузера в headless-режиме может молчать бесконечно — подменяем speechSynthesis
 * мгновенным «проговариванием», чтобы сценарии шли с реальной скоростью интерфейса.
 */
export async function stubSpeech(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const spoken: string[] = [];
    (window as unknown as { __spoken: string[] }).__spoken = spoken;
    const synth = {
      speaking: false,
      pending: false,
      paused: false,
      getVoices: () => [],
      speak(u: SpeechSynthesisUtterance) {
        spoken.push(u.text);
        setTimeout(() => u.onend?.(new Event('end') as SpeechSynthesisEvent), 20);
      },
      cancel() {},
      pause() {},
      resume() {},
      addEventListener() {},
      removeEventListener() {},
    };
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
    // WebKit для Windows в Playwright не знает SpeechSynthesisUtterance
    if (!('SpeechSynthesisUtterance' in window)) {
      class Utterance extends EventTarget {
        text: string;
        lang = '';
        pitch = 1;
        rate = 1;
        volume = 1;
        voice: SpeechSynthesisVoice | null = null;
        onend: ((e: Event) => void) | null = null;
        onerror: ((e: Event) => void) | null = null;
        constructor(text = '') {
          super();
          this.text = text;
        }
      }
      Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: Utterance, configurable: true });
    }
  });
}

/** Позиция «где остановился» прямо из IndexedDB. */
export function readCursor(page: Page, key: string): Promise<string | null> {
  return page.evaluate(
    (k) =>
      new Promise<string | null>((resolve) => {
        const open = indexedDB.open('text-learning');
        open.onerror = () => resolve(null);
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction('cursors').objectStore('cursors').get(k);
          req.onsuccess = () => {
            resolve((req.result as { itemId?: string } | undefined)?.itemId ?? null);
            db.close();
          };
          req.onerror = () => resolve(null);
        };
      }),
    key,
  );
}

/** Выбрать роль на стартовом экране и открыть обзор. Баннер установки на iOS появляется через секунду
 * и сдвигает разметку — клик повторяется, пока обзор не откроется. */
export async function chooseRole(page: Page, name: string): Promise<void> {
  await page.goto('./');
  await page.getByRole('checkbox', { name: new RegExp(name) }).check();
  const overview = page.getByRole('heading', { level: 1, name: new RegExp(name) });
  await expect(async () => {
    if (!(await overview.isVisible())) await page.getByRole('button', { name: /^Учить:/ }).click({ timeout: 2000 });
    await expect(overview).toBeVisible({ timeout: 2000 });
  }).toPass();
}

/** Ждём, пока Service Worker возьмёт страницу под контроль и precache заполнится: бандл, стили и play.json.
 * waitForFunction не ждёт промисы, поэтому опрашиваем через page.evaluate. */
export async function waitForServiceWorker(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const reg = await navigator.serviceWorker.getRegistration();
          if (reg?.active?.state !== 'activated' || !navigator.serviceWorker.controller) return false;
          const urls = [...document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>('script[src], link[rel=stylesheet]')].map((e) =>
            'src' in e ? e.src : e.href,
          );
          const matched = await Promise.all(urls.map((u) => caches.match(u, { ignoreSearch: true })));
          const keys = await Promise.all((await caches.keys()).map(async (k) => (await caches.open(k)).keys()));
          const hasPlay = keys.flat().some((r) => /play-[^/]+[.]json$/.test(r.url));
          return matched.every(Boolean) && hasPlay;
        }),
      { timeout: 20_000 },
    )
    .toBe(true);
}
