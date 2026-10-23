import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compactPlay, hydratePlay } from '../../src/engine/play-format';
import type { Line } from '../../src/engine/types';
import { SNAPSHOT_FILE } from '../../tools/parser/build';
import { normalizeSourceLine, parsePlay, splitSegments } from '../../tools/parser/parse';
import { buildActs } from '../../tools/parser/scenes';
import { suggestScenes } from '../../tools/parser/suggest-scenes';
import { computeCounts, diffCounts, type Counts } from '../../tools/parser/validate';
import { MINI_CHARACTERS, MINI_SOURCE, miniPlay, realPlay } from './fixtures';

const lineOf = (items: { kind: string }[], id: string) => items.find((i) => (i as Line).id === id) as Line;

describe('грамматика парсера', () => {
  it('читает метаданные до первого действия и игнорирует служебное число', () => {
    const r = parsePlay(MINI_SOURCE, MINI_CHARACTERS);
    expect(r.errors).toEqual([]);
    expect(r.author).toBe('Автор Тестовый');
    expect(r.title).toBe('Мини');
    expect(r.subtitle).toBe('Пьеса в двух действиях');
    expect(r.cast).toEqual(['Анна', 'Борис', 'Вера']);
    expect(r.acts.map((a) => a.n)).toEqual([1, 2]);
  });

  it('делит реплику на речь и inline-ремарки', () => {
    const { play } = miniPlay();
    const l1 = lineOf(play.items, 'L0001');
    expect(l1.speakerId).toBe('a');
    expect(l1.segments).toEqual([
      { kind: 'aside', text: 'Тихо.' },
      { kind: 'speech', text: 'Ты пришёл? Я ждала.' },
    ]);
    expect(l1.sentences.map((s) => s.id)).toEqual(['S0001.1', 'S0001.2']);
    expect(l1.words).toBe(4);
    expect(l1.textHash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('строка с отступом продолжает реплику последнего говорившего после ремарки', () => {
    const { play } = miniPlay();
    const cont = lineOf(play.items, 'L0003');
    expect(cont).toMatchObject({ speakerId: 'b', continuation: true });
    expect(play.items.map((i) => i.id).slice(0, 5)).toEqual(['D0001', 'L0001', 'L0002', 'D0002', 'L0003']);
  });

  it('роняет разбор на неизвестном имени и реплике без речи', () => {
    const r = parsePlay(['Действие первое', 'ПРИЗРАК. Бу!', 'АННА. (Молчит.)', 'Конец'].join('\n'), MINI_CHARACTERS);
    expect(r.errors.some((e) => e.includes('неизвестное имя «ПРИЗРАК»'))).toBe(true);
    expect(r.errors.some((e) => e.includes('реплика без речи'))).toBe(true);
  });

  it('сообщает о продолжении без говорившего и о действующем лице без конфигурации', () => {
    const r = parsePlay(['Действующие лица', 'Незнакомец', 'Действие первое', '    Кто здесь?', 'Конец'].join('\n'), MINI_CHARACTERS);
    expect(r.errors.some((e) => e.includes('продолжение реплики без предыдущего говорившего'))).toBe(true);
    expect(r.errors.some((e) => e.includes('«Незнакомец» отсутствует'))).toBe(true);
  });

  it('применяет overrides по номеру строки', () => {
    const source = ['Действие первое', 'АННА. Раз.', 'Странная строка', 'Лишнее', 'Конец'].join('\n');
    const r = parsePlay(source, MINI_CHARACTERS, {
      3: { kind: 'line', speaker: 'b', text: 'Два.' },
      4: { kind: 'skip' },
    });
    expect(r.errors).toEqual([]);
    expect(r.items.map((i) => i.id)).toEqual(['L0001', 'L0002']);
    expect(lineOf(r.items, 'L0002')).toMatchObject({ speakerId: 'b', continuation: true, segments: [{ kind: 'speech', text: 'Два.' }] });
  });

  it('чистит артефакты вёрстки и склеивает пробелы', () => {
    expect(normalizeSourceLine('Вы не знаете, \u00ac\u00acкогда?\u00a0 ')).toBe('Вы не знаете, когда?');
    expect(splitSegments('замуж?(Ядовито.) Защитник')).toEqual([
      { kind: 'speech', text: 'замуж?' },
      { kind: 'aside', text: 'Ядовито.' },
      { kind: 'speech', text: 'Защитник' },
    ]);
  });
});

describe('настоящий текст «Райских врат»', () => {
  it('выдаёт 831 реплику, 34 продолжения и 129 ремарок (раздел 2)', () => {
    const counts = computeCounts(realPlay().play.items);
    expect(counts.totalLines).toBe(831);
    expect(counts.continuations).toBe(34);
    expect(counts.directions).toBe(129);
    expect(counts.lines).toMatchObject({ devushka: 206, 'molodoy-chelovek': 123, dama: 117, muzhchina: 114, starik: 107, zhenshchina: 101, administrator: 52 });
  });

  it('совпадает со снапшотом численности', () => {
    const expected = JSON.parse(readFileSync(SNAPSHOT_FILE, 'utf8')) as Counts;
    expect(diffCounts(expected, computeCounts(realPlay().play.items))).toEqual([]);
  });

  it('распознаёт продолжение после «Целуются.» и немых персонажей', () => {
    const { play } = realPlay();
    const l = lineOf(play.items, 'L0007');
    expect(l).toMatchObject({ speakerId: 'devushka', continuation: true, src: 58 });
    expect(play.characters.find((c) => c.id === 'nekto')?.speaking).toBe(false);
    expect(play.characters.find((c) => c.id === 'sanitar-1')).toMatchObject({ group: 'Санитары', speaking: true });
  });

  it('сцены покрывают оба действия без пропусков', () => {
    const { play } = realPlay();
    const sceneItems = play.acts.flatMap((a) => a.scenes.flatMap((s) => s.itemIds));
    expect(sceneItems).toEqual(play.items.map((i) => i.id));
    expect(play.acts.every((a) => a.scenes.length > 0)).toBe(true);
  });

  it('компактный формат восстанавливается без потерь', () => {
    const { play } = realPlay();
    const restored = hydratePlay(JSON.parse(JSON.stringify(compactPlay(play))));
    expect(restored.items).toEqual(play.items);
    expect(() => hydratePlay({ ...compactPlay(play), format: 99 })).toThrow(/Неподдерживаемая/);
  });

  it('scenes:suggest предлагает границы по входам и выходам', () => {
    const { play } = realPlay();
    const acts = play.acts.map((a) => a.scenes.flatMap((s) => s.itemIds as string[]));
    const s = suggestScenes(play.items, acts, 25);
    expect(s[0]).toMatchObject({ from: 'D0001', reason: 'начало действия' });
    expect(s.length).toBeGreaterThanOrEqual(12);
    expect(s.length).toBeLessThanOrEqual(25);
  });
});

describe('валидация карты сцен', () => {
  const parsed = parsePlay(MINI_SOURCE, MINI_CHARACTERS);

  it('требует, чтобы первая сцена начинала действие', () => {
    const { errors } = buildActs(parsed.acts, parsed.items, [
      { id: 'a1s01', title: 'x', from: 'L0001' },
      { id: 'a2s01', title: 'y', from: 'D0003' },
    ]);
    expect(errors.some((e) => e.includes('должна начинаться с D0001'))).toBe(true);
  });

  it('находит пересечения, повторы и несуществующие начала', () => {
    const { errors } = buildActs(parsed.acts, parsed.items, [
      { id: 'a1s01', title: 'x', from: 'D0001' },
      { id: 'a1s01', title: 'x', from: 'L0004' },
      { id: 'a1s03', title: 'z', from: 'L0002' },
      { id: 'a1s04', title: 'w', from: 'L9999' },
    ]);
    expect(errors.some((e) => e.includes('повторяющийся id'))).toBe(true);
    expect(errors.some((e) => e.includes('L9999 не найдено'))).toBe(true);
    expect(errors.some((e) => e.includes('пересекаются'))).toBe(true);
    expect(errors.some((e) => e.includes('нет ни одной сцены'))).toBe(true);
  });

  it('diffCounts сообщает о каждом расхождении', () => {
    const a = computeCounts(parsed.items);
    const b: Counts = { ...a, directions: a.directions + 1, lines: { ...a.lines, a: 99 } };
    expect(diffCounts(b, a)).toHaveLength(2);
  });
});
