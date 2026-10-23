// Разбор текста пьесы в модель play.json. Грамматика — docs/ARCHITECTURE.md, раздел 9.1.
import { createHash } from 'node:crypto';
import type { Character, Direction, Gender, Item, Line, Segment } from '../../src/engine/types';
import { directionSentences, lineSentences, speechOfSegments } from '../../src/engine/play-format';
import { collapseSpaces, countWords } from '../../src/engine/text-transforms';

export interface CharacterConfig {
  id: string;
  name: string;
  aliases: string[];
  group?: string;
  gender: Gender;
}

export interface LineOverride {
  kind?: 'line' | 'direction' | 'skip';
  speaker?: string;
  continuation?: boolean;
  text?: string;
}

export type Overrides = Record<number, LineOverride>;

export interface ParsedAct {
  n: number;
  title: string;
  itemIds: string[];
}

export interface ParseResult {
  title: string;
  author: string;
  subtitle: string;
  preface: string[];
  cast: string[];
  sourceHash: string;
  characters: Character[];
  items: Item[];
  acts: ParsedAct[];
  errors: string[];
}

const ACT_START = /^Действие (первое|второе|третье|четвёртое|четвертое)$/;
const ACT_END = /^(Конец (первого|второго|третьего) действия\.|Конец\.?)$/;
const SPEECH = /^([А-ЯЁ][А-ЯЁ ]*[А-ЯЁ])\.\s+(.*)$/;
const CONTINUATION = /^[ \t]{4,}\S/;
const ORDINALS: Record<string, number> = { первое: 1, второе: 2, третье: 3, четвёртое: 4, четвертое: 4 };

export const sha1 = (text: string) => createHash('sha1').update(text, 'utf8').digest('hex');

/** Убирает артефакты вёрстки: «¬», мягкие переносы, неразрывные пробелы, хвостовые пробелы. */
export function normalizeSourceLine(raw: string): string {
  return raw.replace(/[\u00ac\u00ad\u200b\ufeff]/g, '').replace(/\u00a0/g, ' ').replace(/\s+$/, '');
}

/** Делит текст реплики на речь и inline-ремарки «(…)». */
export function splitSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  const re = /\(([^()]*)\)/g;
  let last = 0;
  const pushSpeech = (s: string) => {
    const t = collapseSpaces(s);
    if (t) segments.push({ kind: 'speech', text: t });
  };
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    pushSpeech(text.slice(last, at));
    const aside = collapseSpaces(m[1] ?? '');
    if (aside) segments.push({ kind: 'aside', text: aside });
    last = at + m[0].length;
  }
  pushSpeech(text.slice(last));
  return segments;
}

const pad = (n: number) => String(n).padStart(4, '0');

