import { describe, expect, it } from 'vitest';
import { isModeId, MODES, RUN_FLOWS, TRAIN_MODES } from '../../src/engine/modes';
import { hiddenWordCount, linePieces, piecesText } from '../../src/engine/modes/render';
import { buildSteps, findStepIndex, hasMine, type BuildStepsInput } from '../../src/engine/modes/steps';
import { getLine, parseScope } from '../../src/engine/queries';
import { miniPlay } from './fixtures';

describe('реестр режимов', () => {
  it('три режима тренировки и два хода прогона', () => {
    expect(TRAIN_MODES).toEqual(['run', 'letters', 'audio']);
    expect(Object.keys(MODES).sort()).toEqual(['audio', 'letters', 'run']);
    expect(Object.keys(RUN_FLOWS)).toEqual(['all', 'mine']);
    expect(isModeId('run')).toBe(true);
    // Режимы прежних версий больше не существуют
    for (const old of ['cue', 'vanish', 'chunks', 'weak', 'order', 'type', 'read']) expect(isModeId(old)).toBe(false);
    expect(isModeId('toString')).toBe(false);
    expect(isModeId(undefined)).toBe(false);
  });
});

describe('шаги сессии', () => {
  const { index } = miniPlay();
  const steps = (over: Partial<BuildStepsInput>) =>
    buildSteps({ index, mode: 'run', roles: ['a'], scope: parseScope('all'), runFlow: 'all', skipScenesWithoutRole: true, ...over });
  const ids = (s: ReturnType<typeof steps>) => s.map((x) => `${x.itemId}${x.mine ? '*' : ''}`);

  it('первые буквы, аудиопрогон и «сразу к моим» — только свои реплики диапазона', () => {
    for (const over of [{ mode: 'letters' as const }, { mode: 'audio' as const }, { runFlow: 'mine' as const }]) {
      expect(ids(steps({ ...over, scope: parseScope('a1') }))).toEqual(['L0001*', 'L0004*']);
    }
  });

  it('«все реплики по очереди» — каждая реплика диапазона, сцены без роли по настройке', () => {
    expect(ids(steps({ scope: parseScope('a1') }))).toEqual(['L0001*', 'L0002', 'L0003', 'L0004*']);
    expect(ids(steps({ scope: parseScope('a1'), skipScenesWithoutRole: false }))).toEqual(['L0001*', 'L0002', 'L0003', 'L0004*', 'L0005']);
    expect(ids(steps({ scope: parseScope('L0002-L0004') }))).toEqual(['L0002', 'L0003', 'L0004*']);
    expect(ids(steps({}))).toEqual(['L0001*', 'L0002', 'L0003', 'L0004*', 'L0006', 'L0007*', 'L0008', 'L0009*']);
  });

  it('без своих реплик тренировать нечего', () => {
    expect(hasMine(steps({ roles: ['c'], scope: parseScope('a1s01') }))).toBe(false);
    expect(hasMine(steps({ roles: ['c'], scope: parseScope('a1s01'), skipScenesWithoutRole: false }))).toBe(false);
    expect(hasMine(steps({}))).toBe(true);
  });

  it('продолжение и навигация: точная реплика или следующая по тексту', () => {
    const mine = steps({ mode: 'letters' });
    expect(findStepIndex(mine, index, 'L0007')).toBe(2);
    expect(findStepIndex(mine, index, 'L0005')).toBe(2);
    expect(findStepIndex(mine, index, 'D0003')).toBe(2);
    expect(findStepIndex(mine, index, undefined)).toBe(0);
    expect(findStepIndex(mine, index, null)).toBe(0);
    expect(findStepIndex(mine, index, 'L9999')).toBe(0);
    expect(findStepIndex(mine, index, 'L0009')).toBe(3);
    const all = steps({});
    expect(findStepIndex(all, index, 'L0003')).toBe(2);
    expect(findStepIndex(all, index, 'L0005')).toBe(4);
  });
});

describe('показ своей реплики', () => {
  const { index } = miniPlay();
  const l1 = getLine(index, 'L0001')!;
  const base = { revealed: false, hints: 0, showAsides: true };

  it('первые буквы с пунктуацией, ремарки — по настройке', () => {
    expect(piecesText(linePieces(l1, base))).toBe('(Тихо.) Т п? Я ж.');
    expect(piecesText(linePieces(l1, { ...base, showAsides: false }))).toBe('Т п? Я ж.');
    expect(hiddenWordCount(linePieces(l1, base))).toBe(4);
  });

  it('«Суфлёр» открывает слова по порядку', () => {
    const p = linePieces(l1, { ...base, hints: 2 });
    expect(p.filter((x) => x.kind === 'hint').map((x) => x.text)).toEqual(['Ты', 'пришёл']);
    expect(hiddenWordCount(p)).toBe(2);
  });

  it('«Открыть» показывает реплику целиком', () => {
    const p = linePieces(l1, { ...base, revealed: true, hints: 1 });
    expect(piecesText(p)).toBe('(Тихо.) Ты пришёл? Я ждала.');
    expect(hiddenWordCount(p)).toBe(0);
  });
});
