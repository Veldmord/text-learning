import { describe, expect, it } from 'vitest';
import { countWords, firstLetters, firstLettersOfWord, hash32, lastWords, splitSentences, tokenize } from '../../src/engine/text-transforms';

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

describe('хэш', () => {
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

});

describe('хвост подсказки', () => {
  it('берёт последние N слов с исходной пунктуацией', () => {
    expect(lastWords('Раз, два, три, четыре.', 2)).toBe('…три, четыре.');
    expect(lastWords('Коротко.', 5)).toBe('Коротко.');
  });
});
