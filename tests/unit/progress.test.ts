import { describe, expect, it } from 'vitest';
import { applyGrade, newCard, type CardRow, type ReviewRow } from '../../src/engine/model';
import { adviseScene, dayKey, overallRatio, roleProgress, sceneProgress, streakDays, summarize, type SceneProgress } from '../../src/engine/progress';
import { getLine } from '../../src/engine/queries';
import { miniPlay } from './fixtures';

const DAY = 86_400_000;
const NOW = new Date(2026, 10, 10, 12).getTime();

const p = (over: Partial<SceneProgress>): SceneProgress => ({
  ref: miniPlay().index.scenes[0]!,
  lineIds: [],
  total: 4,
  learned: 0,
  ratio: 0,
  rated: 0,
  knownShare: 0,
  due: 0,
  opened: true,
  ...over,
});

describe('«Путь роли»', () => {
  it('следует таблице раздела 5.3', () => {
    expect(adviseScene(p({ opened: false })).mode).toBe('read');
    expect(adviseScene(p({ rated: 0 }))).toMatchObject({ mode: 'letters', then: 'vanish' });
    expect(adviseScene(p({ rated: 4, knownShare: 0.25 })).mode).toBe('letters');
    expect(adviseScene(p({ rated: 4, knownShare: 0.5 }))).toMatchObject({ mode: 'vanish', then: 'cue' });
    expect(adviseScene(p({ rated: 4, knownShare: 0.8 })).mode).toBe('vanish');
    expect(adviseScene(p({ rated: 4, knownShare: 0.9 })).mode).toBe('cue');
    expect(adviseScene(p({ rated: 4, knownShare: 1, learned: 4 })).mode).toBe('audio');
    expect(adviseScene(p({ due: 2, opened: false })).mode).toBe('weak');
  });
});

describe('выученность сцены', () => {
  it('считает долю реплик с прогнозом ≥ 0,9 и долю «Знал»', () => {
    const { index } = miniPlay();
    const line = (id: string) => getLine(index, id)!;
    const cards = new Map<string, CardRow>();
    let c = applyGrade(undefined, { line: line('L0001'), mode: 'cue', affectsFsrs: true, rating: 'good', now: NOW - DAY });
    c = applyGrade(c, { line: line('L0001'), mode: 'cue', affectsFsrs: true, rating: 'good', now: NOW - DAY + 1000 });
    cards.set('L0001', c);
    cards.set('L0004', applyGrade(undefined, { line: line('L0004'), mode: 'cue', affectsFsrs: true, rating: 'again', now: NOW - DAY }));
    const scene = sceneProgress(index, index.scenes[0]!, ['a'], cards, new Set(), NOW);
    expect(scene).toMatchObject({ total: 2, rated: 2, knownShare: 0.5, opened: true, due: 1 });
    expect(scene.learned).toBe(1);
    const all = roleProgress(index, ['a'], cards, new Set(['a2s01']), NOW);
    expect(all.map((s) => s.ref.scene.id)).toEqual(['a1s01', 'a2s01']);
    expect(all[1]).toMatchObject({ opened: true, total: 2, learned: 0 });
    expect(overallRatio(all)).toBe(0.25);
    expect(overallRatio([])).toBe(0);
    const untouched = sceneProgress(index, index.scenes[1]!, ['c'], new Map([['L0005', newCard(line('L0005'), NOW)]]), new Set(), NOW);
    expect(untouched).toMatchObject({ opened: true, rated: 0, learned: 0 });
  });
});

describe('статистика', () => {
  const review = (lineId: `L${string}`, daysAgo: number, rating: ReviewRow['rating'], fsrs = true): ReviewRow => ({
    lineId,
    mode: 'cue',
    rating,
    hinted: false,
    fsrs,
    ts: NOW - daysAgo * DAY,
    durationMs: 20_000,
    prevCard: null,
  });

  it('серия дней заканчивается сегодня или вчера', () => {
    const days = new Set([dayKey(NOW), dayKey(NOW - DAY), dayKey(NOW - 3 * DAY)]);
    expect(streakDays(days, NOW)).toBe(2);
    expect(streakDays(new Set([dayKey(NOW - DAY)]), NOW)).toBe(1);
    expect(streakDays(new Set([dayKey(NOW - 2 * DAY)]), NOW)).toBe(0);
  });

  it('время, доля «Знал» и проблемные реплики', () => {
    const reviews = [
      review('L0001', 0, 'good'),
      review('L0001', 1, 'again'),
      review('L0004', 1, 'hard'),
      review('L0004', 1, 'good', false),
      review('L0002', 0, 'again'),
    ];
    const s = summarize(reviews, new Map(), new Set(['L0001', 'L0004']), NOW, 7);
    expect(s.totalReviews).toBe(4);
    expect(s.totalMs).toBe(80_000);
    expect(s.streak).toBe(2);
    expect(s.knownShare).toBeCloseTo(1 / 3);
    expect(s.days).toHaveLength(7);
    expect(s.days[6]).toMatchObject({ day: dayKey(NOW), reviews: 1 });
    expect(s.problems.map((x) => x.lineId)).toEqual(['L0001', 'L0004']);
    expect(summarize([], new Map(), new Set(), NOW).knownShare).toBe(0);
  });
});
