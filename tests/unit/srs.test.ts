import { describe, expect, it } from 'vitest';
import { applyGrade, newCard, nextVanish } from '../../src/engine/model';
import {
  capGrade,
  emptyFsrs,
  fromCard,
  GRADE_TO_RATING,
  isDue,
  isLearned,
  isWeak,
  maxIntervalDays,
  parseDate,
  retrievability,
  schedule,
  toCard,
} from '../../src/engine/srs';

const DAY = 86_400_000;
const T0 = new Date(2026, 10, 1, 10, 0).getTime();

describe('FSRS-адаптер', () => {
  it('маппинг оценок: Знал → Good, С ошибкой → Hard, Не знал → Again', () => {
    expect(GRADE_TO_RATING).toEqual({ good: 3, hard: 2, again: 1 });
  });

  it('после «Суфлёра» максимум — «С ошибкой»', () => {
    expect(capGrade('good', true)).toBe('hard');
    expect(capGrade('good', false)).toBe('good');
    expect(capGrade('again', true)).toBe('again');
  });

  it('карточка переживает сериализацию', () => {
    const s = schedule(null, 'good', { now: T0 });
    expect(fromCard(toCard(s))).toEqual(s);
    expect(emptyFsrs(T0).state).toBe(0);
  });

  it('«Знал» отодвигает срок, «Не знал» — возвращает в обучение', () => {
    let s = schedule(null, 'good', { now: T0 });
    s = schedule(s, 'good', { now: s.due });
    expect(s.state).toBe(2);
    const goodDue = schedule(s, 'good', { now: s.due }).due;
    const again = schedule(s, 'again', { now: s.due });
    expect(again.due).toBeLessThan(goodDue);
    expect(again.lapses).toBe(1);
  });

  it('интервалы ограничены датой премьеры', () => {
    const premiere = '2026-11-05';
    expect(parseDate(premiere)).toBe(new Date(2026, 10, 5).getTime());
    expect(parseDate('5.11.2026')).toBeNull();
    expect(maxIntervalDays(T0, premiere)).toBe(2);
    expect(maxIntervalDays(T0, null)).toBe(36_500);
    expect(maxIntervalDays(T0, '2026-01-01')).toBe(36_500);
    let s = schedule(null, 'good', { now: T0, premiere });
    for (let i = 0; i < 6 && s.due < parseDate(premiere)!; i++) {
      s = schedule(s, 'good', { now: s.due, premiere });
      expect(s.due).toBeLessThanOrEqual(parseDate(premiere)!);
    }
    // После премьеры ограничение снимается
    expect(schedule(s, 'good', { now: parseDate(premiere)! + DAY, premiere }).scheduledDays).toBeGreaterThan(2);
  });

  it('прогноз вспоминания, срок и «слабые» реплики', () => {
    expect(retrievability(undefined, T0)).toBe(0);
    let s = schedule(null, 'good', { now: T0 });
    s = schedule(s, 'good', { now: s.due });
    expect(isLearned(s, s.lastReview!)).toBe(true);
    expect(isDue(s, s.due - 1)).toBe(false);
    expect(isDue(s, s.due + 1)).toBe(true);
    expect(isWeak(s, s.due + 1)).toBe(true);
    expect(isWeak(s, s.lastReview! + 1000)).toBe(false);
    expect(retrievability(s, s.lastReview! + 365 * DAY)).toBeLessThan(0.9);
    expect(isWeak(emptyFsrs(T0), T0)).toBe(false);
  });
});

describe('обновление карточки', () => {
  const line = { id: 'L0001' as const, textHash: 'aaaa1111' };

  it('режимы со свободным вспоминанием меняют FSRS и последнюю оценку', () => {
    const c = applyGrade(undefined, { line, mode: 'cue', affectsFsrs: true, rating: 'good', now: T0 });
    expect(c.reps).toBe(1);
    expect(c.lastGrade).toBe('good');
  });

  it('режимы с подсказками пишут только журнал и свой уровень', () => {
    const prev = newCard(line, T0);
    const c = applyGrade(prev, { line, mode: 'letters', affectsFsrs: false, rating: 'good', now: T0 + 1 });
    expect(c.reps).toBe(0);
    expect(c.lastGrade).toBeNull();
    expect(c.updatedAt).toBe(T0 + 1);
  });

  it('уровень исчезания растёт после двух «Знал» подряд и падает после «Не знал»', () => {
    expect(nextVanish(0, 0, 'good')).toEqual({ level: 0, streak: 1 });
    expect(nextVanish(0, 1, 'good')).toEqual({ level: 1, streak: 0 });
    expect(nextVanish(3, 1, 'good')).toEqual({ level: 3, streak: 0 });
    expect(nextVanish(2, 1, 'hard')).toEqual({ level: 2, streak: 0 });
    expect(nextVanish(2, 1, 'again')).toEqual({ level: 1, streak: 0 });
    expect(nextVanish(0, 0, 'again')).toEqual({ level: 0, streak: 0 });
    let c = applyGrade(undefined, { line, mode: 'vanish', affectsFsrs: false, rating: 'good', now: T0 });
    c = applyGrade(c, { line, mode: 'vanish', affectsFsrs: false, rating: 'good', now: T0 + 1 });
    expect(c.vanishLevel).toBe(1);
  });
});
