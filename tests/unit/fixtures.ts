// Общие фикстуры: настоящая пьеса из content/ и небольшая синтетическая для точечных проверок.
import { buildIndex, type PlayIndex } from '../../src/engine/queries';
import type { Play } from '../../src/engine/types';
import { buildPlay } from '../../tools/parser/build';
import { parsePlay, type CharacterConfig } from '../../tools/parser/parse';
import { buildActs } from '../../tools/parser/scenes';

let cached: { play: Play; index: PlayIndex } | null = null;

export function realPlay(): { play: Play; index: PlayIndex } {
  if (!cached) {
    const { play, errors } = buildPlay();
    if (errors.length) throw new Error(errors.join('\n'));
    cached = { play, index: buildIndex(play) };
  }
  return cached;
}

export const MINI_CHARACTERS: CharacterConfig[] = [
  { id: 'a', name: 'Анна', aliases: ['АННА'], gender: 'f' },
  { id: 'b', name: 'Борис', aliases: ['БОРИС'], gender: 'm' },
  { id: 'c', name: 'Вера', aliases: ['ВЕРА'], gender: 'f' },
];

/** Маленькая пьеса: L0001…L0009, D0001…D0003, два действия по одной-две сцены. */
export const MINI_SOURCE = [
  '1',
  'Автор Тестовый',
  'Мини',
  'Пьеса в двух действиях',
  'Действующие лица',
  'Анна',
  'Борис',
  'Вера',
  'Действие первое',
  'Комната. Анна у окна.',
  'АННА. (Тихо.) Ты пришёл? Я ждала.',
  'БОРИС. Пришёл. (Садится.) Устал.',
  'Пауза.',
  '    Очень устал.',
  'АННА. Отдохни. Чай будет через минуту, а потом поговорим о деле, которое не терпит отлагательств.',
  'ВЕРА. Можно войти?',
  'Конец первого действия.',
  'Действие второе',
  'Входит Вера.',
  'ВЕРА. Это снова я.',
  'АННА. Опять ты.',
  'БОРИС. Здравствуйте.',
  'АННА. Да. Здравствуй.',
  'Конец',
].join('\r\n');

export function miniPlay(): { play: Play; index: PlayIndex } {
  const parsed = parsePlay(MINI_SOURCE, MINI_CHARACTERS, {});
  if (parsed.errors.length) throw new Error(parsed.errors.join('\n'));
  const { acts, errors } = buildActs(parsed.acts, parsed.items, [
    { id: 'a1s01', title: 'Встреча', from: 'D0001' },
    { id: 'a1s02', title: 'Вера', from: 'L0005' },
    { id: 'a2s01', title: 'Снова', from: 'D0003' },
  ]);
  if (errors.length) throw new Error(errors.join('\n'));
  const play: Play = {
    id: 'mini',
    title: parsed.title,
    author: parsed.author,
    subtitle: parsed.subtitle,
    preface: parsed.preface,
    sourceHash: parsed.sourceHash,
    characters: parsed.characters,
    items: parsed.items,
    acts,
  };
  return { play, index: buildIndex(play) };
}
