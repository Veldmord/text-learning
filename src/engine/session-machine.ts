// Машина состояний сессии — docs/ARCHITECTURE.md, раздел 7.3.
// Чистый reducer: (состояние, действие) → (новое состояние, эффекты). Эффекты исполняет SessionRunner.
import type { ModeId } from './modes';
import type { Step } from './modes/steps';

export type Phase = 'context' | 'cue' | 'prompt' | 'revealed' | 'done';
export type AudioPhase = 'context' | 'cue' | 'silence' | 'echo';

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
  /** Свои реплики, до которых в этой сессии дошла очередь актёра */
  seen: string[];
  paused: boolean;
  autoAdvance: boolean;
  echo: boolean;
  /** Аудиопрогон «Вся пьеса»: на своей реплике звук останавливается до «Продолжить» */
  waitOnMine: boolean;
  /** Защита от устаревших событий аудио: растёт при каждом переходе */
  token: number;
  /** Что сейчас звучит */
  audio: AudioPhase | null;
}

export type SessionAction =
  | { type: 'start'; steps: Step[]; index: number; now: number; mode?: ModeId }
  | { type: 'restart'; now: number }
  | { type: 'audioEnded'; token: number; now: number }
  | { type: 'tapCue' }
  | { type: 'hint' }
  | { type: 'reveal' }
  | { type: 'next'; now: number }
  | { type: 'back'; now: number }
  | { type: 'jump'; index: number; now: number }
  | { type: 'setMode'; mode: ModeId; steps: Step[]; index: number; now: number }
  | { type: 'togglePause' }
  | { type: 'proceed'; now: number }
  | { type: 'setOptions'; autoAdvance?: boolean; echo?: boolean; waitOnMine?: boolean }
  | { type: 'replayCue' };

/** Уход с шага: время на шаге, сказана ли своя реплика, шаг вперёд по тексту — для журнала сессии. */
export interface LeaveEffect {
  type: 'leave';
  mode: ModeId;
  step: Step;
  /** Следующий шаг при ходе вперёд; null — сессия закончилась */
  next: Step | null;
  ms: number;
  /** Своя реплика дошла до очереди актёра */
  said: boolean;
  /** Обычный ход вперёд: «Далее», автопереход. Назад, навигация и смена режима — нет. */
  forward: boolean;
}

export type Effect =
  | { type: 'stopAudio' }
  | { type: 'pauseAudio' }
  | { type: 'resumeAudio' }
  | { type: 'play'; phase: AudioPhase; token: number }
  | { type: 'saveCursor'; stepIndex: number | null }
  | LeaveEffect
  | { type: 'finished' };

export type Transition = [SessionState, Effect[]];

export function initialState(mode: ModeId, opts: { autoAdvance: boolean; echo: boolean; waitOnMine?: boolean }): SessionState {
  return {
    mode,
    steps: [],
    index: 0,
    phase: 'done',
    cueDone: false,
    hints: 0,
    stepStartedAt: 0,
    seen: [],
    paused: false,
    autoAdvance: opts.autoAdvance,
    echo: opts.echo,
    waitOnMine: opts.waitOnMine ?? false,
    token: 0,
    audio: null,
  };
}

export const currentStep = (s: SessionState): Step | undefined => s.steps[s.index];

/** Аудиопрогон остановился на своей реплике и ждёт «Продолжить». */
export const awaitsMine = (s: SessionState): boolean => s.mode === 'audio' && s.phase === 'prompt' && s.audio === null;

/** Сейчас звучит реплика партнёра в «Прогоне: все реплики по очереди». */
export const onPartner = (s: SessionState): boolean => s.phase !== 'done' && currentStep(s)?.mine === false;

/** Уход с текущего шага; пусто, если шага нет или сессия закончилась. */
export function leave(s: SessionState, now: number, forward: boolean): LeaveEffect[] {
  const step = currentStep(s);
  if (!step || s.phase === 'done') return [];
  return [
    {
      type: 'leave',
      mode: s.mode,
      step,
      next: forward ? (s.steps[s.index + 1] ?? null) : null,
      ms: Math.max(0, now - s.stepStartedAt),
      said: step.mine && (s.phase === 'prompt' || s.phase === 'revealed'),
      forward,
    },
  ];
}

function enterStep(s: SessionState, index: number, now: number, before: Effect[] = []): Transition {
  const token = s.token + 1;
  if (index >= s.steps.length) {
    return [
      { ...s, index: s.steps.length, phase: 'done', audio: null, token, paused: false },
      [...before, { type: 'stopAudio' }, { type: 'saveCursor', stepIndex: null }, { type: 'finished' }],
    ];
  }
  // Каждый шаг начинается с контекста: пустая очередь доигрывается сразу
  const next: SessionState = { ...s, index, phase: 'context', cueDone: false, hints: 0, stepStartedAt: now, token, paused: false, audio: 'context' };
  return [next, [...before, { type: 'stopAudio' }, { type: 'saveCursor', stepIndex: index }, { type: 'play', phase: 'context', token }]];
}

const markSeen = (s: SessionState): string[] => {
  const id = currentStep(s)?.itemId;
  return id && !s.seen.includes(id) ? [...s.seen, id] : s.seen;
};

/** Переход к своей реплике. В аудиопрогоне на ней звучит тишина длиной ≈ реплика × k или прогон ждёт «Продолжить». */
function enterPrompt(s: SessionState, effects: Effect[] = []): Transition {
  const token = s.token + 1;
  const seen = markSeen(s);
  if (s.mode === 'audio' && !s.waitOnMine) {
    return [{ ...s, phase: 'prompt', cueDone: true, token, seen, audio: 'silence' }, [...effects, { type: 'play', phase: 'silence', token }]];
  }
  return [{ ...s, phase: 'prompt', cueDone: true, token, seen, audio: null }, effects];
}

