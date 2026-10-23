// Синглтоны инфраструктуры: репозиторий IndexedDB, аудиодвижок, журнал ошибок.
import { NARRATOR } from '../engine/audio-plan';
import { AudioEngine } from '../audio/player';
import type { VoiceSpec } from '../audio/tts-fallback';
import { getDb } from '../storage/db';
import { Repo } from '../storage/repo';
import { reportError } from './errors';
import { BASE_URL, getSettings, useApp, usePlayback } from './store';

export const repo = new Repo(getDb());

export { reportError } from './errors';

export function rateFor(speakerId: string): number {
  const s = getSettings();
  return s.speed * (s.characterRate[speakerId] ?? 1);
}

export function voiceFor(speakerId: string): VoiceSpec {
  if (speakerId === NARRATOR) return { gender: 'm', key: NARRATOR };
  const c = useApp.getState().index?.characters.get(speakerId);
  return { gender: c?.gender ?? 'm', key: speakerId };
}

let engine: AudioEngine | null = null;

export function audioEngine(): AudioEngine {
  engine ??= new AudioEngine({
    baseUrl: BASE_URL,
    manifest: () => useApp.getState().manifest,
    rateFor,
    voiceFor,
    onUnit: (u) => usePlayback.getState().set(u),
    onError: (e) => reportError(e, 'audio'),
  });
  return engine;
}

export const clipMs = (sentenceId: string): number | undefined => useApp.getState().manifest?.clips[sentenceId]?.ms;

let persistRequested = false;

/** navigator.storage.persist() запрашивается при первой оценке (раздел 11.2). */
export async function requestPersist(): Promise<boolean> {
  if (persistRequested || typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
  persistRequested = true;
  try {
    return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch {
    return false;
  }
}
