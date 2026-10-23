// Нормализация текста перед синтезом (раздел 9.3): inline-ремарки удаляются, числа — словами,
// «т.д.» → «так далее», тире и многоточие — паузы, кавычки удаляются, применяется словарь произношения.
// Нормализованный текст входит в хэш имени клипа, поэтому любая правка правила перегенерирует только затронутые фразы.

export interface Pronunciations {
  global?: Record<string, string>;
  lines?: Record<string, { from: string; to: string }>;
}

const UNITS_M = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const UNITS_F = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const TEENS = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
const TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
const HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];

function plural(n: number, forms: [string, string, string]): string {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return forms[0];
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return forms[1];
  return forms[2];
}

function triad(n: number, feminine: boolean): string[] {
  const out: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h) out.push(HUNDREDS[h]!);
  if (rest >= 10 && rest < 20) out.push(TEENS[rest - 10]!);
  else {
    if (rest >= 20) out.push(TENS[Math.floor(rest / 10)]!);
    const u = rest % 10;
    if (u) out.push((feminine ? UNITS_F : UNITS_M)[u]!);
  }
  return out;
}

/** Количественное числительное в именительном падеже (до миллиардов). */
export function numberToWords(n: number): string {
  if (!Number.isInteger(n) || n < 0) return String(n);
  if (n === 0) return 'ноль';
  const scales: [number, [string, string, string], boolean][] = [
    [1e9, ['миллиард', 'миллиарда', 'миллиардов'], false],
    [1e6, ['миллион', 'миллиона', 'миллионов'], false],
    [1e3, ['тысяча', 'тысячи', 'тысяч'], true],
  ];
  const words: string[] = [];
  let rest = n;
  for (const [scale, forms, feminine] of scales) {
    const k = Math.floor(rest / scale);
    if (k) {
      words.push(...triad(k, feminine), plural(k, forms));
      rest %= scale;
    }
  }
  words.push(...triad(rest, false));
  return words.join(' ');
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Сохраняет регистр первой буквы исходного слова: «Гайдна» + «г+айдн» → «Г+айдна». */
function matchCase(source: string, replacement: string): string {
  const first = source[0] ?? '';
  if (first !== first.toUpperCase() || first === first.toLowerCase()) return replacement;
  const i = replacement[0] === '+' ? 1 : 0;
  return replacement.slice(0, i) + replacement.charAt(i).toUpperCase() + replacement.slice(i + 1);
}

function replaceWordStart(text: string, from: string, to: string, all: boolean): string {
  const re = new RegExp(`(?<![\\p{L}+])${escapeRe(from)}`, all ? 'giu' : 'iu');
  return text.replace(re, (m) => matchCase(m, to));
}

export function normalizeForTts(text: string, sentenceId: string, dict: Pronunciations = {}): string {
  const lineId = sentenceId.startsWith('S') && !sentenceId.startsWith('SD') ? `L${sentenceId.slice(1).split('.')[0]}` : null;
  // В репликах скобки — inline-ремарки, их не озвучиваем; в ремарках это пояснение, его читает рассказчик
  let t = lineId ? text.replace(/\([^)]*\)/g, ' ') : text.replace(/\s*\(([^)]*)\)/g, ', $1,');
  const lineRule = lineId ? dict.lines?.[lineId] : undefined;
  if (lineRule) t = replaceWordStart(t, lineRule.from, lineRule.to, false);
  for (const [from, to] of Object.entries(dict.global ?? {})) t = replaceWordStart(t, from, to, true);
  t = t
    .replace(/(^|[\s(])т\.\s?д\./giu, '$1так далее')
    .replace(/(^|[\s(])т\.\s?п\./giu, '$1тому подобное')
    .replace(/(^|[\s(])т\.\s?е\./giu, '$1то есть')
    .replace(/\d+/g, (d) => numberToWords(Number(d)))
    .replace(/[«»"„“”]/g, '')
    .replace(/\s+[–—-]\s+/g, ', ')
    .replace(/^[–—-]\s*/, '')
    .replace(/(\.\.\.|…)(?=\s*\S)/g, ', ')
    .replace(/(\.\.\.|…)\s*$/, '.')
    .replace(/,\s*,/g, ',')
    .replace(/,\s*([.!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return t;
}

/** Ударения: Silero понимает «+» перед гласной, Piper (espeak) — знак ударения U+0301 после неё. */
export function stressForPiper(text: string): string {
  return text.replace(/\+([аеёиоуыэюяАЕЁИОУЫЭЮЯ])/g, `$1${String.fromCharCode(0x301)}`);
}
