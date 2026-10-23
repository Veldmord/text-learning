import { describe, expect, it } from 'vitest';
import { silenceMp3 } from '../../tools/tts/silence';
import { mp3DurationMs } from '../../tools/tts/mp3';
import { normalizeForTts, numberToWords, stressForPiper } from '../../tools/tts/normalize';
import { buildJobs, clipKey, NARRATOR, resolveVoice, voiceName, type VoicesConfig } from '../../tools/tts/voices';
import { realPlay } from './fixtures';

const voices: VoicesConfig = {
  defaults: { engine: 'silero', model: 'v5_ru', rate: 1, pitch: 0 },
  narrator: { engine: 'piper', voice: 'ru_RU-denis-medium', rate: 0.95 },
  characters: { devushka: { speaker: 'xenia' }, starik: { engine: 'piper', voice: 'ru_RU-dmitri-medium' } },
};

describe('нормализация текста для синтеза', () => {
  it('числа словами', () => {
    expect(numberToWords(0)).toBe('ноль');
    expect(numberToWords(21)).toBe('двадцать один');
    expect(numberToWords(1002)).toBe('одна тысяча два');
    expect(numberToWords(2_345_678)).toBe('два миллиона триста сорок пять тысяч шестьсот семьдесят восемь');
    expect(numberToWords(1.5)).toBe('1.5');
  });

  it('сокращения, тире, многоточие, кавычки, inline-ремарки', () => {
    expect(normalizeForTts('Крики «Правильно!» и т. п.', 'SD0001.1')).toBe('Крики Правильно! и тому подобное');
    expect(normalizeForTts('Первые – мы. (Молодому человеку.) Иди…', 'S0001.1')).toBe('Первые, мы. Иди.');
    expect(normalizeForTts('Я… я тоже.', 'S0001.1')).toBe('Я, я тоже.');
    expect(normalizeForTts('Ждал 14 месяцев.', 'S0001.1')).toBe('Ждал четырнадцать месяцев.');
    expect(normalizeForTts('Узкая (на ней надпись) дверь.', 'SD0001.1')).toBe('Узкая, на ней надпись, дверь.');
  });

  it('словарь произношения: с начала слова, с сохранением регистра, точечно по реплике', () => {
    const dict = { global: { Гайдн: 'Г+айдн', инфарктик: 'инф+арктик' }, lines: { L0042: { from: 'замок', to: 'зам+ок' } } };
    expect(normalizeForTts('Это Гайдна серенада.', 'S0001.1', dict)).toBe('Это Г+айдна серенада.');
    expect(normalizeForTts('Инфарктик?', 'S0001.1', dict)).toBe('Инф+арктик?');
    expect(normalizeForTts('Замок и замок.', 'S0042.1', dict)).toBe('Зам+ок и замок.');
    expect(normalizeForTts('Замок и замок.', 'S0043.1', dict)).toBe('Замок и замок.');
    expect(stressForPiper('Г+айдн')).toBe(`Га${String.fromCharCode(0x301)}йдн`);
  });
});

describe('план клипов', () => {
  it('голоса: умолчания, рассказчик, ошибки конфигурации', () => {
    expect(voiceName(resolveVoice(voices, 'devushka'))).toBe('v5_ru:xenia');
    expect(resolveVoice(voices, NARRATOR)).toMatchObject({ engine: 'piper', rate: 0.95 });
    expect(() => resolveVoice(voices, 'dama')).toThrow(/не указан speaker/);
    expect(() => resolveVoice({ characters: { x: { engine: 'piper' } } }, 'x')).toThrow(/не указан голос Piper/);
  });

  it('имя клипа — хэш содержимого: одинаковые фразы одним голосом хранятся один раз', () => {
    const v = resolveVoice(voices, 'devushka');
    expect(clipKey(v, 'Нет.')).toBe(clipKey(v, 'Нет.'));
    expect(clipKey(v, 'Нет.')).not.toBe(clipKey({ ...v, pitch: 1 }, 'Нет.'));
    expect(clipKey(v, 'Нет.')).toMatch(/^[0-9a-f]{16}$/);
  });

  it('на настоящей пьесе: каждое предложение получает клип своего голоса', () => {
    const { play } = realPlay();
    const all: VoicesConfig = { ...voices, characters: Object.fromEntries(play.characters.map((c) => [c.id, { speaker: 'aidar' }])) };
    const jobs = buildJobs(play, all, {});
    const sentences = play.items.reduce((n, it) => n + it.sentences.length, 0);
    expect(jobs.length).toBeGreaterThan(sentences * 0.98);
    expect(jobs.find((j) => j.sentenceId === 'SD0001.1')?.engine).toBe('piper');
    expect(new Set(jobs.map((j) => j.key)).size).toBeLessThan(jobs.length);
  });
});

describe('MP3', () => {
  it('клип тишины длится секунду и читается счётчиком кадров', () => {
    const buf = silenceMp3(1000);
    expect(buf[0]).toBe(0xff);
    expect(mp3DurationMs(buf)).toBeGreaterThanOrEqual(1000);
    expect(mp3DurationMs(buf)).toBeLessThan(1030);
    expect(mp3DurationMs(Buffer.from('ID3\x03\x00\x00\x00\x00\x00\x00junk'))).toBe(0);
  });
});
