import { describe, expect, it } from 'vitest';
import {
  chunkSentences,
  countWords,
  firstLetters,
  firstLettersOfWord,
  hash32,
  lastWords,
  seededShuffle,
  splitSentences,
  tokenize,
  vanishMask,
  wordDiff,
} from '../../src/engine/text-transforms';

describe('слова', () => {
  it('дефисные слова считаются одним словом, тире — не слово', () => {
    expect(countWords('Пер-ва-я! Я – по-своему, кафе-то.')).toBe(4);
    const t = tokenize('Ну, гляди!');
    expect(t).toEqual([
      { kind: 'word', text: 'Ну', index: 0 },
      { kind: 'sep', text: ', ' },
      { kind: 'word', text: 'гляди', index: 1 },
      { kind: 'sep', text: '!' },
    ]);
  });
});

describe('первые буквы', () => {
  it('оставляют первую букву с регистром и всю пунктуацию', () => {
    expect(firstLetters('Ты не слушаешь, что я говорю.')).toBe('Т н с, ч я г.');
    expect(firstLetters('«Молодежь – наше будущее!»')).toBe('«М – н б!»');
  });

  it('сохраняют структуру дефисных слов и не меняют числа', () => {
    expect(firstLettersOfWord('по-своему')).toBe('п-с');
    expect(firstLettersOfWord('Пер-ва-я')).toBe('П-в-я');
    expect(firstLetters('В 1985 году')).toBe('В 1985 г');
  });
});

describe('исчезающий текст', () => {
  it('детерминирован и на следующем уровне скрывает надмножество', () => {
    const levels = [25, 50, 75, 100].map((p) => vanishMask('L0042', 20, p));
    expect(vanishMask('L0042', 20, 50)).toEqual(levels[1]);
    for (let i = 1; i < levels.length; i++) {
      levels[i - 1]!.forEach((hidden, w) => {
        if (hidden) expect(levels[i]![w]).toBe(true);
      });
    }
    expect(levels.map((m) => m.filter(Boolean).length)).toEqual([5, 10, 15, 20]);
  });

  it('разные реплики скрывают разные слова', () => {
    expect(vanishMask('L0001', 30, 50)).not.toEqual(vanishMask('L0002', 30, 50));
    expect(vanishMask('L0001', 0, 50)).toEqual([]);
    expect(vanishMask('L0001', 3, 0)).toEqual([false, false, false]);
  });

  it('hash32 стабилен', () => {
    expect(hash32('abc')).toBe(hash32('abc'));
    expect(hash32('abc')).not.toBe(hash32('abd'));
  });
});

describe('предложения', () => {
  it('делит по . ! ? … перед заглавной, кавычкой или тире', () => {
    expect(splitSentences('Очень! А ты?')).toEqual(['Очень!', 'А ты?']);
    expect(splitSentences('Ну что ж… Посидим здесь.')).toEqual(['Ну что ж…', 'Посидим здесь.']);
    expect(splitSentences('Я? Последний?')).toEqual(['Я?', 'Последний?']);
    expect(splitSentences('Вот. «Нет» – сказал он.')).toEqual(['Вот.', '«Нет» – сказал он.']);
    expect(splitSentences('Так… что-то вроде.')).toEqual(['Так… что-то вроде.']);
  });

  it('не делит после «т.д.», «т. п.» и инициалов', () => {
    expect(splitSentences('Ходит и т.д. Наконец садится.')).toEqual(['Ходит и т.д. Наконец садится.']);
    expect(splitSentences('Крики и т. п. Потом тишина.')).toEqual(['Крики и т. п. Потом тишина.']);
    expect(splitSentences('Пьеса Н. Красногорова. Читаем.')).toEqual(['Пьеса Н. Красногорова.', 'Читаем.']);
    expect(splitSentences('Первым пришёл Я. Потом все.')).toEqual(['Первым пришёл Я.', 'Потом все.']);
    expect(splitSentences('')).toEqual([]);
  });

  it('группирует предложения монолога в части', () => {
    const s = ['Раз два три четыре пять.', 'Шесть семь восемь девять десять.', 'Одиннадцать двенадцать тринадцать четырнадцать пятнадцать шестнадцать семнадцать восемнадцать девятнадцать двадцать.', 'Хвост.'];
    expect(chunkSentences(s, 20, 8)).toEqual([[0, 1, 2, 3]]);
    expect(chunkSentences(s, 10, 2)).toEqual([[0, 1], [2, 3]]);
    expect(chunkSentences(s, 10, 1)).toEqual([[0, 1], [2], [3]]);
  });
});

describe('хвост подсказки', () => {
  it('берёт последние N слов с исходной пунктуацией', () => {
    expect(lastWords('Раз, два, три, четыре.', 2)).toBe('…три, четыре.');
    expect(lastWords('Коротко.', 5)).toBe('Коротко.');
  });
});

describe('пословный diff', () => {
  it('точное совпадение без учёта регистра, ё и пунктуации', () => {
    const d = wordDiff('Ещё не впускают?', 'еще не впускают');
    expect(d).toMatchObject({ errors: 0, accuracy: 1, suggested: 'good' });
  });

  it('находит пропуски, вставки и замены', () => {
    const d = wordDiff('Я буду жаловаться на вас', 'Я стану жаловаться вас очень');
    expect(d.ops.map((o) => o.op)).toEqual(['eq', 'sub', 'eq', 'del', 'eq', 'ins']);
    expect(d.errors).toBe(3);
    expect(d.suggested).toBe('again');
  });

  it('одна ошибка в длинной реплике — «С ошибкой»', () => {
    const d = wordDiff('раз два три четыре пять шесть семь восемь девять десять', 'раз два три четыре пять шесть семь восемь девять');
    expect(d).toMatchObject({ errors: 1, suggested: 'hard' });
    expect(wordDiff('', '')).toMatchObject({ accuracy: 1, suggested: 'good' });
    expect(wordDiff('', 'лишнее').accuracy).toBe(0);
    expect(wordDiff('a b', 'c a b').ops[0]).toEqual({ op: 'ins', typed: 'c' });
    expect(wordDiff('a b', 'b').ops[0]).toEqual({ op: 'del', expected: 'a' });
    expect(wordDiff('x y', 'z y').ops[0]).toEqual({ op: 'sub', expected: 'x', typed: 'z' });
  });
});

describe('детерминированное перемешивание', () => {
  it('одинаково для одного seed и сохраняет элементы', () => {
    const items = [1, 2, 3, 4, 5, 6];
    expect(seededShuffle(items, 'a')).toEqual(seededShuffle(items, 'a'));
    expect([...seededShuffle(items, 'b')].sort()).toEqual(items);
  });
});
