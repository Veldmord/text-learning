import { describe, expect, it } from 'vitest';
import {
  cuePlan,
  directionUnits,
  echoUnits,
  estimateMs,
  lineDurationMs,
  lineUnits,
  NARRATOR,
  playPlan,
  readThroughUnits,
  scenePlan,
  SENTENCE_GAP_MS,
  stepPlan,
  type PlanSettings,
} from '../../src/engine/audio-plan';
import { getLine } from '../../src/engine/queries';
import type { Direction } from '../../src/engine/types';
import { miniPlay } from './fixtures';

const settings: PlanSettings = { cueLength: 'full', cueWords: 3, directions: 'text', context: 1, pauseMs: 300 };

describe('озвучка реплики', () => {
  const { index } = miniPlay();
  const l4 = getLine(index, 'L0004')!;

  it('одна единица — одно предложение, паузы 150 мс', () => {
    const u = lineUnits(l4);
    expect(u.map((x) => x.sentenceId)).toEqual(['S0004.1', 'S0004.2']);
    expect(u.every((x) => x.pauseAfterMs === SENTENCE_GAP_MS)).toBe(true);
  });

  it('последнее предложение и последние N слов', () => {
    expect(lineUnits(l4, 'lastSentence').map((x) => x.sentenceId)).toEqual(['S0004.2']);
    const lw = lineUnits(l4, 'lastWords', 3);
    expect(lw).toHaveLength(1);
    expect(lw[0]).toMatchObject({ sentenceId: 'S0004.2', partial: true, text: '…не терпит отлагательств.' });
    const all = lineUnits(l4, 'lastWords', 50);
    expect(all.map((x) => x.partial ?? false)).toEqual([false, false]);
  });

  it('ремарки читает рассказчик', () => {
    const d = index.byId.get('D0001') as Direction;
    expect(directionUnits(d).every((u) => u.speakerId === NARRATOR)).toBe(true);
  });
});

describe('план подсказки', () => {
  const { index } = miniPlay();

  it('подсказка партнёра звучит, своя реплика в контексте — нет', () => {
    const p = cuePlan(index, 'L0004', ['a'], { ...settings, context: 3 });
    expect(p.cueLine?.id).toBe('L0003');
    expect(p.cue.map((u) => u.sentenceId)).toEqual(['S0003.1']);
    expect(p.context.map((u) => u.itemId)).toEqual(['L0002', 'L0002']);
    expect(p.cue[p.cue.length - 1]!.pauseAfterMs).toBe(300);
    expect(p.visible.map((i) => i.id)).toEqual(['L0001', 'L0002', 'D0002', 'L0003']);
  });

  it('ремарки голосом и скрытие ремарок', () => {
    const voice = cuePlan(index, 'L0003', ['b'], { ...settings, directions: 'voice' });
    expect(voice.cue).toEqual([]);
    expect(voice.context.map((u) => u.speakerId)).toEqual([NARRATOR]);
    const skip = cuePlan(index, 'L0003', ['b'], { ...settings, directions: 'skip' });
    expect(skip.visible.map((i) => i.id)).toEqual(['L0002']);
  });

  it('контекст 0 и «только текст» — без звука, но с текстом', () => {
    for (const s of [{ ...settings, context: 0 }, { ...settings, cueLength: 'textOnly' as const }]) {
      const p = cuePlan(index, 'L0004', ['a'], s);
      expect(p.context).toEqual([]);
      expect(p.cue).toEqual([]);
      expect(p.visible.map((i) => i.id)).toEqual(['L0003']);
    }
  });

  it('длина подсказки применяется только к самой подсказке', () => {
    const p = cuePlan(index, 'L0005', ['c'], { ...settings, cueLength: 'lastSentence', context: 2 });
    expect(p.cue.map((u) => u.sentenceId)).toEqual(['S0004.2']);
    expect(p.context.map((u) => u.sentenceId)).toEqual(['S0003.1']);
  });
});

