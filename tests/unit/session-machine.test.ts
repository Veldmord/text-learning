import { describe, expect, it } from 'vitest';
import type { ModeId } from '../../src/engine/modes';
import type { Step } from '../../src/engine/modes/steps';
import { awaitsMine, initialState, onPartner, reduce, type Effect, type SessionAction, type SessionState } from '../../src/engine/session-machine';

const mine = (...ids: string[]): Step[] => ids.map((id) => ({ itemId: id as `L${string}`, mine: true }));
/** «L0001* L0002»: со звёздочкой — своя реплика */
const flow = (spec: string): Step[] => spec.split(' ').map((t) => ({ itemId: t.replace('*', '') as `L${string}`, mine: t.endsWith('*') }));

function run(mode: ModeId, steps: Step[], opts: Parameters<typeof initialState>[1] = { autoAdvance: true, echo: false }) {
  let state: SessionState = initialState(mode, opts);
  let effects: Effect[] = [];
  const d = (a: SessionAction) => {
    [state, effects] = reduce(state, a);
    return effects;
  };
  d({ type: 'start', steps, index: 0, now: 0 });
  return {
    d,
    get s() {
      return state;
    },
    get e() {
      return effects;
    },
    endAudio: (now = 1) => d({ type: 'audioEnded', token: state.token, now }),
    leaves: () => effects.filter((e) => e.type === 'leave'),
  };
}

describe('Первые буквы: Context → Cue → Prompt → Revealed', () => {
  it('проходит полный шаг', () => {
    const m = run('letters', mine('L0001', 'L0002'));
    expect(m.s.phase).toBe('context');
    expect(m.e).toContainEqual({ type: 'play', phase: 'context', token: m.s.token });
    expect(m.e).toContainEqual({ type: 'saveCursor', stepIndex: 0 });
    expect(m.leaves()).toEqual([]);
    m.endAudio();
    expect(m.s.phase).toBe('cue');
    m.endAudio();
    expect(m.s).toMatchObject({ phase: 'prompt', seen: ['L0001'] });
    m.d({ type: 'reveal' });
    expect(m.s.phase).toBe('revealed');
    m.d({ type: 'next', now: 5000 });
    expect(m.s).toMatchObject({ index: 1, phase: 'context' });
    expect(m.leaves()).toEqual([
      { type: 'leave', mode: 'letters', step: mine('L0001')[0], next: mine('L0002')[0], ms: 5000, said: true, forward: true },
    ]);
  });

  it('без автоперехода ждёт тап после подсказки', () => {
    const m = run('letters', mine('L0001'), { autoAdvance: false, echo: false });
    m.endAudio();
    m.endAudio();
    expect(m.s).toMatchObject({ phase: 'cue', cueDone: true });
    m.d({ type: 'tapCue' });
    expect(m.s.phase).toBe('prompt');
  });

  it('игнорирует устаревшие события аудио', () => {
    const m = run('letters', mine('L0001'));
    const stale = m.s.token;
    m.d({ type: 'next', now: 1 });
    expect(m.s.phase).toBe('prompt');
    m.d({ type: 'audioEnded', token: stale, now: 2 });
    expect(m.s.phase).toBe('prompt');
  });

  it('«Суфлёр» открывает слова до «Открыть»', () => {
    const m = run('letters', mine('L0001'));
    m.d({ type: 'hint' });
    expect(m.s).toMatchObject({ phase: 'prompt', hints: 1 });
    m.d({ type: 'hint' });
    m.d({ type: 'reveal' });
    m.d({ type: 'hint' });
    expect(m.s.hints).toBe(2);
  });

  it('«Далее» пропускает звук, открывает реплику, затем ведёт дальше', () => {
    const m = run('letters', mine('L0001', 'L0002'));
    m.d({ type: 'next', now: 1 });
    expect(m.s).toMatchObject({ phase: 'prompt', index: 0 });
    m.d({ type: 'next', now: 2 });
    expect(m.s).toMatchObject({ phase: 'revealed', index: 0 });
    m.d({ type: 'next', now: 3 });
    expect(m.s).toMatchObject({ phase: 'context', index: 1 });
  });

  it('пропуск до своей очереди не засчитывает реплику', () => {
    const m = run('run', mine('L0001', 'L0002'));
    m.d({ type: 'jump', index: 1, now: 7 });
    expect(m.leaves()).toEqual([{ type: 'leave', mode: 'run', step: mine('L0001')[0], next: null, ms: 7, said: false, forward: false }]);
    expect(m.s.seen).toEqual([]);
  });

  it('конец диапазона: курсор удаляется, последний шаг уходит вперёд без следующего', () => {
    const m = run('letters', mine('L0001', 'L0002'));
    m.d({ type: 'next', now: 1 });
    m.d({ type: 'next', now: 1 });
    m.d({ type: 'next', now: 1 });
    m.d({ type: 'reveal' });
    m.d({ type: 'next', now: 3 });
    expect(m.s.phase).toBe('done');
    expect(m.e).toContainEqual({ type: 'finished' });
    expect(m.e).toContainEqual({ type: 'saveCursor', stepIndex: null });
    expect(m.leaves()[0]).toMatchObject({ next: null, forward: true, said: true });
    expect(m.d({ type: 'next', now: 4 })).toEqual([]);
    expect(m.d({ type: 'togglePause' })).toEqual([]);
    expect(m.d({ type: 'replayCue' })).toEqual([]);
    expect(m.d({ type: 'restart', now: 5 })).toEqual([]);
  });

  it('«Назад» возвращает к предыдущей реплике, на первом шаге и после конца', () => {
    const m = run('letters', mine('L0001', 'L0002'));
    m.d({ type: 'back', now: 1 });
    expect(m.s.index).toBe(0);
    expect(m.leaves()[0]).toMatchObject({ forward: false });
    m.d({ type: 'jump', index: 1, now: 1 });
    m.d({ type: 'reveal' });
    m.d({ type: 'next', now: 1 });
    expect(m.s.phase).toBe('done');
    m.d({ type: 'back', now: 2 });
    expect(m.s.index).toBe(1);
  });

  it('эхо после «Открыть»', () => {
    const m = run('letters', mine('L0001'), { autoAdvance: true, echo: true });
    m.d({ type: 'reveal' });
    expect(m.s.audio).toBe('echo');
    expect(m.e).toContainEqual({ type: 'play', phase: 'echo', token: m.s.token });
    m.endAudio();
    expect(m.s).toMatchObject({ phase: 'revealed', audio: null });
  });

  it('повтор подсказки не сбрасывает открытые слова и не прячет открытую реплику', () => {
    const m = run('letters', mine('L0001'));
    m.d({ type: 'hint' });
    m.d({ type: 'replayCue' });
    expect(m.s).toMatchObject({ hints: 1, audio: 'cue', phase: 'prompt' });
    expect(m.e).toContainEqual({ type: 'play', phase: 'cue', token: m.s.token });
    m.d({ type: 'reveal' });
    m.d({ type: 'replayCue' });
    m.endAudio();
    expect(m.s).toMatchObject({ phase: 'revealed', audio: null });
  });

  it('смена режима на лету сохраняет позицию и засчитывает время', () => {
    const m = run('letters', mine('L0001', 'L0002'));
    m.d({ type: 'setMode', mode: 'run', steps: mine('L0001', 'L0002'), index: 1, now: 4 });
    expect(m.s).toMatchObject({ mode: 'run', index: 1, phase: 'context' });
    expect(m.leaves()).toEqual([{ type: 'leave', mode: 'letters', step: mine('L0001')[0], next: null, ms: 4, said: false, forward: false }]);
    m.d({ type: 'setOptions', echo: true });
    expect(m.s.echo).toBe(true);
  });

  it('«Начать заново» повторяет шаг, но помнит, до каких реплик дошла очередь', () => {
    const m = run('letters', mine('L0001'));
    m.d({ type: 'reveal' });
    m.d({ type: 'restart', now: 2 });
    expect(m.s).toMatchObject({ index: 0, phase: 'context', seen: ['L0001'] });
    m.d({ type: 'start', steps: mine('L0001'), index: 0, now: 3 });
    expect(m.s.seen).toEqual([]);
  });
});

