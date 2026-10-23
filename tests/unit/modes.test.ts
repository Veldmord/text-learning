import { describe, expect, it } from 'vitest';
import { applyGrade, newCard, type CardRow } from '../../src/engine/model';
import { isModeId, MODES, TRAIN_MODES } from '../../src/engine/modes';
import { hiddenWordCount, linePieces, piecesText, wordCount } from '../../src/engine/modes/render';
import { buildSteps, findStepIndex, stepLineId } from '../../src/engine/modes/steps';
import { getLine, parseScope } from '../../src/engine/queries';
import { miniPlay, realPlay } from './fixtures';

const NOW = new Date(2026, 10, 1).getTime();

describe('реестр режимов', () => {
  it('FSRS обновляют только режимы со свободным вспоминанием', () => {
    const fsrsModes = Object.values(MODES).filter((m) => m.affectsFsrs).map((m) => m.id);
    expect(fsrsModes.sort()).toEqual(['cue', 'type', 'weak']);
    expect(TRAIN_MODES).not.toContain('read');
    expect(isModeId('cue')).toBe(true);
    expect(isModeId('nope')).toBe(false);
    expect(isModeId(undefined)).toBe(false);
  });
});

describe('шаги сессии', () => {
  it('по репликам — все свои реплики диапазона по порядку', () => {
    const { index } = miniPlay();
    const steps = buildSteps({ index, mode: 'cue', roles: ['a'], scope: parseScope('a1'), cards: new Map(), now: NOW });
    expect(steps.map(stepLineId)).toEqual(['L0001', 'L0004']);
    expect(buildSteps({ index, mode: 'read', roles: ['a'], scope: parseScope(''), cards: new Map(), now: NOW })).toEqual([]);
  });

  it('монолог по частям — только реплики длиннее 40 слов, наращиванием', () => {
    const { index } = realPlay();
    const steps = buildSteps({ index, mode: 'chunks', roles: ['starik'], scope: parseScope('a1s08'), cards: new Map(), now: NOW });
    const monologue = steps.filter((s) => s.lineId === 'L0390');
    expect(monologue.length).toBeGreaterThan(3);
    monologue.forEach((s, i) => {
      expect(s).toMatchObject({ kind: 'chunk', part: i + 1, parts: monologue.length });
      if (i > 0 && s.kind === 'chunk' && monologue[i - 1]!.kind === 'chunk') {
        const prev = monologue[i - 1] as typeof s;
        expect(s.sentenceIdx.slice(0, prev.sentenceIdx.length)).toEqual(prev.sentenceIdx);
      }
    });
    const last = monologue[monologue.length - 1];
    expect(last?.kind === 'chunk' && last.sentenceIdx.length).toBe(getLine(index, 'L0390')!.sentences.length);
  });

  it('слабые места — только реплики с подошедшим сроком, самые забытые первыми', () => {
    const { index } = miniPlay();
    const line = (id: string) => getLine(index, id)!;
    const reviewed = (id: string, at: number): CardRow =>
      applyGrade(newCard(line(id), at), { line: line(id), mode: 'cue', affectsFsrs: true, rating: 'good', now: at });
    const cards = new Map<string, CardRow>([
      ['L0001', reviewed('L0001', NOW - 40 * 86_400_000)],
      ['L0004', reviewed('L0004', NOW - 5 * 86_400_000)],
      ['L0007', newCard(line('L0007'), NOW)],
    ]);
    const steps = buildSteps({ index, mode: 'weak', roles: ['a'], scope: parseScope(''), cards, now: NOW });
    expect(steps.map(stepLineId)).toEqual(['L0001', 'L0004']);
    const scoped = buildSteps({ index, mode: 'letters', roles: ['a'], scope: parseScope('weak'), cards, now: NOW });
    expect(scoped.map(stepLineId)).toEqual(['L0001', 'L0004']);
  });

  it('порядок — головоломки по сценам с детерминированным перемешиванием', () => {
    const { index } = realPlay();
    const steps = buildSteps({ index, mode: 'order', roles: ['starik'], scope: parseScope('a1s08'), cards: new Map(), now: NOW });
    expect(steps.length).toBeGreaterThan(1);
    const first = steps[0]!;
    expect(first.kind).toBe('order');
    if (first.kind === 'order') {
      expect(first.pieces.length).toBeLessThanOrEqual(6);
      expect([...first.shuffled].sort((a, b) => a.id.localeCompare(b.id))).toEqual([...first.pieces].sort((a, b) => a.id.localeCompare(b.id)));
    }
    expect(steps.some((s) => s.kind === 'order' && s.title.startsWith('Монолог L0390'))).toBe(true);
    const again = buildSteps({ index, mode: 'order', roles: ['starik'], scope: parseScope('a1s08'), cards: new Map(), now: NOW });
    expect(again).toEqual(steps);
  });

  it('продолжение с места: точная реплика или следующая по тексту', () => {
    const { index } = miniPlay();
    const steps = buildSteps({ index, mode: 'cue', roles: ['a'], scope: parseScope(''), cards: new Map(), now: NOW });
    expect(findStepIndex(steps, index, 'L0007')).toBe(2);
    expect(findStepIndex(steps, index, 'L0005')).toBe(2);
    expect(findStepIndex(steps, index, undefined)).toBe(0);
    expect(findStepIndex(steps, index, 'L9999')).toBe(0);
    expect(findStepIndex(steps, index, 'L0009')).toBe(3);
  });
});

