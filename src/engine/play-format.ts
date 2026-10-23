// Формат хранения play.json. Предложения не хранятся, а вычисляются при загрузке той же функцией,
// что и в парсере: текст речи не дублируется, и play.json укладывается в бюджет NFR-01 с запасом.
import { splitSentences } from './text-transforms';
import type { Direction, Item, Line, Play, Segment } from './types';

export const PLAY_FORMAT_VERSION = 1;

/** cast.json — состав с числом реплик и слов для стартового экрана (генерируется вместе с play.json). */
export interface Cast {
  title: string;
  author: string;
  subtitle: string;
  characters: { id: string; name: string; group?: string; speaking: boolean; lines: number; words: number }[];
}

export type StoredLine = Omit<Line, 'sentences'>;
export type StoredDirection = Omit<Direction, 'sentences'>;
export type StoredItem = StoredLine | StoredDirection;

export interface StoredPlay extends Omit<Play, 'items'> {
  format: number;
  items: StoredItem[];
}

export const speechOfSegments = (segments: Segment[]) =>
  segments
    .filter((s) => s.kind === 'speech')
    .map((s) => s.text)
    .join(' ');

export const speechText = (line: Pick<Line, 'segments'>) => speechOfSegments(line.segments);

const num = (id: string) => id.slice(1);

export function lineSentences(id: string, speech: string) {
  return splitSentences(speech).map((text, i) => ({ id: `S${num(id)}.${i + 1}`, text }));
}

export function directionSentences(id: string, text: string) {
  return splitSentences(text).map((t, i) => ({ id: `SD${num(id)}.${i + 1}`, text: t }));
}

export function hydrateItem(item: StoredItem): Item {
  return item.kind === 'line'
    ? { ...item, sentences: lineSentences(item.id, speechOfSegments(item.segments)) }
    : { ...item, sentences: directionSentences(item.id, item.text) };
}

export function hydratePlay(stored: StoredPlay): Play {
  if (stored.format !== PLAY_FORMAT_VERSION) {
    throw new Error(`Неподдерживаемая версия play.json: ${String(stored.format)}`);
  }
  const { format: _format, items, ...rest } = stored;
  return { ...rest, items: items.map(hydrateItem) };
}

export function compactPlay(play: Play): StoredPlay {
  return {
    format: PLAY_FORMAT_VERSION,
    ...play,
    items: play.items.map(({ sentences: _s, ...rest }) => rest as StoredItem),
  };
}
