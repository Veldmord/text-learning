// Настройки в localStorage: читаются синхронно до первого рендера, чтобы тема не мигала (раздел 8.2).
// public/theme-init.js читает те же ключи `theme` и `fontSize` до загрузки бандла.
import type { CueLength, DirectionsMode } from '../engine/audio-plan';

export const SETTINGS_KEY = 'tl.settings';

export type Theme = 'system' | 'light' | 'dark';

export interface Settings {
  theme: Theme;
  /** 0–3: четыре ступени размера шрифта */
  fontSize: number;
  /** Ремарки: пропускать / показывать текстом / читать голосом рассказчика */
  directions: DirectionsMode;
  /** Общая скорость озвучки 0,75–2,0 */
  speed: number;
  /** Множитель скорости по персонажу */
  characterRate: Record<string, number>;
  cueLength: CueLength;
  cueWords: number;
  context: number;
  autoAdvance: boolean;
  pauseMs: number;
  echo: boolean;
  skipScenesWithoutRole: boolean;
  audioRunK: number;
  /** Дата премьеры YYYY-MM-DD: интервалы FSRS ограничиваются ею */
  premiere: string | null;
  lastRoles: string | null;
  lastBackupAt: number | null;
  updatedAt: number;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  fontSize: 1,
  directions: 'text',
  speed: 1.25,
  characterRate: {},
  cueLength: 'lastSentence',
  cueWords: 10,
  context: 1,
  autoAdvance: true,
  pauseMs: 300,
  echo: false,
  skipScenesWithoutRole: true,
  audioRunK: 1.2,
  premiere: null,
  lastRoles: null,
  lastBackupAt: null,
  updatedAt: 0,
};

const clamp = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const oneOf = <T extends string>(v: unknown, values: readonly T[], fallback: T): T =>
  values.includes(v as T) ? (v as T) : fallback;
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);

/** Приводит произвольный объект (из localStorage или бэкапа) к корректным настройкам. */
export function sanitizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Settings, unknown>>;
  const d = DEFAULT_SETTINGS;
  const rates: Record<string, number> = {};
  if (r.characterRate && typeof r.characterRate === 'object') {
    for (const [k, v] of Object.entries(r.characterRate as Record<string, unknown>)) rates[k] = clamp(v, 0.5, 1.5, 1);
  }
  return {
    theme: oneOf(r.theme, ['system', 'light', 'dark'] as const, d.theme),
    fontSize: Math.round(clamp(r.fontSize, 0, 3, d.fontSize)),
    directions: oneOf(r.directions, ['skip', 'text', 'voice'] as const, d.directions),
    speed: Math.round(clamp(r.speed, 0.75, 2, d.speed) * 4) / 4,
    characterRate: rates,
    cueLength: oneOf(r.cueLength, ['full', 'lastSentence', 'lastWords', 'textOnly'] as const, d.cueLength),
    cueWords: Math.round(clamp(r.cueWords, 5, 20, d.cueWords)),
    context: Math.round(clamp(r.context, 0, 5, d.context)),
    autoAdvance: bool(r.autoAdvance, d.autoAdvance),
    pauseMs: Math.round(clamp(r.pauseMs, 0, 1000, d.pauseMs)),
    echo: bool(r.echo, d.echo),
    skipScenesWithoutRole: bool(r.skipScenesWithoutRole, d.skipScenesWithoutRole),
    audioRunK: Math.round(clamp(r.audioRunK, 0.8, 2, d.audioRunK) * 10) / 10,
    premiere: typeof r.premiere === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.premiere) ? r.premiere : null,
    lastRoles: typeof r.lastRoles === 'string' && r.lastRoles ? r.lastRoles : null,
    lastBackupAt: typeof r.lastBackupAt === 'number' ? r.lastBackupAt : null,
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : 0,
  };
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadSettings(): Settings {
  try {
    const raw = storage()?.getItem(SETTINGS_KEY);
    return sanitizeSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    storage()?.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // Приватный режим или переполнение — настройки живут до перезагрузки
  }
}