describe('показ своей реплики', () => {
  const { index } = miniPlay();
  const l1 = getLine(index, 'L0001')!;
  const l4 = getLine(index, 'L0004')!;
  const base = { revealed: false, hints: 0, vanishLevel: 0, showAsides: true };

  it('по репликам: все слова скрыты, ремарки видны, длина пропорциональна слову', () => {
    const p = linePieces(l1, { ...base, mode: 'cue' });
    expect(piecesText(p)).toBe('(Тихо.) __ ______? _ _____.');
    expect(p.filter((x) => x.kind === 'blank').map((x) => (x.kind === 'blank' ? x.length : 0))).toEqual([2, 6, 1, 5]);
    expect(hiddenWordCount(p)).toBe(4);
    expect(piecesText(linePieces(l1, { ...base, mode: 'cue', showAsides: false }))).toBe('__ ______? _ _____.');
  });

  it('«Суфлёр» открывает слова по порядку', () => {
    const p = linePieces(l1, { ...base, mode: 'cue', hints: 2 });
    expect(p.filter((x) => x.kind === 'hint').map((x) => (x.kind === 'hint' ? x.text : ''))).toEqual(['Ты', 'пришёл']);
    expect(hiddenWordCount(p)).toBe(2);
  });

  it('первые буквы и показ целиком', () => {
    expect(piecesText(linePieces(l1, { ...base, mode: 'letters', showAsides: false }))).toBe('Т п? Я ж.');
    expect(piecesText(linePieces(l1, { ...base, mode: 'letters', revealed: true }))).toBe('(Тихо.) Ты пришёл? Я ждала.');
    expect(piecesText(linePieces(l1, { ...base, mode: 'run', showAsides: false }))).toBe('Т п? Я ж.');
  });

  it('исчезающий текст скрывает долю слов по уровню', () => {
    const level0 = linePieces(l4, { ...base, mode: 'vanish', vanishLevel: 0 });
    const level3 = linePieces(l4, { ...base, mode: 'vanish', vanishLevel: 3 });
    expect(hiddenWordCount(level0)).toBe(Math.ceil(l4.words * 0.25));
    expect(hiddenWordCount(level3)).toBe(l4.words);
  });

  it('часть монолога — только выбранные предложения', () => {
    const p = linePieces(l4, { ...base, mode: 'chunks', sentenceIdx: [0], revealed: true });
    expect(piecesText(p)).toBe('Отдохни.');
    expect(wordCount(l4, [0])).toBe(1);
    expect(wordCount(l4)).toBe(l4.words);
  });
});