describe('Прогон: все реплики по очереди', () => {
  it('реплика партнёра звучит и сама ведёт к следующей, на своей — остановка', () => {
    const m = run('run', flow('L0001 L0002 L0003*'));
    expect(onPartner(m.s)).toBe(true);
    m.endAudio(10);
    expect(m.s).toMatchObject({ index: 0, phase: 'cue' });
    m.endAudio(20);
    expect(m.s).toMatchObject({ index: 1, phase: 'context' });
    expect(m.leaves()).toEqual([{ type: 'leave', mode: 'run', step: flow('L0001')[0], next: flow('L0002')[0], ms: 20, said: false, forward: true }]);
    m.endAudio();
    m.endAudio();
    expect(m.s).toMatchObject({ index: 2, phase: 'context' });
    m.endAudio();
    m.endAudio();
    expect(m.s).toMatchObject({ index: 2, phase: 'prompt', seen: ['L0003'] });
    expect(onPartner(m.s)).toBe(false);
  });

  it('на реплике партнёра «Далее» переходит к следующей, «Открыть» и «Суфлёр» не действуют', () => {
    const m = run('run', flow('L0001 L0002*'));
    expect(m.d({ type: 'reveal' })).toEqual([]);
    expect(m.d({ type: 'hint' })).toEqual([]);
    expect(m.d({ type: 'tapCue' })).toEqual([]);
    m.d({ type: 'next', now: 1 });
    expect(m.s).toMatchObject({ index: 1, phase: 'context' });
    m.d({ type: 'next', now: 2 });
    expect(m.s).toMatchObject({ index: 1, phase: 'prompt' });
  });

  it('пауза на реплике партнёра держит прогон', () => {
    const m = run('run', flow('L0001 L0002*'));
    m.endAudio();
    expect(m.d({ type: 'togglePause' })).toEqual([{ type: 'pauseAudio' }]);
    m.endAudio();
    expect(m.s).toMatchObject({ index: 0, paused: true });
    expect(m.d({ type: 'togglePause' })).toEqual([{ type: 'resumeAudio' }]);
    m.endAudio();
    expect(m.s.index).toBe(1);
  });

  it('«Назад» со своей реплики снова играет реплику партнёра, переход по навигации', () => {
    const m = run('run', flow('L0001 L0002* L0003'));
    m.d({ type: 'jump', index: 1, now: 1 });
    m.endAudio();
    m.endAudio();
    expect(m.s.phase).toBe('prompt');
    m.d({ type: 'back', now: 2 });
    expect(m.s).toMatchObject({ index: 0, phase: 'context', audio: 'context' });
    m.d({ type: 'jump', index: 99, now: 3 });
    expect(m.s.index).toBe(2);
    m.d({ type: 'jump', index: -5, now: 4 });
    expect(m.s.index).toBe(0);
  });
});

