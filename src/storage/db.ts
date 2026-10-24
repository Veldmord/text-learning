// IndexedDB через Dexie: журнал сессий, избранное, курсоры. Только данные, без бизнес-правил (раздел 8.2).
import Dexie, { type EntityTable, type Table } from 'dexie';
import type { CursorRow, ErrorRow, FavoriteRow, MetaRow, SessionRow } from '../engine/model';
import { applyMigrations } from './migrations';

export const DB_NAME = 'text-learning';

/** Запись таблиц версии 1, которые больше не читаются (оценки, заметки, прочитанные сцены). */
export type LegacyRow = Record<string, unknown>;

export class TextLearningDB extends Dexie {
  sessions!: EntityTable<SessionRow, 'id'>;
  favorites!: EntityTable<FavoriteRow, 'lineId'>;
  cursors!: EntityTable<CursorRow, 'key'>;
  meta!: EntityTable<MetaRow, 'key'>;
  errors!: EntityTable<ErrorRow, 'id'>;
  cards!: Table<LegacyRow, string>;
  reviews!: Table<LegacyRow, number>;
  notes!: Table<LegacyRow, string>;
  sceneReads!: Table<LegacyRow, string>;

  constructor(name = DB_NAME, upTo?: number) {
    super(name);
    applyMigrations(this, upTo);
  }
}

let instance: TextLearningDB | null = null;

export function getDb(): TextLearningDB {
  instance ??= new TextLearningDB();
  return instance;
}

/** Для тестов: подменить экземпляр */
export function setDb(db: TextLearningDB | null): void {
  instance = db;
}
