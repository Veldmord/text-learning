// Состояние пользователя (IndexedDB) — типы записей и правила обновления карточки после оценки.
// Хранилище (storage/*) только сохраняет эти записи; вычисления — здесь. Раздел 8.2.
import type { ModeId } from './modes';
import { emptyFsrs, schedule, type FsrsState, type Grade3 } from './srs';
import type { Line, LineId } from './types';

export interface CardRow extends FsrsState {
  lineId: LineId;
  textHash: string;
  /** Индекс в VANISH_LEVELS: 0 → 25 %, 3 → 100 % */
  vanishLevel: number;
  /** «Знал» подряд в режиме «Исчезающий текст» */
  vanishStreak: number;
  /** Последняя оценка в режимах со свободным вспоминанием */
  lastGrade: Grade3 | null;
  updatedAt: number;
}

export interface ReviewRow {
  id?: number;
  lineId: LineId;
  mode: ModeId;
  rating: Grade3;
  hinted: boolean;
  /** Оценка обновила расписание FSRS */
  fsrs: boolean;
  ts: number;
  durationMs: number;
  /** Состояние карточки до оценки — для отмены через «Назад» */
  prevCard: CardRow | null;
  /** Уточнение для режимов с частями: номер части монолога, id головоломки */
  detail?: string;
}

export interface NoteRow {
  lineId: LineId;
  text: string;
  updatedAt: number;
  /** Текст реплики изменился после написания заметки */
  stale?: boolean;
}

export interface CursorRow {
  /** roles:mode:scope */
  key: string;
  itemId: string;
  updatedAt: number;
}

export interface SceneReadRow {
  sceneId: string;
  readAt: number;
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

export function newCard(line: Pick<Line, 'id' | 'textHash'>, now: number): CardRow {
  return { lineId: line.id, textHash: line.textHash, ...emptyFsrs(now), vanishLevel: 0, vanishStreak: 0, lastGrade: null, updatedAt: now };
}

export const fsrsOf = (c: CardRow): FsrsState => ({
  due: c.due,
  stability: c.stability,
  difficulty: c.difficulty,
  elapsedDays: c.elapsedDays,
  scheduledDays: c.scheduledDays,
  learningSteps: c.learningSteps,
  reps: c.reps,
  lapses: c.lapses,
  state: c.state,
  lastReview: c.lastReview,
});

/** Уровень исчезания растёт после двух «Знал» подряд и падает после «Не знал». */
export function nextVanish(level: number, streak: number, rating: Grade3): { level: number; streak: number } {
  if (rating === 'again') return { level: Math.max(0, level - 1), streak: 0 };
  if (rating === 'hard') return { level, streak: 0 };
  return streak + 1 >= 2 ? { level: Math.min(3, level + 1), streak: 0 } : { level, streak: streak + 1 };
}

export interface ApplyGradeArgs {
  line: Pick<Line, 'id' | 'textHash'>;
  mode: ModeId;
  affectsFsrs: boolean;
  rating: Grade3;
  now: number;
  premiere?: string | null;
}

export function applyGrade(prev: CardRow | undefined, a: ApplyGradeArgs): CardRow {
  const base = prev ?? newCard(a.line, a.now);
  let next: CardRow = { ...base, textHash: a.line.textHash, updatedAt: a.now };
  if (a.affectsFsrs) {
    const prevFsrs = prev && prev.reps > 0 ? fsrsOf(prev) : null;
    next = { ...next, ...schedule(prevFsrs, a.rating, { now: a.now, premiere: a.premiere ?? null }), lastGrade: a.rating };
  }
  if (a.mode === 'vanish') {
    const v = nextVanish(base.vanishLevel, base.vanishStreak, a.rating);
    next = { ...next, vanishLevel: v.level, vanishStreak: v.streak };
  }
  return next;
}
