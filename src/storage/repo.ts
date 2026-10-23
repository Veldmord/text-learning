// Операции над данными пользователя. Реализует StorePort для SessionRunner.
import type { CardRow, CursorRow, ErrorRow, NoteRow, ReviewRow } from '../engine/model';
import type { StorePort } from '../engine/session-runner';
import type { LineId } from '../engine/types';
import type { TextLearningDB } from './db';

export const ERROR_LOG_LIMIT = 200;

export class Repo implements StorePort {
  constructor(private readonly db: TextLearningDB) {}

  getCard(lineId: LineId): Promise<CardRow | undefined> {
    return this.db.cards.get(lineId);
  }

  async getCards(): Promise<Map<string, CardRow>> {
    const rows = await this.db.cards.toArray();
    return new Map(rows.map((c) => [c.lineId, c]));
  }

  commitReview(review: ReviewRow, card: CardRow): Promise<number> {
    return this.db.transaction('rw', this.db.cards, this.db.reviews, async () => {
      await this.db.cards.put(card);
      const { id: _id, ...row } = review;
      return (await this.db.reviews.add(row)) as number;
    });
  }

  undoReview(reviewId: number): Promise<void> {
    return this.db.transaction('rw', this.db.cards, this.db.reviews, async () => {
      const review = await this.db.reviews.get(reviewId);
      if (!review) return;
      if (review.prevCard) await this.db.cards.put(review.prevCard);
      else await this.db.cards.delete(review.lineId);
      await this.db.reviews.delete(reviewId);
    });
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

  allReviews(): Promise<ReviewRow[]> {
    return this.db.reviews.orderBy('ts').toArray();
  }

  async countReviewsSince(ts: number): Promise<number> {
    return this.db.reviews.where('ts').above(ts).count();
  }

  getNote(lineId: LineId): Promise<NoteRow | undefined> {
    return this.db.notes.get(lineId);
  }

  async allNotes(): Promise<Map<string, NoteRow>> {
    const rows = await this.db.notes.toArray();
    return new Map(rows.map((n) => [n.lineId, n]));
  }

  async saveNote(lineId: LineId, text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) await this.db.notes.delete(lineId);
    else await this.db.notes.put({ lineId, text: trimmed, updatedAt: Date.now() });
  }

  async markSceneRead(sceneId: string): Promise<void> {
    const now = Date.now();
    await this.db.sceneReads.put({ sceneId, readAt: now, updatedAt: now });
  }

  async readScenes(): Promise<Set<string>> {
    return new Set((await this.db.sceneReads.toArray()).map((r) => r.sceneId));
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

  async resetProgress(): Promise<void> {
    await this.db.transaction('rw', [this.db.cards, this.db.reviews, this.db.cursors, this.db.sceneReads], async () => {
      await Promise.all([this.db.cards.clear(), this.db.reviews.clear(), this.db.cursors.clear(), this.db.sceneReads.clear()]);
    });
  }
}
