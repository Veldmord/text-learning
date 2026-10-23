// Модель пьесы (play.json) — общая для парсера (tools/parser) и приложения.
// См. docs/ARCHITECTURE.md, раздел 8.1.

export type LineId = `L${string}`;
export type DirectionId = `D${string}`;
export type ItemId = LineId | DirectionId;

export interface Sentence {
  /** S0042.1 — предложение реплики L0042; SD0007.1 — предложение ремарки D0007 */
  id: string;
  text: string;
}

export interface Segment {
  kind: 'speech' | 'aside';
  text: string;
}

export interface Line {
  kind: 'line';
  id: LineId;
  speakerId: string;
  segments: Segment[];
  /** Только речь, без inline-ремарок */
  sentences: Sentence[];
  /** Продолжение реплики того же персонажа после ремарки */
  continuation: boolean;
  /** sha1(речь).slice(0, 8) — по нему точечно сбрасывается прогресс при правке текста */
  textHash: string;
  words: number;
  /** Номер строки исходного файла (для диагностики и overrides.yaml) */
  src: number;
}

export interface Direction {
  kind: 'direction';
  id: DirectionId;
  text: string;
  sentences: Sentence[];
  src: number;
}

export type Item = Line | Direction;

export type Gender = 'm' | 'f';

export interface Character {
  id: string;
  name: string;
  aliases: string[];
  group?: string;
  speaking: boolean;
  gender: Gender;
}

export interface Scene {
  id: string;
  title: string;
  itemIds: ItemId[];
  /** Говорящие в сцене персонажи */
  characterIds: string[];
}

export interface Act {
  n: number;
  title: string;
  scenes: Scene[];
}

export interface Play {
  id: string;
  title: string;
  author: string;
  subtitle: string;
  preface: string[];
  /** sha1 исходного текста */
  sourceHash: string;
  characters: Character[];
  /** Все реплики и ремарки в порядке документа */
  items: Item[];
  acts: Act[];
}

export interface AudioClip {
  /** Имя файла в audio/ */
  f: string;
  /** Длительность, мс */
  ms: number;
}

export interface AudioManifest {
  pipelineVersion: number;
  clips: Record<string, AudioClip>;
  silence: string;
}

export const isLine = (item: Item | undefined): item is Line => item?.kind === 'line';
export const isDirection = (item: Item | undefined): item is Direction => item?.kind === 'direction';
