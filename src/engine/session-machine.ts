// Машина состояний сессии — docs/ARCHITECTURE.md, раздел 7.3.
// Чистый reducer: (состояние, действие) → (новое состояние, эффекты). Эффекты исполняет SessionRunner.
import { MODES, type ModeId } from './modes';
import type { Step } from './modes/steps';
import { capGrade, type Grade3 } from './srs';

export type Phase = 'context' | 'cue' | 'prompt' | 'revealed' | 'done';
export type AudioPhase = 'context' | 'cue' | 'silence' | 'echo';

export interface OrderState {
  placed: string[];
  mistakes: number;
  wrong: string | null;
  gaveUp: boolean;
}

export interface SessionState {
  mode: ModeId;
  steps: Step[];
  index: number;
  phase: Phase;
  /** Подсказка закончила звучать, ждём тап (при выключенном автопереходе) */
  cueDone: boolean;
  /** Сколько слов открыл «Суфлёр» */
  hints: number;
  stepStartedAt: number;
  /** Оценки этой сессии: индекс шага → id записи журнала; 'pending' — пишется, 'undo' — отменить после записи */
  graded: Record<number, number | 'pending' | 'undo'>;
  order: OrderState;
  typed: string;
  paused: boolean;
  autoAdvance: boolean;
  echo: boolean;
  /** Номер попытки текущего шага (растёт при повторе после «Не знал») */
  attempt: number;
  /** Защита от устаревших событий аудио: растёт при каждом переходе */
  token: number;
  /** Что сейчас звучит */
  audio: AudioPhase | null;
}

export type SessionAction =
  | { type: 'start'; steps: Step[]; index: number; now: number; mode?: ModeId }
  | { type: 'audioEnded'; token: number; now: number }
  | { type: 'tapCue' }
  | { type: 'hint' }
  | { type: 'reveal' }
  | { type: 'grade'; rating: Grade3; now: number }
  | { type: 'next'; now: number }
  | { type: 'back'; now: number }
  | { type: 'gradeSaved'; stepIndex: number; reviewId: number }
  | { type: 'setMode'; mode: ModeId; steps: Step[]; index: number; now: number }
  | { type: 'orderPick'; pieceId: string }
  | { type: 'typeInput'; text: string }
  | { type: 'togglePause' }
  | { type: 'setOptions'; autoAdvance?: boolean; echo?: boolean }
  | { type: 'replayCue' };

export type Effect =
  | { type: 'stopAudio' }
  | { type: 'pauseAudio' }
  | { type: 'resumeAudio' }
  | { type: 'play'; phase: AudioPhase; token: number }
  | { type: 'saveCursor'; stepIndex: number | null }
  | {
      type: 'persistGrade';
      stepIndex: number;
      step: Step;
      rating: Grade3;
      hinted: boolean;
      durationMs: number;
      attempt: number;
    }
  | { type: 'undoGrade'; reviewId: number }
  | { type: 'finished' };

export type Transition = [SessionState, Effect[]];

const emptyOrder = (): OrderState => ({ placed: [], mistakes: 0, wrong: null, gaveUp: false });

export function initialState(mode: ModeId, opts: { autoAdvance: boolean; echo: boolean }): SessionState {
  return {
    mode,
    steps: [],
    index: 0,
    phase: 'done',
    cueDone: false,
    hints: 0,
    stepStartedAt: 0,
    graded: {},
    order: emptyOrder(),
    typed: '',
    paused: false,
    autoAdvance: opts.autoAdvance,
    echo: opts.echo,
    attempt: 0,
    token: 0,
    audio: null,
  };
}

export const currentStep = (s: SessionState): Step | undefined => s.steps[s.index];

/** Звучит ли подсказка перед шагом: в монологе — только перед первой частью. */
export function stepPlaysCue(mode: ModeId, step: Step | undefined): boolean {
  if (!step || !MODES[mode].playsCue) return false;
  if (step.kind === 'order') return false;
  if (step.kind === 'chunk') return step.part === 1;
  return true;
}

