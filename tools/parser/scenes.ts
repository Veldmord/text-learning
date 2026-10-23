// Карта сцен: content/scenes.yaml → Act[].scenes. Сцена — диапазон от `from` до начала следующей сцены.
import type { Act, Item, ItemId, Scene } from '../../src/engine/types';
import type { ParsedAct } from './parse';

export interface SceneConfig {
  id: string;
  title: string;
  from: string;
}

export function buildActs(parsedActs: ParsedAct[], items: Item[], config: SceneConfig[]): { acts: Act[]; errors: string[] } {
  const errors: string[] = [];
  const byId = new Map(items.map((it) => [it.id, it]));
  const position = new Map(items.map((it, i) => [it.id, i]));
  const actOf = new Map<string, ParsedAct>();
  for (const act of parsedActs) for (const id of act.itemIds) actOf.set(id, act);

  const seen = new Set<string>();
  for (const s of config) {
    if (seen.has(s.id)) errors.push(`Сцена ${s.id}: повторяющийся id`);
    seen.add(s.id);
    if (!byId.has(s.from as ItemId)) errors.push(`Сцена ${s.id}: начало ${s.from} не найдено`);
  }
  const valid = config.filter((s) => byId.has(s.from as ItemId));
  for (let i = 1; i < valid.length; i++) {
    if (position.get(valid[i]!.from as ItemId)! <= position.get(valid[i - 1]!.from as ItemId)!) {
      errors.push(`Сцена ${valid[i]!.id}: начинается не после ${valid[i - 1]!.id} — сцены пересекаются или идут не по порядку`);
    }
  }

  const acts: Act[] = parsedActs.map((pa) => {
    const scenesCfg = valid.filter((s) => actOf.get(s.from) === pa);
    if (!scenesCfg.length) {
      errors.push(`${pa.title}: нет ни одной сцены`);
      return { n: pa.n, title: pa.title, scenes: [] };
    }
    if (scenesCfg[0]!.from !== pa.itemIds[0]) {
      errors.push(`${pa.title}: первая сцена ${scenesCfg[0]!.id} должна начинаться с ${pa.itemIds[0]}, иначе начало действия не покрыто`);
    }
    const scenes: Scene[] = scenesCfg.map((cfg, i) => {
      const startIdx = pa.itemIds.indexOf(cfg.from);
      const next = scenesCfg[i + 1];
      const endIdx = next ? pa.itemIds.indexOf(next.from) : pa.itemIds.length;
      const itemIds = pa.itemIds.slice(Math.max(startIdx, 0), endIdx) as ItemId[];
      const characterIds = [
        ...new Set(itemIds.map((id) => byId.get(id)).flatMap((it) => (it?.kind === 'line' ? [it.speakerId] : []))),
      ];
      return { id: cfg.id, title: cfg.title, itemIds, characterIds };
    });
    const covered = scenes.reduce((n, s) => n + s.itemIds.length, 0);
    if (covered !== pa.itemIds.length) errors.push(`${pa.title}: сцены покрывают ${covered} из ${pa.itemIds.length} элементов`);
    return { n: pa.n, title: pa.title, scenes };
  });
  return { acts, errors };
}
