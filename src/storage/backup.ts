// Резервная копия прогресса (раздел 11.3). Импорт сливает данные по updatedAt — побеждает последнее изменение,
// поэтому одним файлом можно переносить прогресс между устройствами в обе стороны.
import type { CardRow, CursorRow, NoteRow, ReviewRow, SceneReadRow } from '../engine/model';
import type { TextLearningDB } from './db';
import { sanitizeSettings, type Settings } from './settings';

export const BACKUP_FORMAT = 'text-learning-backup';
export const BACKUP_VERSION = 1;

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  playId: string;
  playSourceHash: string;
  exportedAt: string;
  settings: Settings;
  cards: CardRow[];
  reviews: ReviewRow[];
  notes: NoteRow[];
  cursors: CursorRow[];
  sceneReads: SceneReadRow[];
}

export async function exportBackup(db: TextLearningDB, meta: { playId: string; playSourceHash: string; settings: Settings }): Promise<Backup> {
  const [cards, reviews, notes, cursors, sceneReads] = await Promise.all([
    db.cards.toArray(),
    db.reviews.toArray(),
    db.notes.toArray(),
    db.cursors.toArray(),
    db.sceneReads.toArray(),
  ]);
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    playId: meta.playId,
    playSourceHash: meta.playSourceHash,
    exportedAt: new Date().toISOString(),
    settings: meta.settings,
    cards,
    reviews: reviews.map(({ id: _id, ...r }) => r),
    notes,
    cursors,
    sceneReads,
  };
}

export class BackupError extends Error {}

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
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  return {
    format: BACKUP_FORMAT,
    version: b.version,
    playId: b.playId,
    playSourceHash: typeof b.playSourceHash === 'string' ? b.playSourceHash : '',
    exportedAt: typeof b.exportedAt === 'string' ? b.exportedAt : '',
    settings: sanitizeSettings(b.settings),
    cards: arr<CardRow>(b.cards).filter((c) => typeof c?.lineId === 'string' && typeof c.updatedAt === 'number'),
    reviews: arr<ReviewRow>(b.reviews).filter((r) => typeof r?.lineId === 'string' && typeof r.ts === 'number'),
    notes: arr<NoteRow>(b.notes).filter((n) => typeof n?.lineId === 'string' && typeof n.updatedAt === 'number'),
    cursors: arr<CursorRow>(b.cursors).filter((c) => typeof c?.key === 'string' && typeof c.updatedAt === 'number'),
    sceneReads: arr<SceneReadRow>(b.sceneReads).filter((s) => typeof s?.sceneId === 'string'),
  };
}

export interface ImportResult {
  cards: number;
  reviews: number;
  notes: number;
  cursors: number;
  sceneReads: number;
  /** Настройки из файла новее локальных — их нужно применить */
  settings: Settings | null;
}

const reviewKey = (r: Pick<ReviewRow, 'lineId' | 'ts' | 'mode' | 'rating'>) => `${r.lineId}|${r.ts}|${r.mode}|${r.rating}`;

export async function importBackup(db: TextLearningDB, backup: Backup, localSettings: Settings): Promise<ImportResult> {
  const result: ImportResult = { cards: 0, reviews: 0, notes: 0, cursors: 0, sceneReads: 0, settings: null };
  await db.transaction('rw', [db.cards, db.reviews, db.notes, db.cursors, db.sceneReads], async () => {
    for (const c of backup.cards) {
      const local = await db.cards.get(c.lineId);
      if (!local || local.updatedAt < c.updatedAt) {
        await db.cards.put(c);
        result.cards++;
      }
    }
    const existing = new Set((await db.reviews.toArray()).map(reviewKey));
    const fresh = backup.reviews.filter((r) => !existing.has(reviewKey(r))).map(({ id: _id, ...r }) => r);
    if (fresh.length) await db.reviews.bulkAdd(fresh);
    result.reviews = fresh.length;
    for (const n of backup.notes) {
      const local = await db.notes.get(n.lineId);
      if (!local || local.updatedAt < n.updatedAt) {
        await db.notes.put(n);
        result.notes++;
      }
    }
    for (const c of backup.cursors) {
      const local = await db.cursors.get(c.key);
      if (!local || local.updatedAt < c.updatedAt) {
        await db.cursors.put(c);
        result.cursors++;
      }
    }
    for (const s of backup.sceneReads) {
      const local = await db.sceneReads.get(s.sceneId);
      if (!local || local.updatedAt < s.updatedAt) {
        await db.sceneReads.put(s);
        result.sceneReads++;
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
