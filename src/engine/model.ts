// Состояние пользователя (IndexedDB) — типы записей. Хранилище (storage/*) только сохраняет их; вычисления — в engine. Раздел 8.2.
import type { ModeId } from './modes';
import type { LineId } from './types';

/** Журнал одной тренировки: одна запись на сессию и режим, обновляется при каждом уходе с шага. */
export interface SessionRow {
  /** Случайный id: записи с разных устройств сливаются из резервной копии без конфликтов */
  id: string;
  /** Роли через запятую, по алфавиту */
  rolesKey: string;
  mode: ModeId;
  startedAt: number;
  updatedAt: number;
  /** Активное время: на одном шаге не больше STEP_TIME_CAP_MS */
  activeMs: number;
  /** Сколько своих реплик дошло до очереди актёра */
  lines: number;
  /** Сцены, пройденные целиком: все свои реплики сцены встретились, и актёр прошёл сцену до конца */
  scenes: string[];
}

/** Реплика в избранном. Снятие из избранного хранится как on: false, чтобы пережить слияние резервных копий. */
export interface FavoriteRow {
  lineId: LineId;
  on: boolean;
  updatedAt: number;
}

export interface CursorRow {
  /** roles:mode:scope */
  key: string;
  itemId: string;
  updatedAt: number;
}

export interface MetaRow {
  key: string;
  value: unknown;
}

export interface ErrorRow {
  id?: number;
  ts: number;
  source: string;
  message: string;
  stack?: string;
}

export const cursorKey = (rolesKey: string, mode: ModeId, scope: string) => `${rolesKey}:${mode}:${scope}`;
