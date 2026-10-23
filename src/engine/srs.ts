// Адаптер ts-fsrs: сериализуемое состояние карточки, маппинг оценок, ограничение по дате премьеры.
// Правила — docs/ARCHITECTURE.md, раздел 5.1.
import { createEmptyCard, fsrs, Rating, State, type Card, type Grade } from 'ts-fsrs';

export type Grade3 = 'again' | 'hard' | 'good';

/** «Знал» → Good, «С ошибкой» → Hard, «Не знал» → Again */
export const GRADE_TO_RATING: Record<Grade3, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
};

export const GRADE_LABEL: Record<Grade3, string> = {
  again: 'Не знал',
  hard: 'С ошибкой',
  good: 'Знал',
};

/** Порог выученности: прогноз вспоминания на сегодня ≥ 0,9 */
export const RECALL_TARGET = 0.9;

export interface FsrsState {
  due: number;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  /** 0 New, 1 Learning, 2 Review, 3 Relearning */
  state: number;
  lastReview: number | null;
}

const DAY = 86_400_000;

export function emptyFsrs(now: number): FsrsState {
  return fromCard(createEmptyCard(new Date(now)));
}

export function toCard(s: FsrsState): Card {
  return {
    due: new Date(s.due),
    stability: s.stability,
    difficulty: s.difficulty,
    elapsed_days: s.elapsedDays,
    scheduled_days: s.scheduledDays,
    learning_steps: s.learningSteps,
    reps: s.reps,
    lapses: s.lapses,
    state: s.state as State,
    ...(s.lastReview !== null ? { last_review: new Date(s.lastReview) } : {}),
  };
}

export function fromCard(c: Card): FsrsState {
  return {
    due: c.due.getTime(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsedDays: c.elapsed_days,
    scheduledDays: c.scheduled_days,
    learningSteps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state,
    lastReview: c.last_review ? c.last_review.getTime() : null,
  };
}

/** Парсит дату премьеры YYYY-MM-DD как локальную полночь. */
export function parseDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}

/** Максимальный интервал: до дня перед премьерой, если она в будущем. */
export function maxIntervalDays(now: number, premiere: string | null | undefined): number {
  const p = parseDate(premiere);
  if (p === null || p <= now) return 36_500;
  return Math.max(1, Math.floor((p - now) / DAY) - 1);
}

export interface ScheduleOptions {
  now: number;
  premiere?: string | null;
}

export function schedule(prev: FsrsState | null | undefined, grade: Grade3, opts: ScheduleOptions): FsrsState {
  const scheduler = fsrs({ maximum_interval: maxIntervalDays(opts.now, opts.premiere), enable_fuzz: false });
  const card = prev ? toCard(prev) : createEmptyCard(new Date(opts.now));
  const next = scheduler.next(card, new Date(opts.now), GRADE_TO_RATING[grade]).card;
  const premiere = parseDate(opts.premiere);
  // Короткие шаги обучения могут уйти за премьеру — срок повторения не позже её начала.
  if (premiere !== null && premiere > opts.now && next.due.getTime() > premiere) next.due = new Date(premiere);
  return fromCard(next);
}

const reader = fsrs();

export function retrievability(s: FsrsState | null | undefined, now: number): number {
  if (!s || s.state === State.New || s.lastReview === null) return 0;
  return reader.get_retrievability(toCard(s), new Date(now), false);
}

export const isLearned = (s: FsrsState | null | undefined, now: number) => retrievability(s, now) >= RECALL_TARGET;

export const isDue = (s: FsrsState | null | undefined, now: number) => !!s && s.state !== State.New && s.due <= now;

/** «Слабая» реплика: срок повторения подошёл или прогноз вспоминания ниже порога. */
export const isWeak = (s: FsrsState | null | undefined, now: number) =>
  !!s && s.state !== State.New && (s.due <= now || retrievability(s, now) < RECALL_TARGET);

/** После «Суфлёра» максимальная оценка — «С ошибкой». */
export const capGrade = (grade: Grade3, hinted: boolean): Grade3 => (hinted && grade === 'good' ? 'hard' : grade);
