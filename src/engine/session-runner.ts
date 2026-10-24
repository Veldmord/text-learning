// Исполнитель сессии: держит состояние машины, исполняет эффекты через порты аудио и хранилища, ведёт журнал сессии.
// Порты — интерфейсы, поэтому engine не зависит от браузерных API и тестируется с фейками.
import { echoUnits, lineDurationMs, playPlan, stepPlan, type AudioRunSpan, type CuePlan, type PlanSettings, type SpeechUnit } from './audio-plan';
import { cursorKey, type SessionRow } from './model';
import type { ModeId } from './modes';
import { findStepIndex, type Step } from './modes/steps';
import { getLine, myLinesInScene, parseScope, rolesKey, scopeItemIds, type PlayIndex } from './queries';
import { currentStep, initialState, leave, reduce, type Effect, type LeaveEffect, type SessionAction, type SessionState } from './session-machine';
import type { Line } from './types';

export interface PlayOptions {
  /** Выдержать паузу и после последнего юнита — дыхание перед следующей репликой партнёра */
  pauseAfter?: boolean;
}

export interface AudioPort {
  /** Играет очередь; true — доиграла до конца, false — прервана */
  play(units: SpeechUnit[], opts?: PlayOptions): Promise<boolean>;
  silence(ms: number): Promise<boolean>;
  stop(): void;
  pause(): void;
  /** false — продолжать нечего (звук уже закончился) */
  resume(): boolean;
}

export interface StorePort {
  saveCursor(key: string, itemId: string | null): Promise<void>;
  saveSession(row: SessionRow): Promise<void>;
}

export interface RunnerSettings extends PlanSettings {
  autoAdvance: boolean;
  echo: boolean;
  /** Пауза в аудиопрогоне: k × длительность своей реплики */
  audioRunK: number;
  audioRun: AudioRunSpan;
  skipScenesWithoutRole: boolean;
}

export interface RunnerDeps {
  index: PlayIndex;
  roles: string[];
  scopeKey: string;
  audio: AudioPort;
  store: StorePort;
  settings: () => RunnerSettings;
  clipMs: (sentenceId: string) => number | undefined;
  now?: () => number;
  /** id записи журнала сессии */
  newId?: () => string;
  /** Запись журнала сохранена */
  onSaved?: () => void;
  onError?: (e: unknown) => void;
}

/** Время на одном шаге засчитывается не больше 5 минут: дольше — актёр отошёл от телефона. */
export const STEP_TIME_CAP_MS = 5 * 60_000;

export class SessionRunner {
  private state: SessionState;
  private readonly listeners = new Set<() => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private disposed = false;
  private readonly now: () => number;
  private readonly newId: () => string;
  private scopeIds: Set<string> | null = null;
  /** Запись журнала текущей сессии: создаётся при первом уходе с шага */
  private session: SessionRow | null = null;
  private startedAt = 0;

  constructor(
    private readonly deps: RunnerDeps,
    mode: ModeId,
  ) {
    const s = deps.settings();
    this.state = initialState(mode, { autoAdvance: s.autoAdvance, echo: s.echo, waitOnMine: s.audioRun === 'play' });
    this.now = deps.now ?? Date.now;
    this.newId = deps.newId ?? (() => crypto.randomUUID());
  }

  getState = (): SessionState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  /** Эффекты исполняются до оповещения подписчиков: экран видит уже обновлённый журнал сессии. */
  dispatch = (action: SessionAction): void => {
    if (this.disposed) return;
    const [next, effects] = reduce(this.state, action);
    this.state = next;
    for (const e of effects) this.run(e);
    this.listeners.forEach((fn) => fn());
  };

  /** Журнал текущей сессии: время, сказанные реплики, пройденные сцены. */
  getSession = (): SessionRow | null => this.session;

  /** Новая сессия: с шага, где реплика `fromItemId` (или первого после неё), иначе с начала. */
  start(steps: Step[], fromItemId?: string | null, mode?: ModeId): void {
    this.session = null;
    this.startedAt = this.now();
    this.dispatch({ type: 'start', steps, index: findStepIndex(steps, this.deps.index, fromItemId), now: this.startedAt, ...(mode ? { mode } : {}) });
  }

  /** Смена режима или набора шагов на лету без потери позиции (FR-04). */
  setMode(mode: ModeId, steps: Step[]): void {
    const itemId = currentStep(this.state)?.itemId;
    this.dispatch({ type: 'setMode', mode, steps, index: findStepIndex(steps, this.deps.index, itemId), now: this.now() });
  }

  /** Перейти к реплике по навигации: шаг с ней или первый после неё. */
  jumpTo(itemId: string): void {
    this.dispatch({ type: 'jump', index: findStepIndex(this.state.steps, this.deps.index, itemId), now: this.now() });
  }

  /** Начать текущий шаг заново — например, после смены варианта аудиопрогона. */
  restartStep(): void {
    this.dispatch({ type: 'restart', now: this.now() });
  }

