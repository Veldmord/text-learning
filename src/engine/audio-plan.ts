// Что звучит: контекст, подсказка партнёра (полностью, последнее предложение, последние N слов), ремарки, «эхо».
// Аудиодвижок получает готовую очередь и ничего не знает о режимах (раздел 7.2).
import type { ModeId } from './modes';
import { cueFor, type PlayIndex } from './queries';
import { lastWords, words as wordsOf } from './text-transforms';
import type { Direction, Item, ItemId, Line } from './types';

export const NARRATOR = 'narrator';

export type CueLength = 'full' | 'lastSentence' | 'lastWords' | 'textOnly';
export type DirectionsMode = 'skip' | 'text' | 'voice';
/** Аудиопрогон: подсказка и тишина на своей реплике / вся пьеса подряд с остановкой на своей реплике */
export type AudioRunSpan = 'cue' | 'play';

export interface PlanSettings {
  cueLength: CueLength;
  cueWords: number;
  directions: DirectionsMode;
  /** Начинать за 0–5 реплик до моей; 0 — без звука */
  context: number;
  /** Пауза между репликами, мс */
  pauseMs: number;
}

export interface SpeechUnit {
  itemId: ItemId;
  /** id персонажа или NARRATOR для ремарок */
  speakerId: string;
  sentenceId: string;
  text: string;
  /** Часть предложения (последние N слов): клип играется целиком, фолбэк читает только text */
  partial?: boolean;
  /** Пауза после юнита, мс */
  pauseAfterMs: number;
}

/** Пауза между предложениями одной реплики */
export const SENTENCE_GAP_MS = 150;

export function lineUnits(line: Line, trim: 'full' | 'lastSentence' | 'lastWords' = 'full', nWords = 10): SpeechUnit[] {
  let sentences = line.sentences;
  const units: SpeechUnit[] = [];
  if (trim === 'lastSentence') sentences = sentences.slice(-1);
  if (trim === 'lastWords') {
    // Берём предложения с конца, пока не наберём n слов; первое из них — частичное
    const picked: typeof sentences = [];
    let count = 0;
    for (let i = sentences.length - 1; i >= 0 && count < nWords; i--) {
      picked.unshift(sentences[i]!);
      count += wordsOf(sentences[i]!.text).length;
    }
    picked.forEach((s, i) => {
      const remaining = nWords - picked.slice(i + 1).reduce((n, x) => n + wordsOf(x.text).length, 0);
      const partial = i === 0 && wordsOf(s.text).length > remaining;
      units.push({
        itemId: line.id,
        speakerId: line.speakerId,
        sentenceId: s.id,
        text: partial ? lastWords(s.text, remaining) : s.text,
        ...(partial ? { partial: true } : {}),
        pauseAfterMs: SENTENCE_GAP_MS,
      });
    });
  } else {
    for (const s of sentences) {
      units.push({ itemId: line.id, speakerId: line.speakerId, sentenceId: s.id, text: s.text, pauseAfterMs: SENTENCE_GAP_MS });
    }
  }
  return units;
}

export function directionUnits(dir: Direction): SpeechUnit[] {
  return dir.sentences.map((s) => ({
    itemId: dir.id,
    speakerId: NARRATOR,
    sentenceId: s.id,
    text: s.text,
    pauseAfterMs: SENTENCE_GAP_MS,
  }));
}

function endWithPause(units: SpeechUnit[], pauseMs: number): SpeechUnit[] {
  const last = units[units.length - 1];
  if (last) last.pauseAfterMs = pauseMs;
  return units;
}

export interface CuePlan {
  /** Реплики до подсказки и ремарки (фаза «Контекст») */
  context: SpeechUnit[];
  /** Сама подсказка партнёра (фаза «Подсказка») */
  cue: SpeechUnit[];
  /** Элементы, которые показываются текстом над скрытой репликой */
  visible: Item[];
  cueLine: Line | null;
}

/**
 * План озвучки перед моей репликой. Свои реплики в контексте показываются, но не звучат.
 * Подсказка обрезается по настройке «Длина подсказки»; «только текст» — без звука.
 */
export function cuePlan(index: PlayIndex, lineId: string, roles: string[], s: PlanSettings): CuePlan {
  const { before, cue } = cueFor(index, lineId, roles, Math.max(1, s.context));
  const visible = before.filter((it) => it.kind === 'line' || s.directions !== 'skip');
  if (s.context === 0 || s.cueLength === 'textOnly') return { context: [], cue: [], visible, cueLine: cue };

  const context: SpeechUnit[] = [];
  const cueUnits: SpeechUnit[] = [];
  const cueAt = cue ? before.indexOf(cue) : -1;
  before.forEach((it, i) => {
    const target = cueAt >= 0 && i >= cueAt ? cueUnits : context;
    if (it.kind === 'direction') {
      if (s.directions === 'voice') target.push(...endWithPause(directionUnits(it), s.pauseMs));
      return;
    }
    if (roles.includes(it.speakerId)) return;
    const trim = it === cue && s.cueLength !== 'textOnly' ? s.cueLength : 'full';
    target.push(...endWithPause(lineUnits(it, trim, s.cueWords), s.pauseMs));
  });
  return { context, cue: cueUnits, visible, cueLine: cue };
}

