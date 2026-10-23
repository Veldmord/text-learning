// Аудиодвижок (раздел 10): один переиспользуемый HTMLAudioElement, очередь клипов сменой src,
// предзагрузка следующих клипов, паузы тишиной в фоне, фолбэк на speechSynthesis.
// Ничего не знает о режимах: получает очередь SpeechUnit от engine.
import type { SpeechUnit } from '../engine/audio-plan';
import type { AudioPort } from '../engine/session-runner';
import type { AudioManifest } from '../engine/types';
import { synthesisAvailable, TtsFallback, type VoiceSpec } from './tts-fallback';

export interface EngineConfig {
  baseUrl: string;
  manifest: () => AudioManifest | null;
  /** Скорость: общая × множитель персонажа */
  rateFor: (speakerId: string) => number;
  voiceFor: (speakerId: string) => VoiceSpec;
  onUnit?: (unit: SpeechUnit | null) => void;
  onError?: (e: unknown) => void;
}

type ClipResult = boolean | 'error';
type Active = 'clip' | 'tts' | 'silence' | null;

const PREFETCH_AHEAD = 3;
const BLOB_CACHE_LIMIT = 24;

function setPreservesPitch(el: HTMLAudioElement): void {
  const anyEl = el as unknown as Record<string, unknown>;
  anyEl.preservesPitch = true;
  anyEl.webkitPreservesPitch = true;
  anyEl.mozPreservesPitch = true;
}

export class AudioEngine implements AudioPort {
  private el: HTMLAudioElement | null = null;
  private generation = 0;
  private paused = false;
  private waiters: (() => void)[] = [];
  private active: Active = null;
  private abortActive: (() => void) | null = null;
  private pauseHook: (() => void) | null = null;
  private resumeHook: (() => void) | null = null;
  private readonly tts = new TtsFallback();
  private readonly blobs = new Map<string, { url: string | null }>();

  constructor(private readonly cfg: EngineConfig) {}

  private element(): HTMLAudioElement {
    if (!this.el) {
      this.el = new Audio();
      this.el.preload = 'auto';
    }
    return this.el;
  }

  private clipUrl(file: string): string {
    return `${this.cfg.baseUrl}audio/${file}`;
  }

  private silenceUrl(): string {
    return `${this.cfg.baseUrl}${this.cfg.manifest()?.silence ?? 'silence-1000.mp3'}`;
  }

  /** Вызывать внутри жеста пользователя: разблокирует звук на iOS (кнопка «Начать»). */
  unlock(): void {
    const el = this.element();
    el.src = this.silenceUrl();
    try {
      // play() вызывается синхронно внутри жеста — иначе iOS не разблокирует звук
      el.play()
        ?.then(() => el.pause())
        .catch(() => undefined);
    } catch {
      // Среда без воспроизведения (тесты) — звук останется на голосе браузера
    }
    if (synthesisAvailable()) {
      try {
        const u = new SpeechSynthesisUtterance('');
        u.volume = 0;
        window.speechSynthesis.speak(u);
      } catch {
        // Голос браузера недоступен — останутся клипы
      }
    }
  }

  async play(units: SpeechUnit[]): Promise<boolean> {
    const gen = ++this.generation;
    for (let i = 0; i < units.length; i++) {
      if (!(await this.waitIfPaused(gen))) return false;
      const u = units[i]!;
      this.prefetch(units.slice(i + 1, i + 1 + PREFETCH_AHEAD));
      this.cfg.onUnit?.(u);
      const ok = await this.playUnit(u, gen);
      if (!ok || gen !== this.generation) return false;
      if (i < units.length - 1 && u.pauseAfterMs > 0 && !(await this.gap(u.pauseAfterMs, gen))) return false;
    }
    this.cfg.onUnit?.(null);
    return gen === this.generation;
  }

  silence(ms: number): Promise<boolean> {
    const gen = ++this.generation;
    this.cfg.onUnit?.(null);
    return ms > 0 ? this.loopSilence(ms, gen) : Promise.resolve(true);
  }

  stop(): void {
    this.generation++;
    this.paused = false;
    this.abortActive?.();
    this.tts.cancel();
    this.el?.pause();
    const waiters = this.waiters;
    this.waiters = [];
    waiters.forEach((w) => w());
    this.cfg.onUnit?.(null);
  }

  pause(): void {
    this.paused = true;
    if (this.active === 'clip') this.el?.pause();
    else if (this.active === 'tts') this.tts.pause();
    else if (this.active === 'silence') this.pauseHook?.();
  }

  resume(): boolean {
    if (!this.paused) return this.active !== null;
    this.paused = false;
    const hadWaiters = this.waiters.length > 0;
    const waiters = this.waiters;
    this.waiters = [];
    waiters.forEach((w) => w());
    if (this.active === 'clip') {
      this.el?.play().catch(() => undefined);
      return true;
    }
    if (this.active === 'tts') return this.tts.resume() || hadWaiters;
    if (this.active === 'silence') {
      this.resumeHook?.();
      return true;
    }
    return hadWaiters;
  }

