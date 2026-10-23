// Голоса и задания синтеза: какой клип нужен для каждого предложения. Без Python — работает в CI до установки torch.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { hydratePlay, type StoredPlay } from '../../src/engine/play-format';
import type { Play } from '../../src/engine/types';
import { normalizeForTts, stressForPiper, type Pronunciations } from './normalize';

/** Меняется при любом изменении постобработки (ffmpeg, нормализация) — тогда перегенерируется всё. */
export const PIPELINE_VERSION = 1;
export const NARRATOR = 'narrator';
export const ROOT = resolve(import.meta.dirname, '../..');

export interface VoiceSpec {
  engine: 'silero' | 'piper';
  model?: string;
  speaker?: string;
  voice?: string;
  rate: number;
  pitch: number;
}

export interface VoicesConfig {
  defaults?: Partial<VoiceSpec>;
  narrator?: Partial<VoiceSpec>;
  characters?: Record<string, Partial<VoiceSpec>>;
}

export interface Job {
  key: string;
  sentenceId: string;
  engine: VoiceSpec['engine'];
  /** silero: model:speaker; piper: имя голоса */
  voice: string;
  rate: number;
  pitch: number;
  /** Нормализованный текст для синтеза (с ударениями в формате движка) */
  text: string;
}

export function resolveVoice(cfg: VoicesConfig, speakerId: string): VoiceSpec {
  const own = speakerId === NARRATOR ? cfg.narrator : cfg.characters?.[speakerId];
  const v = { engine: 'silero', rate: 1, pitch: 0, ...cfg.defaults, ...own } as VoiceSpec;
  if (v.engine === 'silero' && !v.speaker) throw new Error(`voices.yaml: у «${speakerId}» не указан speaker Silero`);
  if (v.engine === 'piper' && !v.voice) throw new Error(`voices.yaml: у «${speakerId}» не указан голос Piper`);
  return v;
}

export const voiceName = (v: VoiceSpec) => (v.engine === 'silero' ? `${v.model ?? 'v5_ru'}:${v.speaker}` : v.voice!);

export function clipKey(v: VoiceSpec, text: string): string {
  return createHash('sha256')
    .update([v.engine, voiceName(v), v.rate, v.pitch, text, PIPELINE_VERSION].join('|'))
    .digest('hex')
    .slice(0, 16);
}

export function buildJobs(play: Play, voices: VoicesConfig, dict: Pronunciations): Job[] {
  const jobs: Job[] = [];
  for (const item of play.items) {
    const speaker = item.kind === 'line' ? item.speakerId : NARRATOR;
    const v = resolveVoice(voices, speaker);
    for (const s of item.sentences) {
      let text = normalizeForTts(s.text, s.id, dict);
      if (!text || !/[\p{L}\p{N}]/u.test(text)) continue;
      if (v.engine === 'piper') text = stressForPiper(text);
      jobs.push({ key: clipKey(v, text), sentenceId: s.id, engine: v.engine, voice: voiceName(v), rate: v.rate, pitch: v.pitch, text });
    }
  }
  return jobs;
}

const readYaml = <T>(file: string, fallback: T): T => (existsSync(file) ? ((parseYaml(readFileSync(file, 'utf8')) as T | null) ?? fallback) : fallback);

export function loadInputs(playFile = resolve(ROOT, 'src/data/play.json')) {
  if (!existsSync(playFile)) throw new Error(`Нет ${playFile} — сначала npm run parse`);
  const play = hydratePlay(JSON.parse(readFileSync(playFile, 'utf8')) as StoredPlay);
  const voices = readYaml<VoicesConfig>(resolve(ROOT, 'content/voices.yaml'), {});
  const dict = readYaml<Pronunciations>(resolve(ROOT, 'content/pronunciations.yaml'), {});
  return { play, voices, dict };
}

export function argValue(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}
