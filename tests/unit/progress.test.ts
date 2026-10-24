import { describe, expect, it } from 'vitest';
import type { SessionRow } from '../../src/engine/model';
import { dayKey, passCount, passedShare, roleProgress, sessionsOf, streakDays, summarize } from '../../src/engine/progress';
import { miniPlay } from './fixtures';

const DAY = 86_400_000;
const NOW = new Date(2026, 10, 10, 12).getTime();

let n = 0;
const session = (over: Partial<SessionRow>): SessionRow => ({
  id: `s${++n}`,
  rolesKey: 'a',
  mode: 'run',
  startedAt: NOW,
  updatedAt: NOW,
  activeMs: 60_000,
  lines: 2,
  scenes: [],
  ...over,
});

describe('пройденные сцены', () => {
  it('считает прогоны по режимам и дату последнего, только для своей связки ролей', () => {
    const { index } = miniPlay();
    const sessions = [
      session({ scenes: ['a1s01'], updatedAt: NOW - DAY }),
      session({ mode: 'letters', scenes: ['a1s01', 'a2s01'], updatedAt: NOW - 2 * DAY }),
      session({ mode: 'audio', scenes: ['a1s01'], updatedAt: NOW }),
      session({ rolesKey: 'a,b', scenes: ['a1s01', 'a2s01'] }),
    ];
    expect(sessionsOf(sessions, ['a'])).toHaveLength(3);
    const scenes = roleProgress(index, ['a'], sessions);
    expect(scenes.map((s) => s.ref.scene.id)).toEqual(['a1s01', 'a2s01']);
    expect(scenes[0]).toMatchObject({ total: 2, passes: { run: 1, letters: 1, audio: 1 }, lastPassAt: NOW });
    expect(scenes[1]).toMatchObject({ total: 2, passes: { run: 0, letters: 1, audio: 0 }, lastPassAt: NOW - 2 * DAY });
    expect(passCount(scenes[0]!)).toBe(3);
    expect(passedShare(scenes)).toBe(1);
    expect(passedShare(roleProgress(index, ['a'], sessions.slice(0, 1)))).toBe(0.5);
    expect(passedShare([])).toBe(0);
    expect(roleProgress(index, ['a'], [])[0]).toMatchObject({ passes: { run: 0, letters: 0, audio: 0 }, lastPassAt: null });
  });
});

describe('статистика', () => {
  it('серия дней заканчивается сегодня или вчера', () => {
    const days = new Set([dayKey(NOW), dayKey(NOW - DAY), dayKey(NOW - 3 * DAY)]);
    expect(streakDays(days, NOW)).toBe(2);
    expect(streakDays(new Set([dayKey(NOW - DAY)]), NOW)).toBe(1);
    expect(streakDays(new Set([dayKey(NOW - 2 * DAY)]), NOW)).toBe(0);
  });

  it('время, реплики и прогоны по дням', () => {
    const sessions = [
      session({ startedAt: NOW, activeMs: 120_000, lines: 5, scenes: ['a1s01'] }),
      session({ startedAt: NOW - DAY, activeMs: 60_000, lines: 3 }),
      session({ startedAt: NOW - DAY, activeMs: 30_000, lines: 1, scenes: ['a1s01', 'a2s01'] }),
      // Открыл и сразу закрыл — не тренировка
      session({ startedAt: NOW - 2 * DAY, activeMs: 0, lines: 0 }),
    ];
    const s = summarize(sessions, NOW, 7);
    expect(s).toMatchObject({ streak: 2, totalMs: 210_000, lines: 9, totalPasses: 3 });
    expect(s.days).toHaveLength(7);
    expect(s.days[6]).toEqual({ day: dayKey(NOW), ms: 120_000, lines: 5 });
    expect(s.days[5]).toEqual({ day: dayKey(NOW - DAY), ms: 90_000, lines: 4 });
    expect(s.days[4]).toEqual({ day: dayKey(NOW - 2 * DAY), ms: 0, lines: 0 });
    expect(summarize([], NOW)).toMatchObject({ streak: 0, totalMs: 0, lines: 0, totalPasses: 0 });
  });
});
