// Сверка данных с новой сборкой пьесы (раздел 11.4): избранное и позиции на реплики, которых больше нет, удаляются.
// Изменённый текст реплики ничего не сбрасывает: прогресс считается по сценам, а не по отдельным репликам.
import type { Play } from '../engine/types';
import type { TextLearningDB } from './db';

export interface ReconcileResult {
  removedFavorites: number;
  removedCursors: number;
  changed: boolean;
}

/** force — проверить, даже если сборка не менялась (после импорта бэкапа со старой версии текста). */
export async function reconcileWithPlay(
  db: TextLearningDB,
  play: Play,
  { force = false }: { force?: boolean } = {},
): Promise<ReconcileResult> {
  const stored = (await db.meta.get('playSourceHash'))?.value;
  if (!force && stored === play.sourceHash) return { removedFavorites: 0, removedCursors: 0, changed: false };

  const items = new Set<string>(play.items.map((it) => it.id));
  let removedFavorites = 0;
  let removedCursors = 0;
  await db.transaction('rw', db.favorites, db.cursors, db.meta, async () => {
    for (const f of await db.favorites.toArray()) {
      if (items.has(f.lineId)) continue;
      await db.favorites.delete(f.lineId);
      removedFavorites++;
    }
    for (const c of await db.cursors.toArray()) {
      if (items.has(c.itemId)) continue;
      await db.cursors.delete(c.key);
      removedCursors++;
    }
    await db.meta.put({ key: 'playSourceHash', value: play.sourceHash });
  });
  return { removedFavorites, removedCursors, changed: true };
}
