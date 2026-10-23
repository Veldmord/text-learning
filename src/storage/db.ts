// IndexedDB через Dexie: прогресс, журнал, заметки, курсоры. Только данные, без бизнес-правил (раздел 8.2).
import Dexie, { type EntityTable } from 'dexie';
import type { CardRow, CursorRow, ErrorRow, MetaRow, NoteRow, ReviewRow, SceneReadRow } from '../engine/model';
import { applyMigrations } from './migrations';

export const DB_NAME = 'text-learning';

export class TextLearningDB extends Dexie {
  cards!: EntityTable<CardRow, 'lineId'>;
  reviews!: EntityTable<ReviewRow, 'id'>;
  notes!: EntityTable<NoteRow, 'lineId'>;
  cursors!: EntityTable<CursorRow, 'key'>;
  sceneReads!: EntityTable<SceneReadRow, 'sceneId'>;
  meta!: EntityTable<MetaRow, 'key'>;
  errors!: EntityTable<ErrorRow, 'id'>;

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
