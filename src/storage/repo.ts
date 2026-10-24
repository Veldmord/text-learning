// Операции над данными пользователя. Реализует StorePort для SessionRunner.
import type { CursorRow, ErrorRow, SessionRow } from '../engine/model';
import type { StorePort } from '../engine/session-runner';
import type { LineId } from '../engine/types';
import type { TextLearningDB } from './db';

export const ERROR_LOG_LIMIT = 200;

export class Repo implements StorePort {
  constructor(private readonly db: TextLearningDB) {}

  async saveSession(row: SessionRow): Promise<void> {
    await this.db.sessions.put(row);
  }

  /** Сессии по порядку начала; с rolesKey — только этой связки ролей. */
  async sessions(rolesKey?: string): Promise<SessionRow[]> {
    const rows = rolesKey === undefined ? await this.db.sessions.toArray() : await this.db.sessions.where('rolesKey').equals(rolesKey).toArray();
    return rows.sort((a, b) => a.startedAt - b.startedAt);
  }

  countSessionsSince(ts: number): Promise<number> {
    return this.db.sessions.where('updatedAt').above(ts).count();
  }

  async favorites(): Promise<Set<string>> {
    return new Set((await this.db.favorites.toArray()).filter((f) => f.on).map((f) => f.lineId));
  }

  async setFavorite(lineId: LineId, on: boolean): Promise<void> {
    await this.db.favorites.put({ lineId, on, updatedAt: Date.now() });
  }

  async saveCursor(key: string, itemId: string | null): Promise<void> {
    if (itemId === null) await this.db.cursors.delete(key);
    else await this.db.cursors.put({ key, itemId, updatedAt: Date.now() });
  }

  getCursor(key: string): Promise<CursorRow | undefined> {
    return this.db.cursors.get(key);
  }

  allCursors(): Promise<CursorRow[]> {
    return this.db.cursors.toArray();
  }

  async getMeta<T>(key: string): Promise<T | undefined> {
    return (await this.db.meta.get(key))?.value as T | undefined;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    await this.db.meta.put({ key, value });
  }

  /** Кольцевой журнал ошибок: хранятся последние ERROR_LOG_LIMIT событий. */
  async logError(e: Omit<ErrorRow, 'id'>): Promise<void> {
    await this.db.transaction('rw', this.db.errors, async () => {
      await this.db.errors.add(e);
      const count = await this.db.errors.count();
      if (count > ERROR_LOG_LIMIT) {
        const old = await this.db.errors.orderBy('id').limit(count - ERROR_LOG_LIMIT).primaryKeys();
        await this.db.errors.bulkDelete(old);
      }
    });
  }

  recentErrors(limit = 20): Promise<ErrorRow[]> {
    return this.db.errors.orderBy('id').reverse().limit(limit).toArray();
  }

  /** Сбросить журнал сессий, позиции и данные прежних версий. Избранное остаётся. */
  async resetProgress(): Promise<void> {
    const { sessions, cursors, cards, reviews, sceneReads } = this.db;
    await this.db.transaction('rw', [sessions, cursors, cards, reviews, sceneReads], async () => {
      await Promise.all([sessions.clear(), cursors.clear(), cards.clear(), reviews.clear(), sceneReads.clear()]);
    });
  }
}
