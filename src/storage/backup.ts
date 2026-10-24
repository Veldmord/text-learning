// Резервная копия прогресса (раздел 11.3). Импорт сливает данные по updatedAt — побеждает последнее изменение,
// поэтому одним файлом можно переносить прогресс между устройствами в обе стороны.
import type { CursorRow, FavoriteRow, SessionRow } from '../engine/model';
import { isModeId } from '../engine/modes';
import type { TextLearningDB } from './db';
import { sanitizeSettings, type Settings } from './settings';

export const BACKUP_FORMAT = 'text-learning-backup';
/** 2 — журнал сессий и избранное. Из копий версии 1 (оценки, заметки) переносятся только позиции и настройки. */
export const BACKUP_VERSION = 2;

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  playId: string;
  playSourceHash: string;
  exportedAt: string;
  settings: Settings;
  sessions: SessionRow[];
  favorites: FavoriteRow[];
  cursors: CursorRow[];
}

export async function exportBackup(db: TextLearningDB, meta: { playId: string; playSourceHash: string; settings: Settings }): Promise<Backup> {
  const [sessions, favorites, cursors] = await Promise.all([db.sessions.toArray(), db.favorites.toArray(), db.cursors.toArray()]);
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    playId: meta.playId,
    playSourceHash: meta.playSourceHash,
    exportedAt: new Date().toISOString(),
    settings: meta.settings,
    sessions,
    favorites,
    cursors,
  };
}

export class BackupError extends Error {}

const isSession = (s: Partial<SessionRow> | null | undefined): s is SessionRow =>
  typeof s?.id === 'string' &&
  typeof s.rolesKey === 'string' &&
  isModeId(s.mode) &&
  typeof s.startedAt === 'number' &&
  typeof s.updatedAt === 'number' &&
  typeof s.activeMs === 'number' &&
  typeof s.lines === 'number' &&
  Array.isArray(s.scenes) &&
  s.scenes.every((x) => typeof x === 'string');

export function parseBackup(text: string, playId: string): Backup {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BackupError('Файл не является JSON');
  }
  const b = data as Partial<Backup>;
  if (b.format !== BACKUP_FORMAT) throw new BackupError('Это не файл резервной копии «Учить текст»');
  if (typeof b.version !== 'number' || b.version > BACKUP_VERSION) {
    throw new BackupError('Резервная копия создана более новой версией приложения — обновите приложение');
  }
  if (b.playId !== playId) throw new BackupError(`Резервная копия относится к другой пьесе (${String(b.playId)})`);
  const arr = <T>(v: unknown): Partial<T>[] => (Array.isArray(v) ? (v as Partial<T>[]) : []);
  return {
    format: BACKUP_FORMAT,
    version: b.version,
    playId: b.playId,
    playSourceHash: typeof b.playSourceHash === 'string' ? b.playSourceHash : '',
    exportedAt: typeof b.exportedAt === 'string' ? b.exportedAt : '',
    settings: sanitizeSettings(b.settings),
    sessions: arr<SessionRow>(b.sessions).filter(isSession),
    favorites: arr<FavoriteRow>(b.favorites).filter(
      (f): f is FavoriteRow => typeof f?.lineId === 'string' && typeof f.on === 'boolean' && typeof f.updatedAt === 'number',
    ),
    cursors: arr<CursorRow>(b.cursors).filter((c): c is CursorRow => typeof c?.key === 'string' && typeof c.itemId === 'string' && typeof c.updatedAt === 'number'),
  };
}

export interface ImportResult {
  sessions: number;
  favorites: number;
  cursors: number;
  /** Копия версии 1: оценки и заметки в этой версии не используются и не переносятся */
  legacy: boolean;
  /** Настройки из файла новее локальных — их нужно применить */
  settings: Settings | null;
}

export async function importBackup(db: TextLearningDB, backup: Backup, localSettings: Settings): Promise<ImportResult> {
  const result: ImportResult = { sessions: 0, favorites: 0, cursors: 0, legacy: backup.version < 2, settings: null };
  await db.transaction('rw', [db.sessions, db.favorites, db.cursors], async () => {
    for (const s of backup.sessions) {
      const local = await db.sessions.get(s.id);
      if (!local || local.updatedAt < s.updatedAt) {
        await db.sessions.put(s);
        result.sessions++;
      }
    }
    for (const f of backup.favorites) {
      const local = await db.favorites.get(f.lineId);
      if (!local || local.updatedAt < f.updatedAt) {
        await db.favorites.put(f);
        result.favorites++;
      }
    }
    for (const c of backup.cursors) {
      const local = await db.cursors.get(c.key);
      if (!local || local.updatedAt < c.updatedAt) {
        await db.cursors.put(c);
        result.cursors++;
      }
    }
  });
  if (backup.settings.updatedAt > localSettings.updatedAt) result.settings = backup.settings;
  return result;
}

export function backupFileName(now = new Date()): string {
  const d = now.toISOString().slice(0, 10);
  return `text-learning-${d}.json`;
}
