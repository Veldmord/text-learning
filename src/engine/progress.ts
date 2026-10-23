// Прогресс по сценам и роли, рекомендации «Пути роли» (раздел 5.3) и статистика (FR-10).
import type { CardRow, ReviewRow } from './model';
import type { ModeId } from './modes';
import { myLinesInScene, scenesWithRoles, type PlayIndex, type SceneRef } from './queries';
import { isDue, isLearned, retrievability, RECALL_TARGET } from './srs';
import type { LineId } from './types';

export interface SceneProgress {
  ref: SceneRef;
  lineIds: LineId[];
  total: number;
  /** Реплики с прогнозом вспоминания ≥ 0,9 на сегодня */
  learned: number;
  /** Выученность сцены: learned / total */
  ratio: number;
  /** Реплики, оценённые в режимах со свободным вспоминанием */
  rated: number;
  /** Доля «Знал» по последней оценке среди всех своих реплик сцены */
  knownShare: number;
  due: number;
  opened: boolean;
}

export function sceneProgress(
  index: PlayIndex,
  ref: SceneRef,
  roles: string[],
  cards: Map<string, CardRow>,
  readScenes: Set<string>,
  now: number,
): SceneProgress {
  const lines = myLinesInScene(index, ref.scene.id, roles);
  let learned = 0;
  let rated = 0;
  let known = 0;
  let due = 0;
  let touched = false;
  for (const l of lines) {
    const c = cards.get(l.id);
    if (!c) continue;
    touched = true;
    if (isLearned(c, now)) learned++;
    if (c.lastGrade) rated++;
    if (c.lastGrade === 'good') known++;
    if (isDue(c, now)) due++;
  }
  const total = lines.length;
  return {
    ref,
    lineIds: lines.map((l) => l.id),
    total,
    learned,
    ratio: total ? learned / total : 0,
    rated,
    knownShare: total ? known / total : 0,
    due,
    opened: readScenes.has(ref.scene.id) || touched,
  };
}

export function roleProgress(
  index: PlayIndex,
  roles: string[],
  cards: Map<string, CardRow>,
  readScenes: Set<string>,
  now: number,
): SceneProgress[] {
  return scenesWithRoles(index, roles).map((ref) => sceneProgress(index, ref, roles, cards, readScenes, now));
}

export function overallRatio(scenes: SceneProgress[]): number {
  const total = scenes.reduce((n, s) => n + s.total, 0);
  return total ? scenes.reduce((n, s) => n + s.learned, 0) / total : 0;
}

// ---------------------------------------------------------------------------
// «Путь роли»

export interface Advice {
  mode: ModeId;
  then?: ModeId;
  reason: string;
}

export function adviseScene(p: SceneProgress): Advice {
  if (p.due > 0) return { mode: 'weak', reason: `Подошёл срок повторения у ${p.due} реплик` };
  if (!p.opened) return { mode: 'read', reason: 'Сцену ещё не открывали' };
  if (p.total > 0 && p.learned === p.total) return { mode: 'audio', reason: 'Все реплики выучены — пора прогонять на слух' };
  if (p.rated === 0 || p.knownShare < 0.5) return { mode: 'letters', then: 'vanish', reason: 'Доля «Знал» меньше 50 %' };
  if (p.knownShare <= 0.8) return { mode: 'vanish', then: 'cue', reason: 'Доля «Знал» 50–80 %: исчезающий текст на 75–100 %' };
  return { mode: 'cue', reason: 'Доля «Знал» больше 80 %' };
}

// ---------------------------------------------------------------------------
// Статистика

const DAY = 86_400_000;

export const dayKey = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export interface DayActivity {
  day: string;
  reviews: number;
  ms: number;
}

export interface RoleStatsSummary {
  streak: number;
  totalMs: number;
  totalReviews: number;
  knownShare: number;
  days: DayActivity[];
  problems: { lineId: LineId; again: number; hard: number; retrievability: number }[];
}

/** Серия — число дней подряд с тренировкой, заканчивая сегодня или вчера. */
export function streakDays(days: Set<string>, now: number): number {
  let streak = 0;
  let t = now;
  if (!days.has(dayKey(t))) t -= DAY;
  while (days.has(dayKey(t))) {
    streak++;
    t -= DAY;
  }
  return streak;
}

export function summarize(
  reviews: ReviewRow[],
  cards: Map<string, CardRow>,
  lineIds: Set<string>,
  now: number,
  dayCount = 14,
): RoleStatsSummary {
  const mine = reviews.filter((r) => lineIds.has(r.lineId));
  const byDay = new Map<string, DayActivity>();
  for (const r of mine) {
    const k = dayKey(r.ts);
    const d = byDay.get(k) ?? { day: k, reviews: 0, ms: 0 };
    d.reviews++;
    d.ms += Math.min(r.durationMs, 10 * 60_000);
    byDay.set(k, d);
  }
  const days: DayActivity[] = [];
  for (let i = dayCount - 1; i >= 0; i--) {
    const k = dayKey(now - i * DAY);
    days.push(byDay.get(k) ?? { day: k, reviews: 0, ms: 0 });
  }
  const fsrsReviews = mine.filter((r) => r.fsrs);
  const problemsMap = new Map<LineId, { again: number; hard: number }>();
  for (const r of mine) {
    if (r.rating === 'good') continue;
    const p = problemsMap.get(r.lineId) ?? { again: 0, hard: 0 };
    p[r.rating]++;
    problemsMap.set(r.lineId, p);
  }
  const problems = [...problemsMap.entries()]
    .map(([lineId, p]) => ({ lineId, ...p, retrievability: retrievability(cards.get(lineId), now) }))
    .filter((p) => p.retrievability < RECALL_TARGET || p.again > 0)
    .sort((a, b) => b.again * 2 + b.hard - (a.again * 2 + a.hard) || a.retrievability - b.retrievability)
    .slice(0, 30);
  return {
    streak: streakDays(new Set(byDay.keys()), now),
    totalMs: [...byDay.values()].reduce((n, d) => n + d.ms, 0),
    totalReviews: mine.length,
    knownShare: fsrsReviews.length ? fsrsReviews.filter((r) => r.rating === 'good').length / fsrsReviews.length : 0,
    days,
    problems,
  };
}
