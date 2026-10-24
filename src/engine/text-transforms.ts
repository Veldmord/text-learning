// Текстовые трансформации: слова, предложения, первые буквы, хвост подсказки, хэш.
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
// Хэш

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