/**
 * План «Прогона с буквами»: на экране — сцена с начала до моей реплики (свои прошлые реплики открыты),
 * звучит целиком всё, что сказано после моей предыдущей реплики. Подсказка — последняя чужая реплика перед моей.
 * «Контекст» и «Длина подсказки» здесь не действуют; «только текст» — без звука.
 */
export function scenePlan(index: PlayIndex, lineId: string, roles: string[], s: PlanSettings): CuePlan {
  const ids = index.sceneOfItem.get(lineId)?.scene.itemIds ?? [];
  const before = ids
    .slice(0, Math.max(0, ids.indexOf(lineId as ItemId)))
    .map((id) => index.byId.get(id))
    .filter((it): it is Item => !!it);
  const visible = before.filter((it) => it.kind === 'line' || s.directions !== 'skip');
  let from = before.length;
  while (from > 0 && !isMineItem(before[from - 1]!, roles)) from--;
  return { ...spanUnits(before.slice(from), s), visible };
}

export interface PlaySpan {
  /** Элементы диапазона тренировки: дальше них назад не идём */
  inScope: ReadonlySet<string>;
  skipScenesWithoutRole: boolean;
}

/**
 * Аудиопрогон «Вся пьеса»: звучит всё, что сказано после моей предыдущей реплики, через границы сцен и действий,
 * но не раньше начала диапазона. Сцены без моей роли пропускаются по настройке. Своих реплик в плане нет — на них прогон ждёт.
 */
export function playPlan(index: PlayIndex, lineId: string, roles: string[], s: PlanSettings, o: PlaySpan): CuePlan {
  const span: Item[] = [];
  for (let i = (index.pos.get(lineId) ?? 0) - 1; i >= 0; i--) {
    const it = index.play.items[i]!;
    if (!o.inScope.has(it.id) || isMineItem(it, roles)) break;
    const scene = index.sceneOfItem.get(it.id)?.scene;
    if (o.skipScenesWithoutRole && scene && !scene.characterIds.some((c) => roles.includes(c))) continue;
    span.unshift(it);
  }
  return { ...spanUnits(span, s), visible: span.filter((it) => it.kind === 'line' || s.directions !== 'skip') };
}

/** Озвучка отрезка между своими репликами целиком: до последней чужой реплики — контекст, с неё — подсказка. */
function spanUnits(span: Item[], s: PlanSettings): Omit<CuePlan, 'visible'> {
  const cueLine = [...span].reverse().find((it): it is Line => it.kind === 'line') ?? null;
  if (s.cueLength === 'textOnly') return { context: [], cue: [], cueLine };
  const context: SpeechUnit[] = [];
  const cue: SpeechUnit[] = [];
  const cueAt = cueLine ? span.indexOf(cueLine) : span.length;
  span.forEach((it, i) => {
    const units = it.kind === 'line' ? lineUnits(it) : s.directions === 'voice' ? directionUnits(it) : [];
    (i >= cueAt ? cue : context).push(...endWithPause(units, s.pauseMs));
  });
  return { context, cue, cueLine };
}

const isMineItem = (it: Item, roles: string[]) => it.kind === 'line' && roles.includes(it.speakerId);

/** Что видно и звучит перед шагом: в «Прогоне с буквами» — сцена, в остальных режимах — подсказка с контекстом. */
export const stepPlan = (mode: ModeId, index: PlayIndex, lineId: string, roles: string[], s: PlanSettings): CuePlan =>
  (mode === 'run' ? scenePlan : cuePlan)(index, lineId, roles, s);

/** Озвучка своей реплики после «Показать» («эхо») или в читке. */
export function echoUnits(line: Line, sentenceIdx?: number[]): SpeechUnit[] {
  const units = lineUnits(line, 'full');
  return sentenceIdx ? units.filter((_, i) => sentenceIdx.includes(i)) : units;
}

/** Темп речи для оценок длительности без клипов: ~14 символов в секунду на 1× */
export const CHARS_PER_SECOND = 14;

export function estimateMs(text: string): number {
  return Math.round((text.length / CHARS_PER_SECOND) * 1000);
}

/** Длительность своей реплики на скорости 1×: по клипам манифеста, иначе по темпу речи. */
export function lineDurationMs(line: Line, clipMs: (sentenceId: string) => number | undefined, sentenceIdx?: number[]): number {
  const sentences = sentenceIdx ? sentenceIdx.map((i) => line.sentences[i]!).filter(Boolean) : line.sentences;
  return sentences.reduce((sum, s) => sum + (clipMs(s.id) ?? estimateMs(s.text)) + SENTENCE_GAP_MS, 0);
}

/** Все реплики и ремарки сцены для «Знакомства» — от элемента `fromId` до конца сцены. */
export function readThroughUnits(index: PlayIndex, fromId: string, s: Pick<PlanSettings, 'directions' | 'pauseMs'>): SpeechUnit[] {
  const ref = index.sceneOfItem.get(fromId);
  if (!ref) return [];
  const ids = ref.scene.itemIds.slice(ref.scene.itemIds.indexOf(fromId as ItemId));
  return ids.flatMap((id) => {
    const it = index.byId.get(id);
    if (!it) return [];
    if (it.kind === 'direction') return s.directions === 'voice' ? endWithPause(directionUnits(it), s.pauseMs) : [];
    return endWithPause(lineUnits(it), s.pauseMs);
  });
}