  private waitIfPaused(gen: number): Promise<boolean> {
    if (!this.paused) return Promise.resolve(gen === this.generation);
    return new Promise((resolve) => this.waiters.push(() => resolve(gen === this.generation)));
  }

  private async playUnit(u: SpeechUnit, gen: number): Promise<boolean> {
    const clip = this.cfg.manifest()?.clips[u.sentenceId];
    const rate = this.cfg.rateFor(u.speakerId);
    if (clip) {
      const r = await this.playClip(this.clipUrl(clip.f), rate);
      if (r !== 'error') return r;
      if (gen !== this.generation) return false;
      this.cfg.onError?.(new Error(`Клип ${clip.f} не воспроизвёлся, озвучка голосом браузера`));
    }
    this.active = 'tts';
    const ok = await this.tts.speak(u.text, this.cfg.voiceFor(u.speakerId), rate);
    this.active = null;
    return ok && gen === this.generation;
  }

  private playClip(url: string, rate: number): Promise<ClipResult> {
    const el = this.element();
    return new Promise<ClipResult>((resolve) => {
      let settled = false;
      const done = (v: ClipResult) => {
        if (settled) return;
        settled = true;
        el.onended = null;
        el.onerror = null;
        this.abortActive = null;
        this.active = null;
        resolve(v);
      };
      el.onended = () => done(true);
      el.onerror = () => done('error');
      this.abortActive = () => done(false);
      this.active = 'clip';
      el.loop = false;
      el.src = this.blobs.get(url)?.url ?? url;
      el.defaultPlaybackRate = rate;
      el.playbackRate = rate;
      setPreservesPitch(el);
      if (this.paused) return;
      el.play().catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        done('error');
      });
    });
  }

  /** Пауза между предложениями и репликами: таймер на экране, клип тишины в фоне — чтобы iOS не усыпил аудиосессию. */
  private gap(ms: number, gen: number): Promise<boolean> {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return this.loopSilence(ms, gen);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.abortActive = null;
        resolve(gen === this.generation);
      }, ms);
      this.abortActive = () => {
        clearTimeout(timer);
        resolve(false);
      };
    });
  }

  /** Тишина заданной длины: зацикленный silence-1000.mp3 держит аудиосессию и MediaSession активными. */
  private loopSilence(ms: number, gen: number): Promise<boolean> {
    const el = this.element();
    return new Promise<boolean>((resolve) => {
      let remaining = ms;
      let startedAt = Date.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let settled = false;
      const done = (v: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        el.ontimeupdate = null;
        el.onerror = null;
        el.loop = false;
        el.pause();
        this.abortActive = null;
        this.pauseHook = null;
        this.resumeHook = null;
        this.active = null;
        resolve(v && gen === this.generation);
      };
      const check = () => {
        if (!this.paused && Date.now() - startedAt >= remaining) done(true);
      };
      const arm = () => {
        startedAt = Date.now();
        clearTimeout(timer);
        timer = setTimeout(check, remaining + 20);
      };
      this.abortActive = () => done(false);
      this.pauseHook = () => {
        clearTimeout(timer);
        remaining = Math.max(0, remaining - (Date.now() - startedAt));
        el.pause();
      };
      this.resumeHook = () => {
        arm();
        el.play().catch(() => undefined);
      };
      this.active = 'silence';
      el.ontimeupdate = check;
      el.onerror = null;
      el.loop = true;
      el.src = this.silenceUrl();
      el.playbackRate = 1;
      if (!this.paused) {
        el.play().catch(() => undefined);
        arm();
      }
    });
  }

  private prefetch(units: SpeechUnit[]): void {
    const manifest = this.cfg.manifest();
    if (!manifest || typeof fetch === 'undefined') return;
    for (const u of units) {
      const clip = manifest.clips[u.sentenceId];
      if (!clip) continue;
      const url = this.clipUrl(clip.f);
      if (this.blobs.has(url)) continue;
      const entry: { url: string | null } = { url: null };
      this.blobs.set(url, entry);
      fetch(url)
        .then((r) => (r.ok ? r.blob() : null))
        .then((b) => {
          if (b) entry.url = URL.createObjectURL(b);
        })
        .catch(() => this.blobs.delete(url));
      while (this.blobs.size > BLOB_CACHE_LIMIT) {
        const [oldest, old] = this.blobs.entries().next().value as [string, { url: string | null }];
        if (old.url && this.el?.src !== old.url) URL.revokeObjectURL(old.url);
        this.blobs.delete(oldest);
      }
    }
  }
}
