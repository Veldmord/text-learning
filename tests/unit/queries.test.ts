import { describe, expect, it } from 'vitest';
import {
  characterStats,
  cueFor,
  formatScope,
  getLine,
  itemAt,
  itemText,
  myLinesInScene,
  myLinesInScope,
  parseRoles,
  parseScope,
  roleNames,
  roleStats,
  rolesKey,
  scenesWithRoles,
  scopeItemIds,
  scopeLabel,
  searchPlay,
  speakerName,
  lineSpeech,
  isMine,
} from '../../src/engine/queries';
import { miniPlay, realPlay } from './fixtures';

describe('роли', () => {
  it('статистика по персонажам совпадает с таблицей раздела 2', () => {
    const stats = characterStats(realPlay().index);
    expect(stats.get('devushka')).toEqual({ lines: 206, words: 1976 });
    expect(stats.get('administrator')).toEqual({ lines: 52, words: 268 });
    expect(stats.has('nekto')).toBe(false);
  });

  it('разбирает список ролей и отбрасывает немых и неизвестных', () => {
    const { index } = realPlay();
    expect(parseRoles('devushka,nekto,ghost,devushka', index)).toEqual(['devushka']);
    expect(parseRoles(undefined, index)).toEqual([]);
    expect(rolesKey(['sanitar-2', 'sanitar-1'])).toBe('sanitar-1,sanitar-2');
  });

  it('называет группу целиком, если выбраны все её участники', () => {
    const { index } = realPlay();
    expect(roleNames(index, ['sanitar-1', 'sanitar-2'])).toBe('Санитары');
    expect(roleNames(index, ['sanitar-1'])).toBe('Первый санитар');
    expect(roleNames(index, ['devushka', 'dama'])).toBe('Девушка + Дама');
    expect(roleStats(index, ['sanitar-1', 'sanitar-2'])).toEqual({ lines: 5, words: 21 });
  });

  it('сцены с ролью и свои реплики в сцене', () => {
    const { index } = miniPlay();
    expect(scenesWithRoles(index, ['c']).map((s) => s.scene.id)).toEqual(['a1s02', 'a2s01']);
    expect(myLinesInScene(index, 'a1s01', ['b']).map((l) => l.id)).toEqual(['L0002', 'L0003']);
    expect(myLinesInScene(index, 'nope', ['b'])).toEqual([]);
    expect(isMine(index.byId.get('L0002'), new Set(['b']))).toBe(true);
    expect(isMine(index.byId.get('D0001'), ['b'])).toBe(false);
  });
});

describe('диапазон тренировки', () => {
  it('разбирает и сериализует диапазон', () => {
    const s = parseScope('a1,a2s01,L0002-L0004,weak,junk');
    expect(s).toEqual({
      parts: [
        { kind: 'act', n: 1 },
        { kind: 'scene', id: 'a2s01' },
        { kind: 'range', from: 'L0002', to: 'L0004' },
      ],
      weak: true,
    });
    expect(formatScope(s)).toBe('a1,a2s01,L0002-L0004,weak');
    expect(formatScope(parseScope(''))).toBe('all');
    expect(parseScope('all')).toEqual({ parts: [], weak: false });
  });

  it('собирает элементы действия, сцены и диапазона реплик', () => {
    const { index } = miniPlay();
    expect([...scopeItemIds(index, parseScope('a2'))]).toEqual(['D0003', 'L0006', 'L0007', 'L0008', 'L0009']);
    expect([...scopeItemIds(index, parseScope('a1s02'))]).toEqual(['L0005']);
    expect([...scopeItemIds(index, parseScope('L0004-L0002'))]).toEqual(['L0002', 'D0002', 'L0003', 'L0004']);
    expect(scopeItemIds(index, parseScope('L0001-L9999')).size).toBe(0);
    expect(myLinesInScope(index, ['a'], parseScope('all')).map((l) => l.id)).toEqual(['L0001', 'L0004', 'L0007', 'L0009']);
  });

  it('подписывает диапазон по-русски', () => {
    const { index } = miniPlay();
    expect(scopeLabel(index, parseScope('all'))).toBe('Вся роль');
    expect(scopeLabel(index, parseScope('a1,weak'))).toBe('Действие 1 · только слабые');
    expect(scopeLabel(index, parseScope('a2s01'))).toBe('Д.2 · 1. Снова');
    expect(scopeLabel(index, parseScope('L0001-L0003'))).toBe('Реплики L0001–L0003');
  });
});

describe('подсказка и контекст', () => {
  it('подсказка — ближайшая чужая реплика, ремарки после неё видны', () => {
    const { index } = miniPlay();
    const c = cueFor(index, 'L0004', ['a'], 1);
    expect(c.cue?.id).toBe('L0003');
    expect(c.before.map((i) => i.id)).toEqual(['L0003']);
    const c2 = cueFor(index, 'L0003', ['b'], 1);
    expect(c2.cue).toBeNull();
    expect(c2.before.map((i) => i.id)).toEqual(['L0002', 'D0002']);
  });

  it('контекст N реплик не выходит за начало действия', () => {
    const { index } = miniPlay();
    expect(cueFor(index, 'L0004', ['a'], 3).before.map((i) => i.id)).toEqual(['L0001', 'L0002', 'D0002', 'L0003']);
    expect(cueFor(index, 'L0007', ['a'], 5).before.map((i) => i.id)).toEqual(['D0003', 'L0006']);
    expect(cueFor(index, 'L0001', ['a'], 1)).toEqual({ before: [index.byId.get('D0001')], cue: null });
    expect(cueFor(index, 'nope', ['a'])).toEqual({ before: [], cue: null });
  });

  it('при нескольких ролях своя реплика не считается подсказкой', () => {
    const { index } = miniPlay();
    expect(cueFor(index, 'L0004', ['a', 'b'], 1).cue).toBeNull();
  });
});

describe('поиск и текст', () => {
  it('ищет без учёта регистра и ё, с фрагментом вокруг', () => {
    const { index } = realPlay();
    const hits = searchPlay(index, 'МОЦАРТ');
    expect(hits[0]?.item.id).toBe('L0007');
    expect(hits[0]?.match).toBe('Моцарт');
    expect(searchPlay(index, 'ё')).toEqual([]);
    expect(searchPlay(index, 'еще', 3)).toHaveLength(3);
  });

  it('текст элемента, имя говорящего и соседние элементы', () => {
    const { index } = miniPlay();
    const l1 = getLine(index, 'L0001')!;
    expect(itemText(l1)).toBe('(Тихо.) Ты пришёл? Я ждала.');
    expect(lineSpeech(l1)).toBe('Ты пришёл? Я ждала.');
    expect(speakerName(index, l1)).toBe('Анна');
    expect(speakerName(index, index.byId.get('D0001')!)).toBe('');
    expect(itemAt(index, 'L0001', 1)?.id).toBe('L0002');
    expect(itemAt(index, 'L9999', 1)).toBeUndefined();
    expect(getLine(index, 'D0001')).toBeUndefined();
  });
});
