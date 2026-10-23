// Состояние UI в Zustand: настройки (localStorage) и загруженная пьеса. Сессия живёт в SessionRunner,
// стор лишь держит её снимок через useSyncExternalStore (раздел 7.2).
import { create } from 'zustand';
import type { SpeechUnit } from '../engine/audio-plan';
import { hydratePlay, type StoredPlay } from '../engine/play-format';
import { buildIndex, type PlayIndex } from '../engine/queries';
import type { AudioManifest } from '../engine/types';
import { loadManifest } from '../audio/prefetch';
import { loadSettings, saveSettings, type Settings } from '../storage/settings';
import playUrl from '../data/play.json?url';

export const BASE_URL = import.meta.env.BASE_URL;

// ---------------------------------------------------------------------------
// Настройки

export function applyDisplay(s: Pick<Settings, 'theme' | 'fontSize'>): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (s.theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', s.theme);
  root.setAttribute('data-font', String(s.fontSize));
}

interface SettingsStore extends Settings {
  update: (patch: Partial<Settings>) => void;
  replace: (s: Settings) => void;
}

const pickSettings = (s: SettingsStore): Settings => {
  const { update: _u, replace: _r, ...rest } = s;
  return rest;
};

export const useSettings = create<SettingsStore>()((set, get) => ({
  ...loadSettings(),
  update: (patch) => {
    const next = { ...pickSettings(get()), ...patch, updatedAt: Date.now() };
    saveSettings(next);
    applyDisplay(next);
    set(next);
  },
  replace: (s) => {
    saveSettings(s);
    applyDisplay(s);
    set(s);
  },
}));

export const getSettings = (): Settings => pickSettings(useSettings.getState());

// ---------------------------------------------------------------------------
// Пьеса и манифест озвучки

interface AppStore {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  index: PlayIndex | null;
  manifest: AudioManifest | null;
  /** Новая версия Service Worker ждёт активации */
  updateReady: boolean;
  applyUpdate: (() => void) | null;
  /** Идёт тренировка — обновление не предлагаем, чтобы не прервать сессию */
  sessionActive: boolean;
  init: () => Promise<void>;
  setUpdate: (apply: () => void) => void;
  setSessionActive: (v: boolean) => void;
}

export const useApp = create<AppStore>()((set, get) => ({
  status: 'idle',
  error: null,
  index: null,
  manifest: null,
  updateReady: false,
  applyUpdate: null,
  sessionActive: false,
  init: async () => {
    if (get().status === 'loading' || get().status === 'ready') return;
    set({ status: 'loading', error: null });
    try {
      const res = await fetch(playUrl);
      if (!res.ok) throw new Error(`Не удалось загрузить текст пьесы (${res.status})`);
      const play = hydratePlay((await res.json()) as StoredPlay);
      const index = buildIndex(play);
      set({ index, status: 'ready' });
      // Сверка прогресса с текстом не блокирует первый экран и не тянет FSRS в стартовый бандл
      void Promise.all([import('../storage/db'), import('../storage/reconcile')])
        .then(([{ getDb }, { reconcileWithPlay }]) => reconcileWithPlay(getDb(), play))
        .catch(() => undefined);
      const manifest = await loadManifest(BASE_URL);
      set({ manifest });
    } catch (e) {
      set({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  },
  setUpdate: (apply) => set({ updateReady: true, applyUpdate: apply }),
  setSessionActive: (v) => set({ sessionActive: v }),
}));

// ---------------------------------------------------------------------------
// Что сейчас звучит — для подсветки строки на экране

export const usePlayback = create<{ unit: SpeechUnit | null; set: (u: SpeechUnit | null) => void }>()((set) => ({
  unit: null,
  set: (unit) => set({ unit }),
}));