describe('Аудиопрогон', () => {
  it('партнёр → тишина → эхо → следующая реплика', () => {
    const m = run('audio', mine('L0001', 'L0002'), { autoAdvance: false, echo: true });
    m.endAudio();
    m.endAudio();
    expect(m.s).toMatchObject({ phase: 'prompt', audio: 'silence' });
    expect(m.e).toContainEqual({ type: 'play', phase: 'silence', token: m.s.token });
    m.endAudio();
    expect(m.s).toMatchObject({ phase: 'revealed', audio: 'echo' });
    m.endAudio();
    expect(m.s).toMatchObject({ index: 1, phase: 'context' });
    expect(m.leaves()[0]).toMatchObject({ said: true, forward: true });
    expect(m.d({ type: 'reveal' })).toEqual([]);
    expect(m.d({ type: 'hint' })).toEqual([]);
  });

  it('«Вся пьеса»: на своей реплике звук стоит до «Продолжить»', () => {
    const m = run('audio', mine('L0001', 'L0002'), { autoAdvance: true, echo: false, waitOnMine: true });
    m.endAudio();
    m.endAudio();
    expect(m.s).toMatchObject({ phase: 'prompt', audio: null });
    expect(m.e.some((e) => e.type === 'play')).toBe(false);
    expect(awaitsMine(m.s)).toBe(true);
    m.d({ type: 'proceed', now: 1 });
    expect(m.s).toMatchObject({ index: 1, phase: 'context' });
    expect(m.d({ type: 'proceed', now: 2 })).toEqual([]);
  });

  it('«Вся пьеса» с эхом: «Продолжить» озвучивает свою реплику, потом идёт дальше', () => {
    const m = run('audio', mine('L0001', 'L0002'), { autoAdvance: true, echo: true, waitOnMine: true });
    m.endAudio();
    m.endAudio();
    m.d({ type: 'proceed', now: 1 });
    expect(m.s).toMatchObject({ index: 0, phase: 'revealed', audio: 'echo' });
    expect(m.e).toContainEqual({ type: 'play', phase: 'echo', token: m.s.token });
    m.endAudio();
    expect(m.s).toMatchObject({ index: 1, phase: 'context' });
  });

  it('вариант аудиопрогона переключается на лету', () => {
    const m = run('audio', mine('L0001'));
    m.d({ type: 'setOptions', waitOnMine: true });
    m.endAudio();
    m.endAudio();
    expect(awaitsMine(m.s)).toBe(true);
    expect(awaitsMine(run('letters', mine('L0001')).s)).toBe(false);
  });

  it('без эха сразу следующая; «Далее» всегда переходит к следующей', () => {
    const m = run('audio', mine('L0001', 'L0002', 'L0003'), { autoAdvance: true, echo: false });
    m.endAudio();
    m.endAudio();
    m.endAudio();
    expect(m.s.index).toBe(1);
    m.d({ type: 'next', now: 1 });
    expect(m.s.index).toBe(2);
  });

  it('пауза и продолжение', () => {
    const m = run('audio', mine('L0001'));
    expect(m.d({ type: 'togglePause' })).toEqual([{ type: 'pauseAudio' }]);
    m.endAudio();
    expect(m.s.phase).toBe('context');
    expect(m.d({ type: 'togglePause' })).toEqual([{ type: 'resumeAudio' }]);
    m.endAudio();
    expect(m.s.phase).toBe('cue');
  });
});

describe('пустая сессия', () => {
  it('без шагов сразу конец, навигация ничего не делает', () => {
    const m = run('run', []);
    expect(m.s.phase).toBe('done');
    expect(m.d({ type: 'back', now: 1 })).toEqual([]);
    expect(m.d({ type: 'jump', index: 0, now: 1 })).toEqual([]);
    expect(m.d({ type: 'audioEnded', token: m.s.token, now: 1 })).toEqual([]);
  });
});
