// Снапшот численности: роняет сборку, если разбор текста неожиданно изменился (раздел 9.1).
import type { Item, Line } from '../../src/engine/types';

export interface Counts {
  /** Реплики по ролям, без продолжений после ремарок */
  lines: Record<string, number>;
  /** Слова по ролям, включая продолжения */
  words: Record<string, number>;
  totalLines: number;
  continuations: number;
  directions: number;
}

export function computeCounts(items: Item[]): Counts {
  const lines: Record<string, number> = {};
  const words: Record<string, number> = {};
  let continuations = 0;
  let directions = 0;
  for (const it of items) {
    if (it.kind === 'direction') {
      directions++;
      continue;
    }
    const l: Line = it;
    words[l.speakerId] = (words[l.speakerId] ?? 0) + l.words;
    if (l.continuation) continuations++;
    else lines[l.speakerId] = (lines[l.speakerId] ?? 0) + 1;
  }
  const sortObj = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  return {
    lines: sortObj(lines),
    words: sortObj(words),
    totalLines: Object.values(lines).reduce((a, b) => a + b, 0),
    continuations,
    directions,
  };
}

export function diffCounts(expected: Counts, actual: Counts): string[] {
  const out: string[] = [];
  const cmp = (label: string, a: number | undefined, b: number | undefined) => {
    if (a !== b) out.push(`${label}: в снапшоте ${a ?? '—'}, в разборе ${b ?? '—'}`);
  };
  cmp('Всего реплик', expected.totalLines, actual.totalLines);
  cmp('Продолжений', expected.continuations, actual.continuations);
  cmp('Ремарок', expected.directions, actual.directions);
  const roles = new Set([...Object.keys(expected.lines), ...Object.keys(actual.lines)]);
  for (const r of roles) cmp(`Реплик у ${r}`, expected.lines[r], actual.lines[r]);
  const wordRoles = new Set([...Object.keys(expected.words), ...Object.keys(actual.words)]);
  for (const r of wordRoles) cmp(`Слов у ${r}`, expected.words[r], actual.words[r]);
  return out;
}
