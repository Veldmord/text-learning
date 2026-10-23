// Исполнитель сессии: держит состояние машины, исполняет эффекты через порты аудио и хранилища.
// Порты — интерфейсы, поэтому engine не зависит от браузерных API и тестируется с фейками.
import { cuePlan, echoUnits, lineDurationMs, type PlanSettings, type SpeechUnit } from './audio-plan';
import { applyGrade, cursorKey, type CardRow, type ReviewRow } from './model';
import { MODES, type ModeId } from './modes';
import { findStepIndex, type Step } from './modes/steps';
import { getLine, rolesKey, type PlayIndex } from './queries';
import { currentStep, initialState, reduce, type Effect, type SessionAction, type SessionState } from './session-machine';
import type { Line, LineId } from './types';

export interface AudioPort {
  /** Играет очередь; true — доиграла до конца, false — прервана */
  play(units: SpeechUnit[]): Promise<boolean>;
  silence(ms: number): Promise<boolean>;
  stop(): void;
  pause(): void;
  /** false — продолжать нечего (звук уже закончился) */
  resume(): boolean;
}

export interface StorePort {
  getCard(lineId: LineId): Promise<CardRow | undefined>;
  /** Атомарно: обновить карточку и добавить запись журнала. Возвращает id записи. */
  commitReview(review: ReviewRow, card: CardRow): Promise<number>;
  /** Удалить запись журнала и восстановить карточку из prevCard */
  undoReview(reviewId: number): Promise<void>;
  saveCursor(key: string, itemId: string | null): Promise<void>;
}

export interface RunnerSettings extends PlanSettings {
  autoAdvance: boolean;
  echo: boolean;
  /** Пауза в аудиопрогоне: k × длительность своей реплики */
  audioRunK: number;
  premiere: string | null;
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
  onGraded?: () => void;
  onError?: (e: unknown) => void;
}

export class SessionRunner {
  private state: SessionState;
  private readonly listeners = new Set<() => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private disposed = false;
  private readonly now: () => number;

  constructor(
    private readonly deps: RunnerDeps,
    mode: ModeId,
  ) {
    const s = deps.settings();
    this.state = initialState(mode, { autoAdvance: s.autoAdvance, echo: s.echo });
    this.now = deps.now ?? Date.now;
  }

  getState = (): SessionState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  dispatch = (action: SessionAction): void => {
    if (this.disposed) return;
    const [next, effects] = reduce(this.state, action);
    this.state = next;
    this.listeners.forEach((fn) => fn());
    for (const e of effects) this.run(e);
  };

  start(steps: Step[], resumeLineId?: string, mode?: ModeId): void {
    this.dispatch({ type: 'start', steps, index: findStepIndex(steps, this.deps.index, resumeLineId), now: this.now(), ...(mode ? { mode } : {}) });
  }

  /** Смена режима на лету без потери позиции (FR-04). */
  setMode(mode: ModeId, steps: Step[]): void {
    const lineId = currentStep(this.state)?.lineId;
    this.dispatch({ type: 'setMode', mode, steps, index: findStepIndex(steps, this.deps.index, lineId), now: this.now() });
  }

  /** Дождаться записи всех оценок (для тестов и перед уходом с экрана). */
  flush(): Promise<unknown> {
    return this.queue;
  }

  /** Остановить звук и игнорировать события (уход с экрана). revive() — вернуть к жизни (повторный mount в StrictMode). */
  dispose(): void {
    this.disposed = true;
    this.deps.audio.stop();
  }

  revive(): void {
    this.disposed = false;
  }

  currentLine(): Line | undefined {
    const step = currentStep(this.state);
    return step ? getLine(this.deps.index, step.lineId) : undefined;
  }

  private enqueue(task: () => Promise<void>): void {
    this.queue = this.queue.then(task).catch((e: unknown) => this.deps.onError?.(e));
  }

  private unitsFor(phase: 'context' | 'cue' | 'echo'): SpeechUnit[] {
    const step = currentStep(this.state);
    if (!step) return [];
    if (phase === 'echo') {
      const line = getLine(this.deps.index, step.lineId);
      return line ? echoUnits(line, step.kind === 'chunk' ? step.sentenceIdx : undefined) : [];
    }
    const plan = cuePlan(this.deps.index, step.lineId, this.deps.roles, this.deps.settings());
    return phase === 'context' ? plan.context : plan.cue;
  }

  private silenceMs(): number {
    const step = currentStep(this.state);
    const line = step ? getLine(this.deps.index, step.lineId) : undefined;
    if (!step || !line) return 0;
    const ms = lineDurationMs(line, this.deps.clipMs, step.kind === 'chunk' ? step.sentenceIdx : undefined);
    return Math.round(ms * this.deps.settings().audioRunK);
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
        const playing = phase === 'silence' ? audio.silence(this.silenceMs()) : audio.play(this.unitsFor(phase));
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
        this.enqueue(() => store.saveCursor(key, step?.lineId ?? null));
        return;
      }
      case 'persistGrade': {
        const mode = this.state.mode;
        const { step, rating, hinted, durationMs, stepIndex, attempt } = effect;
        const line = getLine(this.deps.index, step.lineId);
        if (!line) return;
        const now = this.now();
        const affectsFsrs = MODES[mode].affectsFsrs;
        const detail =
          step.kind === 'chunk'
            ? `часть ${step.part}/${step.parts}${attempt ? `, попытка ${attempt + 1}` : ''}`
            : step.kind === 'order'
              ? `порядок ${step.id}`
              : undefined;
        this.enqueue(async () => {
          const prev = await store.getCard(line.id);
          const card = applyGrade(prev, { line, mode, affectsFsrs, rating, now, premiere: this.deps.settings().premiere });
          const review: ReviewRow = {
            lineId: line.id,
            mode,
            rating,
            hinted,
            fsrs: affectsFsrs,
            ts: now,
            durationMs,
            prevCard: prev ?? null,
            ...(detail ? { detail } : {}),
          };
          const reviewId = await store.commitReview(review, card);
          this.dispatch({ type: 'gradeSaved', stepIndex, reviewId });
          this.deps.onGraded?.();
        });
        return;
      }
      case 'undoGrade':
        this.enqueue(() => store.undoReview(effect.reviewId));
        return;
      case 'finished':
        return;
    }
  }
}
