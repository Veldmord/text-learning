import { describe, expect, it } from 'vitest';
import type { ModeId } from '../../src/engine/modes';
import type { Step } from '../../src/engine/modes/steps';
import {
  awaitsMine,
  initialState,
  orderSuggestion,
  reduce,
  stepPlaysCue,
  type Effect,
  type SessionAction,
  type SessionState,
} from '../../src/engine/session-machine';

const lines = (...ids: string[]): Step[] => ids.map((id) => ({ kind: 'line', lineId: id as `L${string}` }));

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
    endAudio: () => d({ type: 'audioEnded', token: state.token, now: 1 }),
  };
}

describe('По репликам: Context → Cue → Prompt → Revealed → Graded', () => {
  it('проходит полный шаг и пишет оценку', () => {
    const m = run('cue', lines('L0001', 'L0002'));
    expect(m.s.phase).toBe('context');
    expect(m.e).toContainEqual({ type: 'play', phase: 'context', token: m.s.token });
    expect(m.e).toContainEqual({ type: 'saveCursor', stepIndex: 0 });
    m.endAudio();
    expect(m.s.phase).toBe('cue');
    m.endAudio();
    expect(m.s.phase).toBe('prompt');
    m.d({ type: 'reveal' });
    expect(m.s.phase).toBe('revealed');
    const eff = m.d({ type: 'grade', rating: 'good', now: 5000 });
    expect(eff[0]).toMatchObject({ type: 'persistGrade', stepIndex: 0, rating: 'good', hinted: false, durationMs: 5000 });
    expect(m.s.index).toBe(1);
    expect(m.s.graded[0]).toBe('pending');
    m.d({ type: 'gradeSaved', stepIndex: 0, reviewId: 42 });
    expect(m.s.graded[0]).toBe(42);
  });

  it('без автоперехода ждёт тап после подсказки', () => {
    const m = run('cue', lines('L0001'), { autoAdvance: false, echo: false });
    m.endAudio();
    m.endAudio();
    expect(m.s).toMatchObject({ phase: 'cue', cueDone: true });
    m.d({ type: 'tapCue' });
    expect(m.s.phase).toBe('prompt');
  });

  it('игнорирует устаревшие события аудио', () => {
    const m = run('cue', lines('L0001'));
    const stale = m.s.token;
    m.d({ type: 'next', now: 1 });
    expect(m.s.phase).toBe('prompt');
    m.d({ type: 'audioEnded', token: stale, now: 2 });
    expect(m.s.phase).toBe('prompt');
  });

  it('«Суфлёр» снижает максимальную оценку до «С ошибкой»', () => {
    const m = run('cue', lines('L0001'));
    m.d({ type: 'hint' });
    expect(m.s).toMatchObject({ phase: 'prompt', hints: 1 });
    m.d({ type: 'hint' });
    m.d({ type: 'reveal' });
    m.d({ type: 'hint' });
    expect(m.s.hints).toBe(2);
    const eff = m.d({ type: 'grade', rating: 'good', now: 1 });
    expect(eff[0]).toMatchObject({ rating: 'hard', hinted: true });
  });

  it('в режимах с подсказками «Суфлёр» не снижает оценку журнала', () => {
    const m = run('letters', lines('L0001'));
    m.d({ type: 'hint' });
    m.d({ type: 'reveal' });
    expect(m.d({ type: 'grade', rating: 'good', now: 1 })[0]).toMatchObject({ rating: 'good', hinted: true });
  });

  it('прогон с буквами: «Далее» пропускает звук, открывает реплику, затем ведёт дальше без оценки', () => {
    const m = run('run', lines('L0001', 'L0002'));
    expect(m.s.phase).toBe('context');
    m.d({ type: 'next', now: 1 });
    expect(m.s).toMatchObject({ phase: 'prompt', index: 0 });
    m.d({ type: 'next', now: 2 });
    expect(m.s).toMatchObject({ phase: 'revealed', index: 0 });
    const eff = m.d({ type: 'next', now: 3 });
    expect(m.s).toMatchObject({ phase: 'context', index: 1 });
    expect(eff.some((e) => e.type === 'persistGrade')).toBe(false);
  });

  it('оценку нельзя поставить до «Показать»', () => {
    const m = run('cue', lines('L0001'));
    m.endAudio();
    m.endAudio();
    expect(m.d({ type: 'grade', rating: 'good', now: 1 })).toEqual([]);
  });

  it('«Далее» во время подсказки открывает реплику, потом пропускает без оценки', () => {
    const m = run('cue', lines('L0001', 'L0002'));
    m.d({ type: 'next', now: 1 });
    expect(m.s.phase).toBe('prompt');
    const eff = m.d({ type: 'next', now: 2 });
    expect(eff.some((e) => e.type === 'persistGrade')).toBe(false);
    expect(m.s.index).toBe(1);
    m.d({ type: 'next', now: 3 });
    m.d({ type: 'next', now: 3 });
    expect(m.s.phase).toBe('done');
    expect(m.e).toContainEqual({ type: 'finished' });
    expect(m.e).toContainEqual({ type: 'saveCursor', stepIndex: null });
    expect(m.d({ type: 'next', now: 4 })).toEqual([]);
  });

  it('«Назад» возвращает к предыдущей реплике и отменяет её оценку', () => {
    const m = run('cue', lines('L0001', 'L0002', 'L0003'));
    m.d({ type: 'reveal' });
    m.d({ type: 'grade', rating: 'again', now: 1 });
    m.d({ type: 'gradeSaved', stepIndex: 0, reviewId: 7 });
    const eff = m.d({ type: 'back', now: 2 });
    expect(eff[0]).toEqual({ type: 'undoGrade', reviewId: 7 });
    expect(m.s.index).toBe(0);
    expect(m.s.graded[0]).toBeUndefined();
  });

  it('«Назад» до записи оценки отменяет её после записи', () => {
    const m = run('cue', lines('L0001', 'L0002'));
    m.d({ type: 'reveal' });
    m.d({ type: 'grade', rating: 'good', now: 1 });
    m.d({ type: 'back', now: 2 });
    expect(m.s.graded[0]).toBe('undo');
    expect(m.d({ type: 'gradeSaved', stepIndex: 0, reviewId: 9 })).toEqual([{ type: 'undoGrade', reviewId: 9 }]);
    expect(m.s.graded[0]).toBeUndefined();
  });

  it('«Назад» на первом шаге и после конца', () => {
    const m = run('cue', lines('L0001', 'L0002'));
    m.d({ type: 'back', now: 1 });
    expect(m.s.index).toBe(0);
    m.d({ type: 'next', now: 1 });
    m.d({ type: 'next', now: 1 });
    m.d({ type: 'next', now: 1 });
    m.d({ type: 'next', now: 1 });
    expect(m.s.phase).toBe('done');
    m.d({ type: 'back', now: 2 });
    expect(m.s.index).toBe(1);
  });

  it('эхо после «Показать»', () => {
    const m = run('cue', lines('L0001'), { autoAdvance: true, echo: true });
    m.d({ type: 'reveal' });
    expect(m.s.audio).toBe('echo');
    expect(m.e).toContainEqual({ type: 'play', phase: 'echo', token: m.s.token });
    m.endAudio();
    expect(m.s).toMatchObject({ phase: 'revealed', audio: null });
  });

  it('повтор подсказки не сбрасывает открытые слова', () => {
    const m = run('cue', lines('L0001'));
    m.d({ type: 'hint' });
    m.d({ type: 'replayCue' });
    expect(m.s).toMatchObject({ hints: 1, audio: 'cue', phase: 'prompt' });
    expect(m.e).toContainEqual({ type: 'play', phase: 'cue', token: m.s.token });
  });

  it('смена режима на лету сохраняет позицию', () => {
    const m = run('cue', lines('L0001', 'L0002'));
    m.d({ type: 'setMode', mode: 'letters', steps: lines('L0001', 'L0002'), index: 1, now: 1 });
    expect(m.s).toMatchObject({ mode: 'letters', index: 1, phase: 'context' });
    m.d({ type: 'setOptions', echo: true });
    expect(m.s.echo).toBe(true);
  });
});

