// Версии схемы IndexedDB. Новая версия добавляется в конец массива и покрывается тестом
// (tests/unit/storage/migrations.test.ts). Существующие версии не меняются никогда.
import type { Dexie, Transaction } from 'dexie';

export interface Migration {
  version: number;
  stores: Record<string, string | null>;
  upgrade?: (tx: Transaction) => Promise<void> | void;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    stores: {
      cards: 'lineId, due, updatedAt',
      reviews: '++id, lineId, ts',
      notes: 'lineId, updatedAt',
      cursors: 'key, updatedAt',
      sceneReads: 'sceneId',
      meta: 'key',
      errors: '++id, ts',
    },
  },
  {
    // Журнал сессий и избранное. Таблицы оценок (cards, reviews), заметок и прочитанных сцен не читаются с этой версии,
    // но не удаляются: в них данные пользователя.
    version: 2,
    stores: {
      sessions: 'id, rolesKey, updatedAt',
      favorites: 'lineId, updatedAt',
    },
  },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

export function applyMigrations(db: Dexie, upTo = SCHEMA_VERSION): void {
  for (const m of MIGRATIONS.filter((x) => x.version <= upTo)) {
    const v = db.version(m.version).stores(m.stores);
    if (m.upgrade) v.upgrade(m.upgrade);
  }
}
