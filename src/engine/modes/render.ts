// Как показывается своя реплика: первые буквы, слова «Суфлёра», текст целиком после «Открыть».
import { firstLettersOfWord, tokenize } from '../text-transforms';
import type { Line } from '../types';

export type Piece =
  | { kind: 'text'; text: string }
  | { kind: 'sep'; text: string }
  | { kind: 'aside'; text: string }
  | { kind: 'letters'; text: string }
  /** Слово, открытое «Суфлёром» */
  | { kind: 'hint'; text: string };

export interface RenderOptions {
  revealed: boolean;
  /** Сколько слов открыл «Суфлёр» */
  hints: number;
  showAsides: boolean;
}

export function linePieces(line: Line, o: RenderOptions): Piece[] {
  // Суфлёр открывает слова по порядку
  let hintsLeft = o.hints;
  const pieces: Piece[] = [];
  let wordIndex = 0;
  const segments = line.segments.filter((s) => s.kind === 'speech' || o.showAsides);
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
      if (o.revealed) pieces.push({ kind: 'text', text: t.text });
      else if (hintsLeft > 0) {
        hintsLeft--;
        pieces.push({ kind: 'hint', text: t.text });
      } else pieces.push({ kind: 'letters', text: firstLettersOfWord(t.text) });
    }
  });
  return pieces;
}

/** Сколько слов ещё можно открыть «Суфлёром» */
export function hiddenWordCount(pieces: Piece[]): number {
  return pieces.filter((p) => p.kind === 'letters').length;
}

export const piecesText = (pieces: Piece[]) => pieces.map((p) => (p.kind === 'aside' ? `(${p.text})` : p.text)).join('');