function enterStep(s: SessionState, index: number, now: number, attempt = 0): Transition {
  const token = s.token + 1;
  if (index >= s.steps.length) {
    return [
      { ...s, index: s.steps.length, phase: 'done', audio: null, token, paused: false },
      [{ type: 'stopAudio' }, { type: 'saveCursor', stepIndex: null }, { type: 'finished' }],
    ];
  }
  const step = s.steps[index];
  const plays = stepPlaysCue(s.mode, step);
  const next: SessionState = {
    ...s,
    index,
    phase: plays ? 'context' : 'prompt',
    cueDone: false,
    hints: 0,
    stepStartedAt: now,
    order: emptyOrder(),
    typed: '',
    attempt,
    token,
    paused: false,
    audio: plays ? 'context' : null,
  };
  const effects: Effect[] = [{ type: 'stopAudio' }, { type: 'saveCursor', stepIndex: index }];
  if (plays) effects.push({ type: 'play', phase: 'context', token });
  else if (s.mode === 'audio') return enterPrompt(next, effects);
  return [next, effects];
}

/** Переход к своей реплике. В аудиопрогоне на ней звучит тишина длиной ≈ реплика × k. */
function enterPrompt(s: SessionState, effects: Effect[] = []): Transition {
  const token = s.token + 1;
  if (s.mode === 'audio') {
    return [{ ...s, phase: 'prompt', cueDone: true, token, audio: 'silence' }, [...effects, { type: 'play', phase: 'silence', token }]];
  }
  return [{ ...s, phase: 'prompt', cueDone: true, token, audio: null }, effects];
}

function enterRevealed(s: SessionState, effects: Effect[] = []): Transition {
  const token = s.token + 1;
  const withEcho = s.echo && currentStep(s)?.kind !== 'order';
  return [
    { ...s, phase: 'revealed', token, audio: withEcho ? 'echo' : null },
    withEcho ? [...effects, { type: 'stopAudio' }, { type: 'play', phase: 'echo', token }] : [...effects, { type: 'stopAudio' }],
  ];
}

