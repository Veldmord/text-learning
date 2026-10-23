// Сверка прогресса с новой сборкой пьесы (раздел 11.4): если у реплики изменился textHash,
// сбрасываются только её карточка и уровень. Журнал сохраняется, заметка помечается «текст изменился».
import { newCard } from '../engine/model';
import type { Line, Play } from '../engine/types';
import type { TextLearningDB } from './db';

export interface ReconcileResult {
  resetCards: number;
  staleNotes: number;
  changed: boolean;
}

/** force — проверить карточки, даже если сборка не менялась (после импорта бэкапа со старой версии текста). */
export async function reconcileWithPlay(
  db: TextLearningDB,
  play: Play,
  { now = Date.now(), force = false }: { now?: number; force?: boolean } = {},
): Promise<ReconcileResult> {
  const stored = (await db.meta.get('playSourceHash'))?.value;
  if (!force && stored === play.sourceHash) return { resetCards: 0, staleNotes: 0, changed: false };

  const lines = new Map(play.items.filter((it): it is Line => it.kind === 'line').map((l) => [l.id, l]));
  let resetCards = 0;
  let staleNotes = 0;
  await db.transaction('rw', db.cards, db.notes, db.meta, async () => {
    for (const card of await db.cards.toArray()) {
      const line = lines.get(card.lineId);
      if (!line) {
        await db.cards.delete(card.lineId);
        resetCards++;
      } else if (line.textHash !== card.textHash) {
        await db.cards.put(newCard(line, now));
        resetCards++;
        const note = await db.notes.get(card.lineId);
        if (note && !note.stale) {
          await db.notes.put({ ...note, stale: true });
          staleNotes++;
        }
      }
    }
    await db.meta.put({ key: 'playSourceHash', value: play.sourceHash });
  });
  return { resetCards, staleNotes, changed: true };
}