describe('план прогона с буквами', () => {
  const { index } = miniPlay();

  it('видна сцена с начала, звучит целиком всё после моей прошлой реплики', () => {
    const p = scenePlan(index, 'L0004', ['a'], { ...settings, cueLength: 'lastSentence', context: 0 });
    expect(p.visible.map((i) => i.id)).toEqual(['D0001', 'L0001', 'L0002', 'D0002', 'L0003']);
    expect(p.context.map((u) => u.sentenceId)).toEqual(['S0002.1', 'S0002.2']);
    expect(p.cueLine?.id).toBe('L0003');
    expect(p.cue.map((u) => u.sentenceId)).toEqual(['S0003.1']);
    expect(p.cue[p.cue.length - 1]!.pauseAfterMs).toBe(300);
  });

  it('первая своя реплика — с начала сцены, не выходя за неё; ремарки по настройке', () => {
    const p = scenePlan(index, 'L0007', ['a'], { ...settings, directions: 'voice' });
    expect(p.visible.map((i) => i.id)).toEqual(['D0003', 'L0006']);
    expect(p.context.map((u) => u.speakerId)).toEqual([NARRATOR]);
    expect(p.cue.map((u) => u.sentenceId)).toEqual(['S0006.1']);
    const first = scenePlan(index, 'L0001', ['a'], { ...settings, directions: 'voice' });
    expect(first.cueLine).toBeNull();
    expect(new Set(first.context.map((u) => u.itemId))).toEqual(new Set(['D0001']));
    const skip = scenePlan(index, 'L0001', ['a'], { ...settings, directions: 'skip' });
    expect(skip.visible).toEqual([]);
    expect(skip.context).toEqual([]);
  });

  it('свои прошлые реплики видны, но не звучат; «только текст» — без звука', () => {
    const p = scenePlan(index, 'L0009', ['a'], settings);
    expect(p.visible.map((i) => i.id)).toEqual(['D0003', 'L0006', 'L0007', 'L0008']);
    expect([...p.context, ...p.cue].map((u) => u.itemId)).toEqual(['L0008']);
    const silent = scenePlan(index, 'L0009', ['a'], { ...settings, cueLength: 'textOnly' });
    expect([...silent.context, ...silent.cue]).toEqual([]);
    expect(silent.visible).toHaveLength(4);
  });

  it('план шага выбирается по режиму', () => {
    expect(stepPlan('run', index, 'L0004', ['a'], settings)).toEqual(scenePlan(index, 'L0004', ['a'], settings));
    expect(stepPlan('letters', index, 'L0004', ['a'], settings)).toEqual(cuePlan(index, 'L0004', ['a'], settings));
  });
});

describe('план аудиопрогона по всей пьесе', () => {
  const { index } = miniPlay();
  const all = new Set(index.play.items.map((i) => i.id));

  it('звучит всё после своей прошлой реплики, через границы сцен и действий', () => {
    const p = playPlan(index, 'L0007', ['a'], { ...settings, directions: 'voice' }, { inScope: all, skipScenesWithoutRole: false });
    expect(new Set(p.context.map((u) => u.itemId))).toEqual(new Set(['L0005', 'D0003']));
    expect(p.cueLine?.id).toBe('L0006');
    expect(p.cue.map((u) => u.sentenceId)).toEqual(['S0006.1']);
  });

  it('сцены без моей роли пропускаются по настройке', () => {
    const p = playPlan(index, 'L0007', ['a'], settings, { inScope: all, skipScenesWithoutRole: true });
    expect(p.visible.map((i) => i.id)).toEqual(['D0003', 'L0006']);
    expect([...p.context, ...p.cue].map((u) => u.itemId)).toEqual(['L0006']);
  });

  it('не раньше начала диапазона; первая реплика пьесы — с самого начала', () => {
    const act2 = new Set(index.play.acts[1]!.scenes.flatMap((s) => s.itemIds));
    const p = playPlan(index, 'L0007', ['a'], settings, { inScope: act2, skipScenesWithoutRole: false });
    expect(p.visible.map((i) => i.id)).toEqual(['D0003', 'L0006']);
    const first = playPlan(index, 'L0001', ['a'], { ...settings, directions: 'voice' }, { inScope: all, skipScenesWithoutRole: true });
    expect(first.visible.map((i) => i.id)).toEqual(['D0001']);
    expect(first.cueLine).toBeNull();
  });
});

describe('длительность и читка', () => {
  const { index } = miniPlay();
  const l1 = getLine(index, 'L0001')!;

  it('по клипам манифеста, иначе по темпу 14 символов в секунду', () => {
    expect(estimateMs('a'.repeat(14))).toBe(1000);
    expect(lineDurationMs(l1, (id) => (id === 'S0001.1' ? 900 : undefined))).toBe(900 + estimateMs('Я ждала.') + 2 * SENTENCE_GAP_MS);
    expect(lineDurationMs(l1, () => 100, [1])).toBe(100 + SENTENCE_GAP_MS);
  });

  it('эхо своей реплики и части монолога', () => {
    expect(echoUnits(l1).map((u) => u.sentenceId)).toEqual(['S0001.1', 'S0001.2']);
    expect(echoUnits(l1, [1]).map((u) => u.sentenceId)).toEqual(['S0001.2']);
  });

  it('читка сцены с выбранного места', () => {
    const u = readThroughUnits(index, 'L0002', { directions: 'voice', pauseMs: 200 });
    expect(new Set(u.map((x) => x.itemId))).toEqual(new Set(['L0002', 'D0002', 'L0003', 'L0004']));
    expect(readThroughUnits(index, 'L0002', { directions: 'skip', pauseMs: 0 }).some((x) => x.speakerId === NARRATOR)).toBe(false);
    expect(readThroughUnits(index, 'X', { directions: 'skip', pauseMs: 0 })).toEqual([]);
  });
});