describe('Монолог по частям', () => {
  const steps: Step[] = [
    { kind: 'chunk', lineId: 'L0001', part: 1, parts: 2, sentenceIdx: [0] },
    { kind: 'chunk', lineId: 'L0001', part: 2, parts: 2, sentenceIdx: [0, 1] },
  ];

  it('подсказка звучит только перед первой частью', () => {
    expect(stepPlaysCue('chunks', steps[0])).toBe(true);
    expect(stepPlaysCue('chunks', steps[1])).toBe(false);
    expect(stepPlaysCue('order', steps[0])).toBe(false);
    expect(stepPlaysCue('cue', undefined)).toBe(false);
  });

  it('«Не знал» повторяет ту же часть', () => {
    const m = run('chunks', steps);
    m.d({ type: 'reveal' });
    const eff = m.d({ type: 'grade', rating: 'again', now: 1 });
    expect(eff[0]).toMatchObject({ type: 'persistGrade', attempt: 0 });
    expect(m.s).toMatchObject({ index: 0, attempt: 1 });
    m.d({ type: 'reveal' });
    m.d({ type: 'grade', rating: 'good', now: 2 });
    expect(m.s).toMatchObject({ index: 1, attempt: 0, phase: 'prompt' });
  });
});

describe('Аудиопрогон', () => {
  it('партнёр → тишина → эхо → следующая реплика без оценок', () => {
    const m = run('audio', lines('L0001', 'L0002'), { autoAdvance: false, echo: true });
    m.endAudio();
    m.endAudio();
    expect(m.s).toMatchObject({ phase: 'prompt', audio: 'silence' });
    expect(m.e).toContainEqual({ type: 'play', phase: 'silence', token: m.s.token });
    m.endAudio();
    expect(m.s).toMatchObject({ phase: 'revealed', audio: 'echo' });
    m.endAudio();
    expect(m.s).toMatchObject({ index: 1, phase: 'context' });
    expect(m.d({ type: 'reveal' })).toEqual([]);
    expect(m.d({ type: 'grade', rating: 'good', now: 1 })).toEqual([]);
  });

  it('«Вся пьеса»: на своей реплике звук стоит до «Продолжить»', () => {
    const m = run('audio', lines('L0001', 'L0002'), { autoAdvance: true, echo: false, waitOnMine: true });
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
    const m = run('audio', lines('L0001', 'L0002'), { autoAdvance: true, echo: true, waitOnMine: true });
    m.endAudio();
    m.endAudio();
    m.d({ type: 'proceed', now: 1 });
    expect(m.s).toMatchObject({ index: 0, phase: 'revealed', audio: 'echo' });
    expect(m.e).toContainEqual({ type: 'play', phase: 'echo', token: m.s.token });
    m.endAudio();
    expect(m.s).toMatchObject({ index: 1, phase: 'context' });
  });

  it('вариант аудиопрогона переключается на лету', () => {
    const m = run('audio', lines('L0001'));
    m.d({ type: 'setOptions', waitOnMine: true });
    m.endAudio();
    m.endAudio();
    expect(awaitsMine(m.s)).toBe(true);
    expect(awaitsMine(run('cue', lines('L0001')).s)).toBe(false);
  });

  it('без эха сразу следующая; «Далее» всегда переходит к следующей', () => {
    const m = run('audio', lines('L0001', 'L0002', 'L0003'), { autoAdvance: true, echo: false });
    m.endAudio();
    m.endAudio();
    m.endAudio();
    expect(m.s.index).toBe(1);
    m.d({ type: 'next', now: 1 });
    expect(m.s.index).toBe(2);
  });

  it('пауза и продолжение', () => {
    const m = run('audio', lines('L0001'));
    expect(m.d({ type: 'togglePause' })).toEqual([{ type: 'pauseAudio' }]);
    m.endAudio();
    expect(m.s.phase).toBe('context');
    expect(m.d({ type: 'togglePause' })).toEqual([{ type: 'resumeAudio' }]);
    m.endAudio();
    expect(m.s.phase).toBe('cue');
  });

  it('без подсказки сразу тишина', () => {
    const m = run('audio', [{ kind: 'order', id: 'x', title: 't', lineId: 'L0001', pieces: [], shuffled: [] }]);
    expect(m.s.audio).toBe('silence');
  });
});