export function parsePlay(source: string, characterConfig: CharacterConfig[], overrides: Overrides = {}): ParseResult {
  const errors: string[] = [];
  const rawLines = source.split(/\r?\n/);
  const lines = rawLines.map(normalizeSourceLine);

  const aliasMap = new Map<string, CharacterConfig>();
  for (const c of characterConfig) {
    for (const a of [...c.aliases, c.name.toUpperCase()]) aliasMap.set(a.toUpperCase().replace(/Ё/g, 'Е'), c);
  }
  const resolveSpeaker = (name: string) => aliasMap.get(name.toUpperCase().replace(/Ё/g, 'Е'));

  // --- Метаданные до «Действие первое»
  const firstAct = lines.findIndex((l) => ACT_START.test(l.trim()));
  if (firstAct < 0) errors.push('Не найдено начало первого действия');
  const metaLines = lines
    .slice(0, Math.max(firstAct, 0))
    .map((l) => l.trim())
    .filter((l) => l && !/^\d+$/.test(l));
  const prefaceAt = metaLines.findIndex((l) => /^Предисловие/.test(l));
  const castAt = metaLines.findIndex((l) => /^Действующие лица$/.test(l));
  const head = metaLines.slice(0, prefaceAt >= 0 ? prefaceAt : castAt >= 0 ? castAt : metaLines.length);
  const author = head[0] ?? '';
  const title = head[1] ?? '';
  const subtitle = head.slice(2).join(' ');
  const preface = prefaceAt >= 0 ? metaLines.slice(prefaceAt + 1, castAt >= 0 ? castAt : undefined) : [];
  const cast = castAt >= 0 ? metaLines.slice(castAt + 1) : [];

  // --- Тело пьесы
  const items: Item[] = [];
  const acts: ParsedAct[] = [];
  let currentAct: ParsedAct | null = null;
  let lineNo = 0;
  let dirNo = 0;
  let lastSpeaker: string | null = null;

  const pushLine = (speakerId: string, text: string, continuation: boolean, src: number) => {
    const segments = splitSegments(text);
    const speech = speechOfSegments(segments);
    const id = `L${pad(++lineNo)}` as const;
    const sentences = lineSentences(id, speech);
    if (!speech) errors.push(`Стр. ${src}: реплика без речи (${speakerId})`);
    const line: Line = {
      kind: 'line',
      id,
      speakerId,
      segments,
      sentences,
      continuation,
      textHash: sha1(speech).slice(0, 8),
      words: countWords(speech),
      src,
    };
    items.push(line);
    currentAct?.itemIds.push(id);
    lastSpeaker = speakerId;
  };

  const pushDirection = (text: string, src: number) => {
    const clean = collapseSpaces(text);
    const id = `D${pad(++dirNo)}` as const;
    const sentences = directionSentences(id, clean);
    const dir: Direction = { kind: 'direction', id, text: clean, sentences, src };
    items.push(dir);
    currentAct?.itemIds.push(id);
  };

  for (let i = Math.max(firstAct, 0); i < lines.length; i++) {
    const src = i + 1;
    const ov = overrides[src];
    const line = ov?.text !== undefined && ov.kind !== 'line' ? ov.text : lines[i]!;
    const trimmed = line.trim();
    if (ov?.kind === 'skip') continue;

    if (ov?.kind === 'line') {
      const speaker = ov.speaker ?? lastSpeaker;
      if (!speaker || !characterConfig.some((c) => c.id === speaker)) {
        errors.push(`Стр. ${src}: override без известного speaker`);
        continue;
      }
      const m = SPEECH.exec(trimmed);
      const text = ov.text ?? (m ? m[2]! : trimmed);
      pushLine(speaker, text, ov.continuation ?? !m, src);
      continue;
    }
    if (ov?.kind === 'direction') {
      if (!currentAct) errors.push(`Стр. ${src}: ремарка вне действия`);
      pushDirection(trimmed, src);
      continue;
    }

    if (!trimmed) continue;

    const actStart = ACT_START.exec(trimmed);
    if (actStart) {
      currentAct = { n: ORDINALS[actStart[1]!] ?? acts.length + 1, title: trimmed, itemIds: [] };
      acts.push(currentAct);
      lastSpeaker = null;
      continue;
    }
    if (ACT_END.test(trimmed)) {
      currentAct = null;
      continue;
    }
    if (!currentAct) {
      errors.push(`Стр. ${src}: текст вне действия: «${trimmed.slice(0, 40)}»`);
      continue;
    }

    if (CONTINUATION.test(line)) {
      if (!lastSpeaker) {
        errors.push(`Стр. ${src}: продолжение реплики без предыдущего говорившего`);
        continue;
      }
      pushLine(lastSpeaker, trimmed, true, src);
      continue;
    }

    const m = SPEECH.exec(trimmed);
    if (m) {
      const who = resolveSpeaker(m[1]!.replace(/\s+/g, ' '));
      if (!who) {
        errors.push(`Стр. ${src}: неизвестное имя «${m[1]}»`);
        continue;
      }
      pushLine(who.id, m[2]!, false, src);
      continue;
    }

    pushDirection(trimmed, src);
  }

  // --- Персонажи: говорящие по репликам, немые — из списка действующих лиц
  const speakingIds = new Set(items.filter((it): it is Line => it.kind === 'line').map((l) => l.speakerId));
  const characters: Character[] = characterConfig.map((c) => ({
    id: c.id,
    name: c.name,
    aliases: c.aliases,
    ...(c.group ? { group: c.group } : {}),
    speaking: speakingIds.has(c.id),
    gender: c.gender,
  }));
  const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е');
  for (const entry of cast) {
    const known = characterConfig.some((c) => norm(c.name) === norm(entry) || (c.group && norm(c.group) === norm(entry)));
    if (!known) errors.push(`Действующее лицо «${entry}» отсутствует в content/characters.yaml`);
  }

  return {
    title,
    author,
    subtitle,
    preface,
    cast,
    sourceHash: sha1(source.replace(/\r\n/g, '\n')),
    characters,
    items,
    acts,
    errors,
  };
}