function enterRevealed(s: SessionState, effects: Effect[] = []): Transition {
  const token = s.token + 1;
  const next: SessionState = { ...s, phase: 'revealed', token, seen: markSeen(s), audio: s.echo ? 'echo' : null };
  return [next, s.echo ? [...effects, { type: 'stopAudio' }, { type: 'play', phase: 'echo', token }] : [...effects, { type: 'stopAudio' }]];
}

const clampIndex = (i: number, steps: Step[]) => Math.min(Math.max(i, 0), steps.length);

export function reduce(s: SessionState, a: SessionAction): Transition {
  const step = currentStep(s);
  switch (a.type) {
    case 'start':
      return enterStep({ ...s, mode: a.mode ?? s.mode, steps: a.steps, seen: [] }, clampIndex(a.index, a.steps), a.now);

    case 'restart':
      if (s.phase === 'done') return [s, []];
      return enterStep(s, s.index, a.now, leave(s, a.now, false));

    case 'setMode':
      return enterStep({ ...s, mode: a.mode, steps: a.steps }, clampIndex(a.index, a.steps), a.now, leave(s, a.now, false));

    case 'setOptions':
      return [{ ...s, autoAdvance: a.autoAdvance ?? s.autoAdvance, echo: a.echo ?? s.echo, waitOnMine: a.waitOnMine ?? s.waitOnMine }, []];

    case 'audioEnded': {
      if (a.token !== s.token || s.paused || !step) return [s, []];
      if (s.audio === 'context') {
        const token = s.token + 1;
        return [{ ...s, phase: 'cue', token, audio: 'cue' }, [{ type: 'play', phase: 'cue', token }]];
      }
      if (s.audio === 'cue') {
        // Реплика партнёра доиграла — сцена идёт дальше сама
        if (!step.mine) return enterStep(s, s.index + 1, a.now, leave(s, a.now, true));
        // Повтор подсказки не прячет уже показанную реплику
        if (s.phase === 'prompt' || s.phase === 'revealed') return [{ ...s, audio: null }, []];
        if (s.autoAdvance || s.mode === 'audio') return enterPrompt(s);
        return [{ ...s, cueDone: true, audio: null }, []];
      }
      if (s.audio === 'silence') {
        if (s.echo) {
          const token = s.token + 1;
          return [{ ...s, phase: 'revealed', token, audio: 'echo' }, [{ type: 'play', phase: 'echo', token }]];
        }
        return enterStep(s, s.index + 1, a.now, leave(s, a.now, true));
      }
      if (s.audio === 'echo') {
        if (s.mode === 'audio') return enterStep(s, s.index + 1, a.now, leave(s, a.now, true));
        return [{ ...s, audio: null }, []];
      }
      return [s, []];
    }

    case 'replayCue': {
      if (s.phase === 'done') return [s, []];
      const token = s.token + 1;
      // Повтор подсказки не сбрасывает открытые слова
      return [
        { ...s, token, paused: false, audio: 'cue', phase: s.phase === 'context' ? 'cue' : s.phase },
        [{ type: 'stopAudio' }, { type: 'play', phase: 'cue', token }],
      ];
    }

    case 'tapCue':
      if (!step?.mine || (s.phase !== 'context' && s.phase !== 'cue')) return [s, []];
      return enterPrompt(s, [{ type: 'stopAudio' }]);

    case 'hint': {
      if (s.mode === 'audio' || !step?.mine) return [s, []];
      if (s.phase === 'context' || s.phase === 'cue') {
        const [p, eff] = enterPrompt(s, [{ type: 'stopAudio' }]);
        return [{ ...p, hints: p.hints + 1 }, eff];
      }
      if (s.phase !== 'prompt') return [s, []];
      return [{ ...s, hints: s.hints + 1 }, []];
    }

    case 'reveal':
      if (s.mode === 'audio' || !step?.mine) return [s, []];
      if (s.phase !== 'context' && s.phase !== 'cue' && s.phase !== 'prompt') return [s, []];
      return enterRevealed(s);

    case 'next': {
      if (s.phase === 'done' || !step) return [s, []];
      // На своей реплике «Далее» пропускает звук → открывает реплику → ведёт дальше
      if (step.mine && s.mode !== 'audio') {
        if (s.phase === 'context' || s.phase === 'cue') return enterPrompt(s, [{ type: 'stopAudio' }]);
        if (s.phase === 'prompt') return enterRevealed(s);
      }
      return enterStep(s, s.index + 1, a.now, leave(s, a.now, true));
    }

    case 'back': {
      if (!s.steps.length) return [s, []];
      const target = Math.max(0, (s.phase === 'done' ? s.steps.length : s.index) - 1);
      return enterStep(s, target, a.now, leave(s, a.now, false));
    }

    case 'jump':
      if (!s.steps.length) return [s, []];
      return enterStep(s, Math.min(Math.max(a.index, 0), s.steps.length - 1), a.now, leave(s, a.now, false));

    case 'proceed': {
      if (!awaitsMine(s)) return [s, []];
      if (!s.echo) return enterStep(s, s.index + 1, a.now, leave(s, a.now, true));
      const token = s.token + 1;
      return [{ ...s, phase: 'revealed', token, audio: 'echo' }, [{ type: 'play', phase: 'echo', token }]];
    }

    case 'togglePause':
      if (s.phase === 'done') return [s, []];
      return s.paused ? [{ ...s, paused: false }, [{ type: 'resumeAudio' }]] : [{ ...s, paused: true }, [{ type: 'pauseAudio' }]];
  }
}