export function reduce(s: SessionState, a: SessionAction): Transition {
  const def = MODES[s.mode];
  switch (a.type) {
    case 'start':
      return enterStep({ ...s, mode: a.mode ?? s.mode, steps: a.steps, graded: {} }, Math.min(Math.max(a.index, 0), a.steps.length), a.now);

    case 'setMode':
      return enterStep({ ...s, mode: a.mode, steps: a.steps, graded: {} }, Math.min(Math.max(a.index, 0), a.steps.length), a.now);

    case 'setOptions':
      return [{ ...s, autoAdvance: a.autoAdvance ?? s.autoAdvance, echo: a.echo ?? s.echo }, []];

    case 'audioEnded': {
      if (a.token !== s.token || s.paused) return [s, []];
      if (s.audio === 'context') {
        const token = s.token + 1;
        return [{ ...s, phase: 'cue', token, audio: 'cue' }, [{ type: 'play', phase: 'cue', token }]];
      }
      if (s.audio === 'cue') {
        if (s.autoAdvance || s.mode === 'audio') return enterPrompt(s);
        return [{ ...s, cueDone: true, audio: null }, []];
      }
      if (s.audio === 'silence') {
        if (s.echo) {
          const token = s.token + 1;
          return [{ ...s, phase: 'revealed', token, audio: 'echo' }, [{ type: 'play', phase: 'echo', token }]];
        }
        return enterStep(s, s.index + 1, a.now);
      }
      if (s.audio === 'echo') {
        if (s.mode === 'audio') return enterStep(s, s.index + 1, a.now);
        return [{ ...s, audio: null }, []];
      }
      return [s, []];
    }

    case 'replayCue': {
      if (s.phase === 'done' || !stepPlaysCue(s.mode, currentStep(s))) return [s, []];
      const token = s.token + 1;
      // Повтор подсказки не сбрасывает открытые слова и введённый текст
      return [
        { ...s, token, audio: 'cue', phase: s.phase === 'context' ? 'cue' : s.phase },
        [{ type: 'stopAudio' }, { type: 'play', phase: 'cue', token }],
      ];
    }

    case 'tapCue':
      if (s.phase !== 'context' && s.phase !== 'cue') return [s, []];
      return enterPrompt(s, [{ type: 'stopAudio' }]);

    case 'hint': {
      if (!def.graded || currentStep(s)?.kind === 'order') return [s, []];
      if (s.phase === 'context' || s.phase === 'cue') {
        const [p, eff] = enterPrompt(s, [{ type: 'stopAudio' }]);
        return [{ ...p, hints: p.hints + 1 }, eff];
      }
      if (s.phase !== 'prompt') return [s, []];
      return [{ ...s, hints: s.hints + 1 }, []];
    }

    case 'reveal': {
      if (s.mode === 'audio' || !def.graded) return [s, []];
      if (s.phase !== 'context' && s.phase !== 'cue' && s.phase !== 'prompt') return [s, []];
      const step = currentStep(s);
      const order = step?.kind === 'order' ? { ...s.order, gaveUp: s.order.placed.length < step.pieces.length } : s.order;
      return enterRevealed({ ...s, order });
    }

    case 'grade': {
      if (s.phase !== 'revealed' || !def.graded) return [s, []];
      const step = currentStep(s);
      if (!step) return [s, []];
      const hinted = s.hints > 0;
      const rating = def.affectsFsrs ? capGrade(a.rating, hinted) : a.rating;
      const persist: Effect = {
        type: 'persistGrade',
        stepIndex: s.index,
        step,
        rating,
        hinted,
        durationMs: Math.max(0, a.now - s.stepStartedAt),
        attempt: s.attempt,
      };
      const graded = { ...s.graded, [s.index]: 'pending' as const };
      if (def.repeatOnAgain && rating === 'again') {
        const [n, eff] = enterStep({ ...s, graded }, s.index, a.now, s.attempt + 1);
        return [n, [persist, ...eff]];
      }
      const [n, eff] = enterStep({ ...s, graded }, s.index + 1, a.now);
      return [n, [persist, ...eff]];
    }

    case 'gradeSaved': {
      const cur = s.graded[a.stepIndex];
      if (cur === 'undo') {
        const graded = { ...s.graded };
        delete graded[a.stepIndex];
        return [{ ...s, graded }, [{ type: 'undoGrade', reviewId: a.reviewId }]];
      }
      return [{ ...s, graded: { ...s.graded, [a.stepIndex]: a.reviewId } }, []];
    }

    case 'next': {
      if (s.phase === 'done') return [s, []];
      if (s.mode !== 'audio' && (s.phase === 'context' || s.phase === 'cue')) return enterPrompt(s, [{ type: 'stopAudio' }]);
      return enterStep(s, s.index + 1, a.now);
    }

    case 'back': {
      const target = Math.max(0, (s.phase === 'done' ? s.steps.length : s.index) - 1);
      if (!s.steps.length) return [s, []];
      const graded = { ...s.graded };
      const effects: Effect[] = [];
      const g = graded[target];
      if (typeof g === 'number') {
        effects.push({ type: 'undoGrade', reviewId: g });
        delete graded[target];
      } else if (g === 'pending') {
        graded[target] = 'undo';
      }
      const [n, eff] = enterStep({ ...s, graded }, target, a.now);
      return [n, [...effects, ...eff]];
    }

    case 'orderPick': {
      const step = currentStep(s);
      if (step?.kind !== 'order' || s.phase !== 'prompt') return [s, []];
      if (s.order.placed.includes(a.pieceId)) return [s, []];
      const expected = step.pieces[s.order.placed.length];
      if (expected?.id !== a.pieceId) {
        return [{ ...s, order: { ...s.order, mistakes: s.order.mistakes + 1, wrong: a.pieceId } }, []];
      }
      const order = { ...s.order, placed: [...s.order.placed, a.pieceId], wrong: null };
      if (order.placed.length === step.pieces.length) return enterRevealed({ ...s, order });
      return [{ ...s, order }, []];
    }

    case 'typeInput':
      if (s.phase === 'done' || s.phase === 'revealed') return [s, []];
      return [{ ...s, typed: a.text, ...(s.phase !== 'prompt' ? { phase: 'prompt' as const, audio: null, token: s.token + 1 } : {}) }, s.phase !== 'prompt' ? [{ type: 'stopAudio' }] : []];

    case 'togglePause':
      if (s.phase === 'done') return [s, []];
      return s.paused ? [{ ...s, paused: false }, [{ type: 'resumeAudio' }]] : [{ ...s, paused: true }, [{ type: 'pauseAudio' }]];
  }
}

/** Оценка для головоломки «Порядок» по числу ошибок. */
export function orderSuggestion(o: OrderState): Grade3 {
  if (o.gaveUp || o.mistakes > 2) return 'again';
  return o.mistakes === 0 ? 'good' : 'hard';
}
