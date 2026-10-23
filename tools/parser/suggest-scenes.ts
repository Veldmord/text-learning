// npm run scenes:suggest [-- --min 25]
// Предлагает границы сцен по ремаркам с входами и выходами персонажей (раздел 9.2).
// Результат — черновик content/scenes.yaml: названия и границы правит режиссёр.
import type { Direction, Item } from '../../src/engine/types';
import { buildPlay } from './build';

const ENTRANCE_EXIT =
  /(Входит|входит|Входят|входят|Вбегает|вбегает|Появляется|появляется|Появляются|появляются|Возвращается|возвращается|уходит|Уходит|уходят|убегает|исчезает|скрывается|выходит|Выходит)/;

export interface SceneSuggestion {
  from: string;
  src: number;
  reason: string;
}

export function suggestScenes(items: Item[], actItemIds: string[][], minItems = 25): SceneSuggestion[] {
  const byId = new Map(items.map((it) => [it.id, it]));
  const out: SceneSuggestion[] = [];
  for (const ids of actItemIds) {
    const first = byId.get(ids[0] as Item['id']);
    if (first) out.push({ from: first.id, src: first.src, reason: 'начало действия' });
    let lastIdx = 0;
    ids.forEach((id, idx) => {
      const it = byId.get(id as Item['id']);
      if (it?.kind !== 'direction' || idx - lastIdx < minItems) return;
      const dir = it as Direction;
      const m = ENTRANCE_EXIT.exec(dir.text);
      if (!m) return;
      // Граница сцены — ремарка с выходом/входом; если перед ней тоже ремарка, начинаем с неё.
      let startIdx = idx;
      while (startIdx > lastIdx + 1 && byId.get(ids[startIdx - 1] as Item['id'])?.kind === 'direction') startIdx--;
      if (ids.length - startIdx < minItems / 2) return;
      const start = byId.get(ids[startIdx] as Item['id'])!;
      out.push({ from: start.id, src: start.src, reason: `${m[1]}: ${dir.text.slice(0, 70)}…` });
      lastIdx = startIdx;
    });
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('suggest-scenes.ts')) {
  const minArg = process.argv.indexOf('--min');
  const min = minArg > 0 ? Number(process.argv[minArg + 1]) : 25;
  const { play, parsed } = buildPlay();
  const suggestions = suggestScenes(
    play.items,
    parsed.acts.map((a) => a.itemIds),
    min,
  );
  console.log('# Черновик content/scenes.yaml — проверьте границы и дайте сценам названия');
  let act = 0;
  let n = 0;
  for (const s of suggestions) {
    if (s.reason === 'начало действия') {
      act++;
      n = 0;
    }
    n++;
    console.log(`- id: a${act}s${String(n).padStart(2, '0')}`);
    console.log(`  title: Сцена ${n}`);
    console.log(`  from: ${s.from}  # стр. ${s.src}; ${s.reason}`);
  }
  console.error(`Предложено сцен: ${suggestions.length}`);
}