  /** Дождаться записи журнала и курсора (для тестов и перед уходом с экрана). */
  flush(): Promise<unknown> {
    return this.queue;
  }

  /** Остановить звук и игнорировать события (уход с экрана). Время на текущем шаге идёт в журнал.
   * revive() — вернуть к жизни (повторный mount в StrictMode). */
  dispose(): void {
    if (!this.disposed) for (const e of leave(this.state, this.now(), false)) this.track(e);
    this.disposed = true;
    this.deps.audio.stop();
  }

  revive(): void {
    this.disposed = false;
  }

  currentLine(): Line | undefined {
    const step = currentStep(this.state);
    return step ? getLine(this.deps.index, step.itemId) : undefined;
  }

  private enqueue(task: () => Promise<void>): void {
    this.queue = this.queue.then(task).catch((e: unknown) => this.deps.onError?.(e));
  }

  private unitsFor(phase: 'context' | 'cue' | 'echo'): SpeechUnit[] {
    const step = currentStep(this.state);
    if (!step) return [];
    if (phase === 'echo') {
      const line = getLine(this.deps.index, step.itemId);
      return line ? echoUnits(line) : [];
    }
    const plan = this.planFor(step);
    return phase === 'context' ? plan.context : plan.cue;
  }

  private planFor(step: Step): CuePlan {
    const { index, roles } = this.deps;
    const s = this.deps.settings();
    if (this.state.mode !== 'audio' || s.audioRun !== 'play') return stepPlan(this.state.mode, index, step.itemId, roles, s);
    this.scopeIds ??= scopeItemIds(index, parseScope(this.deps.scopeKey));
    return playPlan(index, step.itemId, roles, s, { inScope: this.scopeIds, skipScenesWithoutRole: s.skipScenesWithoutRole });
  }

  private silenceMs(): number {
    const line = this.currentLine();
    if (!line) return 0;
    return Math.round(lineDurationMs(line, this.deps.clipMs) * this.deps.settings().audioRunK);
  }

  /**
   * Журнал сессии: активное время, сказанные свои реплики и сцены, пройденные целиком —
   * все свои реплики сцены встретились в этой сессии, и актёр прошёл сцену до конца.
   */
  private track(e: LeaveEffect): void {
    const { index, roles, store } = this.deps;
    const now = this.now();
    let row = this.session;
    if (!row || row.mode !== e.mode) {
      row = { id: this.newId(), rolesKey: rolesKey(roles), mode: e.mode, startedAt: row ? now : this.startedAt, updatedAt: now, activeMs: 0, lines: 0, scenes: [] };
      this.session = row;
    }
    row.activeMs += Math.min(e.ms, STEP_TIME_CAP_MS);
    if (e.said) row.lines++;
    const sceneId = index.sceneOfItem.get(e.step.itemId)?.scene.id;
    const leftScene = e.forward && sceneId && (!e.next || index.sceneOfItem.get(e.next.itemId)?.scene.id !== sceneId);
    if (leftScene && !row.scenes.includes(sceneId)) {
      const seen = new Set(this.state.seen);
      const mine = myLinesInScene(index, sceneId, roles);
      if (mine.length && mine.every((l) => seen.has(l.id))) row.scenes.push(sceneId);
    }
    row.updatedAt = now;
    const snapshot: SessionRow = { ...row, scenes: [...row.scenes] };
    this.enqueue(async () => {
      await store.saveSession(snapshot);
      this.deps.onSaved?.();
    });
  }

  private run(effect: Effect): void {
    const { audio, store } = this.deps;
    switch (effect.type) {
      case 'stopAudio':
        audio.stop();
        return;
      case 'pauseAudio':
        audio.pause();
        return;
      case 'resumeAudio':
        if (!audio.resume()) this.dispatch({ type: 'audioEnded', token: this.state.token, now: this.now() });
        return;
      case 'play': {
        const { token, phase } = effect;
        // Реплика партнёра в прогоне по очереди: пауза между репликами и перед следующей
        const pauseAfter = phase === 'cue' && currentStep(this.state)?.mine === false;
        const playing = phase === 'silence' ? audio.silence(this.silenceMs()) : audio.play(this.unitsFor(phase), pauseAfter ? { pauseAfter } : undefined);
        playing
          .then((ended) => {
            if (ended) this.dispatch({ type: 'audioEnded', token, now: this.now() });
          })
          .catch((e: unknown) => {
            this.deps.onError?.(e);
            this.dispatch({ type: 'audioEnded', token, now: this.now() });
          });
        return;
      }
      case 'saveCursor': {
        const key = cursorKey(rolesKey(this.deps.roles), this.state.mode, this.deps.scopeKey);
        const step = effect.stepIndex === null ? undefined : this.state.steps[effect.stepIndex];
        this.enqueue(() => store.saveCursor(key, step?.itemId ?? null));
        return;
      }
      case 'leave':
        this.track(effect);
        return;
      case 'finished':
        return;
    }
  }
}
