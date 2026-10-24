// Прогресс по сценам и роли (раздел 5.3) и статистика (FR-10) — по журналу сессий, без оценок.
import type { SessionRow } from './model';
import type { ModeId } from './modes';
import { myLinesInScene, rolesKey, scenesWithRoles, type PlayIndex, type SceneRef } from './queries';

export interface SceneProgress {
  ref: SceneRef;
  /** Своих реплик в сцене */
  total: number;
  /** Сколько раз сцена пройдена целиком — по режимам */
  passes: Record<ModeId, number>;
  lastPassAt: number | null;
}

export const passCount = (p: SceneProgress): number => p.passes.run + p.passes.letters + p.passes.audio;

/** Сессии этой связки ролей. */
export const sessionsOf = (sessions: SessionRow[], roles: string[]): SessionRow[] => {
  const key = rolesKey(roles);
  return sessions.filter((s) => s.rolesKey === key);
};

export function roleProgress(index: PlayIndex, roles: string[], sessions: SessionRow[]): SceneProgress[] {
  const mine = sessionsOf(sessions, roles);
  return scenesWithRoles(index, roles).map((ref) => {
    const passes: Record<ModeId, number> = { run: 0, letters: 0, audio: 0 };
    let lastPassAt: number | null = null;
    for (const s of mine) {
      if (!s.scenes.includes(ref.scene.id)) continue;
      passes[s.mode]++;
      lastPassAt = Math.max(lastPassAt ?? 0, s.updatedAt);
    }
    return { ref, total: myLinesInScene(index, ref.scene.id, roles).length, passes, lastPassAt };
  });
}

/** Доля сцен с ролью, пройденных хотя бы раз. */
export function passedShare(scenes: SceneProgress[]): number {
  return scenes.length ? scenes.filter((s) => passCount(s) > 0).length / scenes.length : 0;
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
  ms: number;
  lines: number;
}

export interface RoleStatsSummary {
  streak: number;
  totalMs: number;
  /** Своих реплик сказано за всё время */
  lines: number;
  /** Сцен пройдено целиком за всё время, с повторами */
  totalPasses: number;
  days: DayActivity[];
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

/** Сводка по сессиям одной связки ролей; день сессии — день её начала. */
export function summarize(sessions: SessionRow[], now: number, dayCount = 14): RoleStatsSummary {
  const active = sessions.filter((s) => s.activeMs > 0);
  const byDay = new Map<string, DayActivity>();
  for (const s of active) {
    const k = dayKey(s.startedAt);
    const d = byDay.get(k) ?? { day: k, ms: 0, lines: 0 };
    d.ms += s.activeMs;
    d.lines += s.lines;
    byDay.set(k, d);
  }
  const days: DayActivity[] = [];
  for (let i = dayCount - 1; i >= 0; i--) {
    const k = dayKey(now - i * DAY);
    days.push(byDay.get(k) ?? { day: k, ms: 0, lines: 0 });
  }
  return {
    streak: streakDays(new Set(byDay.keys()), now),
    totalMs: active.reduce((n, s) => n + s.activeMs, 0),
    lines: active.reduce((n, s) => n + s.lines, 0),
    totalPasses: sessions.reduce((n, s) => n + s.scenes.length, 0),
    days,
  };
}