describe('Порядок и письменный ввод', () => {
  const order: Step = {
    kind: 'order',
    id: 'a1s01:1',
    title: 'Сцена',
    lineId: 'L0001',
    pieces: [
      { id: 'L0001', text: 'Раз' },
      { id: 'L0002', text: 'Два' },
    ],
    shuffled: [
      { id: 'L0002', text: 'Два' },
      { id: 'L0001', text: 'Раз' },
    ],
  };

  it('засчитывает правильный порядок и считает ошибки', () => {
    const m = run('order', [order]);
    expect(m.s.phase).toBe('prompt');
    m.d({ type: 'orderPick', pieceId: 'L0002' });
    expect(m.s.order).toMatchObject({ mistakes: 1, wrong: 'L0002' });
    m.d({ type: 'orderPick', pieceId: 'L0001' });
    m.d({ type: 'orderPick', pieceId: 'L0001' });
    expect(m.s.order.placed).toEqual(['L0001']);
    m.d({ type: 'orderPick', pieceId: 'L0002' });
    expect(m.s.phase).toBe('revealed');
    expect(orderSuggestion(m.s.order)).toBe('hard');
    expect(m.d({ type: 'hint' })).toEqual([]);
  });

  it('«Показать» в головоломке — сдаться', () => {
    const m = run('order', [order]);
    m.d({ type: 'reveal' });
    expect(m.s.order.gaveUp).toBe(true);
    expect(orderSuggestion(m.s.order)).toBe('again');
    expect(orderSuggestion({ placed: [], mistakes: 0, wrong: null, gaveUp: false })).toBe('good');
    expect(m.d({ type: 'orderPick', pieceId: 'L0001' })).toEqual([]);
  });

  it('ввод текста прерывает подсказку', () => {
    const m = run('type', lines('L0001'));
    const eff = m.d({ type: 'typeInput', text: 'Ты' });
    expect(eff).toEqual([{ type: 'stopAudio' }]);
    expect(m.s).toMatchObject({ phase: 'prompt', typed: 'Ты' });
    m.d({ type: 'typeInput', text: 'Ты пришёл' });
    expect(m.s.typed).toBe('Ты пришёл');
    m.d({ type: 'reveal' });
    expect(m.d({ type: 'typeInput', text: 'x' })).toEqual([]);
  });
});
