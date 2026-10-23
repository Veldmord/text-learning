// Как показывается своя реплика в каждом режиме: скрытые слова, первые буквы, исчезание, подсказки суфлёра.
import { firstLettersOfWord, tokenize, vanishMask, VANISH_LEVELS, countWords } from '../text-transforms';
import type { Line } from '../types';
import type { ModeId } from './index';

export type Piece =
  | { kind: 'text'; text: string }
  | { kind: 'sep'; text: string }
  | { kind: 'aside'; text: string }
  | { kind: 'blank'; length: number }
  | { kind: 'letters'; text: string }
  /** Слово, открытое «Суфлёром» */
  | { kind: 'hint'; text: string };

export interface RenderOptions {
  mode: ModeId;
  revealed: boolean;
  /** Сколько слов открыл «Суфлёр» */
  hints: number;
  vanishLevel: number;
  showAsides: boolean;
  /** Для «Монолога по частям»: какие предложения входят в шаг */
  sentenceIdx?: number[];
}

type WordState = 'visible' | 'hidden' | 'letters';

function speechSegments(line: Line, o: RenderOptions): { kind: 'speech' | 'aside'; text: string }[] {
  if (o.sentenceIdx) {
    return [{ kind: 'speech', text: o.sentenceIdx.map((i) => line.sentences[i]?.text ?? '').join(' ') }];
  }
  return line.segments.filter((s) => s.kind === 'speech' || o.showAsides);
}

export function wordCount(line: Line, sentenceIdx?: number[]): number {
  return sentenceIdx
    ? countWords(sentenceIdx.map((i) => line.sentences[i]?.text ?? '').join(' '))
    : line.words;
}

export function linePieces(line: Line, o: RenderOptions): Piece[] {
  const total = wordCount(line, o.sentenceIdx);
  const vanish = o.mode === 'vanish' ? vanishMask(line.id, total, VANISH_LEVELS[o.vanishLevel] ?? 25) : null;
  // Суфлёр открывает скрытые слова по порядку
  let hintsLeft = o.hints;
  const stateOf = (i: number): WordState => {
    if (o.revealed) return 'visible';
    if (o.mode === 'letters' || o.mode === 'run') return 'letters';
    if (vanish) return vanish[i] ? 'hidden' : 'visible';
    return 'hidden';
  };

  const pieces: Piece[] = [];
  let wordIndex = 0;
  const segments = speechSegments(line, o);
  segments.forEach((seg, si) => {
    if (si > 0) pieces.push({ kind: 'sep', text: ' ' });
    if (seg.kind === 'aside') {
      pieces.push({ kind: 'aside', text: seg.text });
      return;
    }
    for (const t of tokenize(seg.text, wordIndex)) {
      if (t.kind === 'sep') {
        pieces.push({ kind: 'sep', text: t.text });
        continue;
      }
      wordIndex = t.index + 1;
      const st = stateOf(t.index);
      if (st === 'visible') pieces.push({ kind: 'text', text: t.text });
      else if (hintsLeft > 0) {
        hintsLeft--;
        pieces.push({ kind: 'hint', text: t.text });
      } else if (st === 'letters') pieces.push({ kind: 'letters', text: firstLettersOfWord(t.text) });
      else pieces.push({ kind: 'blank', length: Array.from(t.text).length });
    }
  });
  return pieces;
}

/** Сколько слов ещё можно открыть «Суфлёром» */
export function hiddenWordCount(pieces: Piece[]): number {
  return pieces.filter((p) => p.kind === 'blank' || p.kind === 'letters').length;
}

export const piecesText = (pieces: Piece[]) =>
  pieces
    .map((p) => (p.kind === 'blank' ? '_'.repeat(p.length) : p.kind === 'aside' ? `(${p.text})` : 'text' in p ? p.text : ''))
    .join('');
