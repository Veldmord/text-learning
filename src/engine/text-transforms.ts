// Текстовые трансформации: слова, предложения, первые буквы, исчезающий текст, пословный diff.
// Правила — docs/ARCHITECTURE.md, раздел 5.2. Модуль без зависимостей от браузера.

/** Слово — буквы/цифры, дефисные слова (по-своему, кафе-то, Пер-ва-я) — одно слово. */
const WORD_RE = /[\p{L}\p{N}]+(?:[-‐'’][\p{L}\p{N}]+)*/gu;

export type Token =
  | { kind: 'word'; text: string; index: number }
  | { kind: 'sep'; text: string };

export function tokenize(text: string, startIndex = 0): Token[] {
  const out: Token[] = [];
  let last = 0;
  let wi = startIndex;
  for (const m of text.matchAll(WORD_RE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: 'sep', text: text.slice(last, at) });
    out.push({ kind: 'word', text: m[0], index: wi++ });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'sep', text: text.slice(last) });
  return out;
}

export function words(text: string): string[] {
  return text.match(WORD_RE) ?? [];
}

export function countWords(text: string): number {
  return words(text).length;
}

export function collapseSpaces(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Первые буквы

const isNumber = (w: string) => /^\p{N}+$/u.test(w);

/** «по-своему» → «п-с», «Моцарта» → «М», числа без изменений. */
export function firstLettersOfWord(word: string): string {
  if (isNumber(word)) return word;
  return word
    .split(/([-‐'’])/)
    .map((part, i) => (i % 2 === 1 ? part : (Array.from(part)[0] ?? '')))
    .join('');
}

/** «Ты не слушаешь, что я говорю.» → «Т н с, ч я г.» — пунктуация, тире и кавычки сохраняются. */
export function firstLetters(text: string): string {
  return tokenize(text)
    .map((t) => (t.kind === 'sep' ? t.text : firstLettersOfWord(t.text)))
    .join('');
}

// ---------------------------------------------------------------------------
// Исчезающий текст

export const VANISH_LEVELS = [25, 50, 75, 100] as const;
export type VanishLevel = 0 | 1 | 2 | 3;

/** FNV-1a 32 бита + финализатор murmur3: детерминированный и хорошо перемешанный. */
export function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Маска скрытых слов. Порядок исчезания задаётся детерминированно от lineId, уровень задаёт долю.
 * Поэтому при повторе скрываются те же слова, а на следующем уровне — их надмножество.
 */
export function vanishMask(lineId: string, wordCount: number, percent: number): boolean[] {
  const mask = new Array<boolean>(wordCount).fill(false);
  if (wordCount === 0 || percent <= 0) return mask;
  const order = Array.from({ length: wordCount }, (_, i) => ({ i, r: hash32(`${lineId}#${i}`) }));
  order.sort((a, b) => a.r - b.r || a.i - b.i);
  const hidden = percent >= 100 ? wordCount : Math.ceil((wordCount * percent) / 100);
  for (let j = 0; j < hidden; j++) mask[order[j]!.i] = true;
  return mask;
}

// ---------------------------------------------------------------------------
// Предложения

const SENTENCE_END = /([.!?…]+)([»"”’)]*)(\s+)/gu;
const NEXT_STARTS_SENTENCE = /^[\p{Lu}«"„“—–-]/u;
const ABBREVIATION = /(?:^|[\s(«"„])(?:т\.\s?[дпе]|и\.\s?т\.\s?д|др|пр|см)\.$/iu;
/** Однобуквенные русские слова в верхнем регистре, которые не являются инициалами. */
const SINGLE_LETTER_WORDS = new Set(['Я', 'А', 'И', 'О', 'У', 'В', 'С', 'К']);

function endsWithInitial(chunk: string): boolean {
  const m = /(?:^|[\s(«"„])(\p{Lu})\.$/u.exec(chunk);
  return !!m && !SINGLE_LETTER_WORDS.has(m[1]!);
}

/**
 * Граница предложения — «.», «!», «?», «…» перед пробелом и заглавной буквой, кавычкой или тире.
 * Исключения: «т.д.», «т.п.», инициалы.
 */
export function splitSentences(text: string): string[] {
  const src = collapseSpaces(text);
  if (!src) return [];
  const out: string[] = [];
  let start = 0;
  for (const m of src.matchAll(SENTENCE_END)) {
    const at = m.index ?? 0;
    const end = at + m[1]!.length + m[2]!.length;
    const next = src.slice(end + m[3]!.length);
    if (!NEXT_STARTS_SENTENCE.test(next)) continue;
    const chunk = src.slice(start, end);
    if (m[1] === '.' && (ABBREVIATION.test(chunk) || endsWithInitial(chunk))) continue;
    const s = chunk.trim();
    if (s) out.push(s);
    start = end;
  }
  const tail = src.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

/**
 * Группирует предложения длинной реплики в смысловые части для режима «Монолог по частям».
 * Часть набирается, пока в ней меньше targetWords слов; слишком короткий хвост присоединяется к предыдущей.
 */
export function chunkSentences(sentences: string[], targetWords = 20, minTail = 8): number[][] {
  const chunks: number[][] = [];
  let cur: number[] = [];
  let curWords = 0;
  sentences.forEach((s, i) => {
    cur.push(i);
    curWords += countWords(s);
    if (curWords >= targetWords) {
      chunks.push(cur);
      cur = [];
      curWords = 0;
    }
  });
  if (cur.length) {
    const last = chunks[chunks.length - 1];
    if (last && curWords < minTail) last.push(...cur);
    else chunks.push(cur);
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Подсказка: хвост реплики

/** Последние n слов с исходной пунктуацией, с многоточием в начале, если текст обрезан. */
export function lastWords(text: string, n: number): string {
  const tokens = tokenize(text);
  const total = tokens.filter((t) => t.kind === 'word').length;
  if (total <= n) return text.trim();
  const from = total - n;
  let offset = 0;
  for (const t of tokens) {
    if (t.kind === 'word' && t.index === from) break;
    offset += t.text.length;
  }
  return `…${text.slice(offset).trim()}`;
}

// ---------------------------------------------------------------------------
// Пословное сравнение для режима «Письменный ввод»

export function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/ё/g, 'е').replace(/[‐'’]/g, '-');
}

export type DiffOp =
  | { op: 'eq'; expected: string; typed: string }
  | { op: 'sub'; expected: string; typed: string }
  | { op: 'del'; expected: string }
  | { op: 'ins'; typed: string };

export interface DiffResult {
  ops: DiffOp[];
  errors: number;
  accuracy: number;
  suggested: 'good' | 'hard' | 'again';
}

/** LCS по нормализованным словам; соседние пропуск+вставка сливаются в замену. */
export function wordDiff(expectedText: string, typedText: string): DiffResult {
  const a = words(expectedText);
  const b = words(typedText);
  const na = a.map(normalizeWord);
  const nb = b.map(normalizeWord);
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = na[i] === nb[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const raw: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (na[i] === nb[j]) {
      raw.push({ op: 'eq', expected: a[i]!, typed: b[j]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      raw.push({ op: 'del', expected: a[i++]! });
    } else {
      raw.push({ op: 'ins', typed: b[j++]! });
    }
  }
  while (i < n) raw.push({ op: 'del', expected: a[i++]! });
  while (j < m) raw.push({ op: 'ins', typed: b[j++]! });

  const ops: DiffOp[] = [];
  for (let k = 0; k < raw.length; k++) {
    const cur = raw[k]!;
    const next = raw[k + 1];
    if (cur.op === 'del' && next?.op === 'ins') {
      ops.push({ op: 'sub', expected: cur.expected, typed: next.typed });
      k++;
    } else if (cur.op === 'ins' && next?.op === 'del') {
      ops.push({ op: 'sub', expected: next.expected, typed: cur.typed });
      k++;
    } else {
      ops.push(cur);
    }
  }
  const errors = ops.filter((o) => o.op !== 'eq').length;
  const accuracy = n === 0 ? (m === 0 ? 1 : 0) : Math.max(0, 1 - errors / n);
  const suggested = errors === 0 ? 'good' : accuracy >= 0.8 ? 'hard' : 'again';
  return { ops, errors, accuracy, suggested };
}

/** Перемешивание Фишера — Йейтса с детерминированным seed: одинаковый порядок при повторе. */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const out = [...items];
  let state = hash32(seed) || 1;
  const rnd = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
