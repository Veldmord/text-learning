// «Скачать роль для офлайна» (раздел 11.1): клипы всех сцен с выбранными ролями — свои реплики,
// подсказки и ремарки — загружаются порциями по 6 в кэш audio-v1, который обслуживает Service Worker.
import { scenesWithRoles, type PlayIndex } from '../engine/queries';
import type { AudioManifest } from '../engine/types';

export const AUDIO_CACHE = 'audio-v1';
export const DOWNLOAD_CONCURRENCY = 6;
/** MP3 48 кбит/с ≈ 6 байт на миллисекунду */
const BYTES_PER_MS = 6;

export interface ClipSet {
  files: string[];
  bytes: number;
}

/** Пути клипов относительно base: audio/<hash>.mp3. Клип тишины входит в precache и здесь не нужен. */
export function clipsForRoles(index: PlayIndex, manifest: AudioManifest, roles: string[]): ClipSet {
  const files = new Map<string, number>();
  for (const ref of scenesWithRoles(index, roles)) {
    for (const id of ref.scene.itemIds) {
      const item = index.byId.get(id);
      for (const s of item?.sentences ?? []) {
        const clip = manifest.clips[s.id];
        if (clip) files.set(`audio/${clip.f}`, clip.ms);
      }
    }
  }
  return { files: [...files.keys()], bytes: [...files.values()].reduce((n, ms) => n + ms * BYTES_PER_MS, 0) };
}

const cachesAvailable = () => typeof caches !== 'undefined';

export const clipUrl = (baseUrl: string, path: string) => `${baseUrl}${path}`;

export async function missingFiles(baseUrl: string, files: string[]): Promise<string[]> {
  if (!cachesAvailable()) return files;
  const cache = await caches.open(AUDIO_CACHE);
  const out: string[] = [];
  for (const f of files) {
    if (!(await cache.match(clipUrl(baseUrl, f)))) out.push(f);
  }
  return out;
}

export interface DownloadProgress {
  done: number;
  total: number;
  failed: number;
}

export async function downloadFiles(
  baseUrl: string,
  files: string[],
  onProgress: (p: DownloadProgress) => void,
  signal: AbortSignal,
): Promise<DownloadProgress> {
  const progress: DownloadProgress = { done: 0, total: files.length, failed: 0 };
  if (!cachesAvailable()) throw new Error('Браузер не поддерживает Cache Storage — офлайн-загрузка недоступна');
  const cache = await caches.open(AUDIO_CACHE);
  for (let i = 0; i < files.length; i += DOWNLOAD_CONCURRENCY) {
    if (signal.aborted) break;
    const batch = files.slice(i, i + DOWNLOAD_CONCURRENCY);
    await Promise.all(
      batch.map(async (f) => {
        const url = clipUrl(baseUrl, f);
        try {
          const res = await fetch(url, { signal });
          if (!res.ok) throw new Error(String(res.status));
          await cache.put(url, res);
        } catch {
          if (!signal.aborted) progress.failed++;
        }
        progress.done++;
      }),
    );
    onProgress({ ...progress });
  }
  return progress;
}

/** Удаляет из кэша клипы, которые не нужны текущим ролям. Возвращает число удалённых. */
export async function pruneAudioCache(baseUrl: string, keep: string[]): Promise<number> {
  if (!cachesAvailable()) return 0;
  const cache = await caches.open(AUDIO_CACHE);
  const keepUrls = new Set(keep.map((f) => new URL(clipUrl(baseUrl, f), location.href).href));
  let removed = 0;
  for (const req of await cache.keys()) {
    if (!keepUrls.has(req.url)) {
      await cache.delete(req);
      removed++;
    }
  }
  return removed;
}

export async function cachedAudioCount(): Promise<number> {
  if (!cachesAvailable()) return 0;
  return (await (await caches.open(AUDIO_CACHE)).keys()).length;
}

export async function loadManifest(baseUrl: string): Promise<AudioManifest | null> {
  try {
    const res = await fetch(`${baseUrl}audio/audio-manifest.json`, { cache: 'no-cache' });
    if (!res.ok) return null;
    const m = (await res.json()) as AudioManifest;
    // Пустой манифест (TTS ещё не запускали) равносилен отсутствию озвучки
    return m && typeof m.clips === 'object' && Object.keys(m.clips).length > 0 ? m : null;
  } catch {
    return null;
  }
}
