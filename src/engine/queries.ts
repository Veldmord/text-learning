// Запросы к пьесе: роли, сцены, диапазоны, подсказки партнёров, поиск. Чистые функции над PlayIndex.
import { speechText } from './play-format';
import type { Act, Character, Item, ItemId, Line, LineId, Play, Scene } from './types';

export interface SceneRef {
  scene: Scene;
  act: Act;
  /** Порядковый номер сцены в пьесе, с 0 */
  index: number;
  /** Номер сцены в действии, с 1 */
  number: number;
}

export interface PlayIndex {
  play: Play;
  byId: Map<string, Item>;
  pos: Map<string, number>;
  scenes: SceneRef[];
  sceneById: Map<string, SceneRef>;
  sceneOfItem: Map<string, SceneRef>;
  characters: Map<string, Character>;
  lines: Line[];
}

export function buildIndex(play: Play): PlayIndex {
  const byId = new Map<string, Item>();
  const pos = new Map<string, number>();
  play.items.forEach((it, i) => {
    byId.set(it.id, it);
    pos.set(it.id, i);
  });
  const scenes: SceneRef[] = [];
  const sceneById = new Map<string, SceneRef>();
  const sceneOfItem = new Map<string, SceneRef>();
  for (const act of play.acts) {
    act.scenes.forEach((scene, i) => {
      const ref: SceneRef = { scene, act, index: scenes.length, number: i + 1 };
      scenes.push(ref);
      sceneById.set(scene.id, ref);
      for (const id of scene.itemIds) sceneOfItem.set(id, ref);
    });
  }
  return {
    play,
    byId,
    pos,
    scenes,
    sceneById,
    sceneOfItem,
    characters: new Map(play.characters.map((c) => [c.id, c])),
    lines: play.items.filter((it): it is Line => it.kind === 'line'),
  };
}

export const getLine = (index: PlayIndex, id: string): Line | undefined => {
  const it = index.byId.get(id);
  return it?.kind === 'line' ? it : undefined;
};

// ---------------------------------------------------------------------------
// Роли

export interface RoleStats {
  lines: number;
  words: number;
}

/** Реплики без продолжений и слова с продолжениями — так же, как в таблице раздела 2. */
export function characterStats(index: PlayIndex): Map<string, RoleStats> {
  const out = new Map<string, RoleStats>();
  for (const l of index.lines) {
    const s = out.get(l.speakerId) ?? { lines: 0, words: 0 };
    if (!l.continuation) s.lines++;
    s.words += l.words;
    out.set(l.speakerId, s);
  }
  return out;
}

export function parseRoles(param: string | undefined, index: PlayIndex): string[] {
  if (!param) return [];
  const ids = param
    .split(',')
    .map((s) => s.trim())
    .filter((id) => index.characters.get(id)?.speaking);
  return [...new Set(ids)];
}

export const rolesKey = (roles: string[]) => [...roles].sort().join(',');

export function roleNames(index: PlayIndex, roles: string[]): string {
  const chars = roles.map((r) => index.characters.get(r)).filter((c): c is Character => !!c);
  const groups = new Map<string, Character[]>();
  for (const c of chars) if (c.group) groups.set(c.group, [...(groups.get(c.group) ?? []), c]);
  const names: string[] = [];
  const usedGroups = new Set<string>();
  for (const c of chars) {
    const groupMembers = c.group ? index.play.characters.filter((x) => x.group === c.group && x.speaking) : [];
    if (c.group && groupMembers.length > 1 && groupMembers.every((m) => roles.includes(m.id))) {
      if (!usedGroups.has(c.group)) names.push(c.group);
      usedGroups.add(c.group);
    } else {
      names.push(c.name);
    }
  }
  return names.join(' + ');
}

export const isMine = (item: Item | undefined, roles: ReadonlySet<string> | string[]): item is Line => {
  if (item?.kind !== 'line') return false;
  return Array.isArray(roles) ? roles.includes(item.speakerId) : roles.has(item.speakerId);
};

export function roleStats(index: PlayIndex, roles: string[]): RoleStats {
  const set = new Set(roles);
  return index.lines.reduce(
    (acc, l) => (set.has(l.speakerId) ? { lines: acc.lines + (l.continuation ? 0 : 1), words: acc.words + l.words } : acc),
    { lines: 0, words: 0 },
  );
}

export function scenesWithRoles(index: PlayIndex, roles: string[]): SceneRef[] {
  return index.scenes.filter((s) => s.scene.characterIds.some((c) => roles.includes(c)));
}

export function myLinesInScene(index: PlayIndex, sceneId: string, roles: string[]): Line[] {
  const ref = index.sceneById.get(sceneId);
  if (!ref) return [];
  return ref.scene.itemIds.map((id) => index.byId.get(id)).filter((it): it is Line => isMine(it, roles));
}

// ---------------------------------------------------------------------------
// Диапазон тренировки (FR-03): вся роль / действие / сцены / от реплики до реплики / только слабые

export type ScopePart =
  | { kind: 'act'; n: number }
  | { kind: 'scene'; id: string }
  | { kind: 'range'; from: LineId; to: LineId };

export interface Scope {
  parts: ScopePart[];
  weak: boolean;
}

export const ALL_SCOPE: Scope = { parts: [], weak: false };

export function parseScope(value: string | null | undefined): Scope {
  const scope: Scope = { parts: [], weak: false };
  for (const token of (value ?? '').split(',').map((t) => t.trim()).filter(Boolean)) {
    if (token === 'all') continue;
    if (token === 'weak') scope.weak = true;
    else if (/^a\d+$/.test(token)) scope.parts.push({ kind: 'act', n: Number(token.slice(1)) });
    else if (/^a\d+s\d+$/.test(token)) scope.parts.push({ kind: 'scene', id: token });
    else {
      const m = /^(L\d+)-(L\d+)$/.exec(token);
      if (m) scope.parts.push({ kind: 'range', from: m[1] as LineId, to: m[2] as LineId });
    }
  }
  return scope;
}

export function formatScope(scope: Scope): string {
  const parts = scope.parts.map((p) => (p.kind === 'act' ? `a${p.n}` : p.kind === 'scene' ? p.id : `${p.from}-${p.to}`));
  if (scope.weak) parts.push('weak');
  return parts.length ? parts.join(',') : 'all';
}

export function scopeLabel(index: PlayIndex, scope: Scope): string {
  const labels = scope.parts.map((p) => {
    if (p.kind === 'act') return `Действие ${p.n}`;
    if (p.kind === 'scene') {
      const ref = index.sceneById.get(p.id);
      return ref ? `Д.${ref.act.n} · ${ref.number}. ${ref.scene.title}` : p.id;
    }
    return `Реплики ${p.from}–${p.to}`;
  });
  const base = labels.length ? labels.join(', ') : 'Вся роль';
  return scope.weak ? `${base} · только слабые` : base;
}

/** Множество элементов пьесы в диапазоне (без фильтра «слабые» — он применяется к карточкам). */
export function scopeItemIds(index: PlayIndex, scope: Scope): Set<string> {
  if (!scope.parts.length) return new Set(index.play.items.map((it) => it.id));
  const out = new Set<string>();
  for (const p of scope.parts) {
    if (p.kind === 'act') {
      const act = index.play.acts.find((a) => a.n === p.n);
      act?.scenes.forEach((s) => s.itemIds.forEach((id) => out.add(id)));
    } else if (p.kind === 'scene') {
      index.sceneById.get(p.id)?.scene.itemIds.forEach((id) => out.add(id));
    } else {
      const a = index.pos.get(p.from);
      const b = index.pos.get(p.to);
      if (a === undefined || b === undefined) continue;
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.add(index.play.items[i]!.id);
    }
  }
  return out;
}

export function myLinesInScope(index: PlayIndex, roles: string[], scope: Scope): Line[] {
  const ids = scopeItemIds(index, scope);
  const set = new Set(roles);
  return index.lines.filter((l) => set.has(l.speakerId) && ids.has(l.id));
}

// ---------------------------------------------------------------------------
// Подсказка и контекст

export interface CueInfo {
  /** Элементы перед моей репликой, которые показываются на экране (последняя реплика партнёра и ремарки после неё) */
  before: Item[];
  /** Реплика-подсказка партнёра; null, если перед моей репликой — моя же реплика или начало действия */
  cue: Line | null;
}

/**
 * Собирает контекст перед моей репликой: идём назад до `lines` реплик (не меньше одной), не выходя за действие.
 * Подсказка — ближайшая чужая реплика, если между ней и моей репликой нет моих реплик.
 */
export function cueFor(index: PlayIndex, lineId: string, roles: string[], lines = 1): CueInfo {
  const p = index.pos.get(lineId);
  if (p === undefined) return { before: [], cue: null };
  const act = index.sceneOfItem.get(lineId)?.act;
  const actIds = new Set(act?.scenes.flatMap((s) => s.itemIds) ?? []);
  const before: Item[] = [];
  let cue: Line | null = null;
  let seenLines = 0;
  let firstLineSeen = false;
  for (let i = p - 1; i >= 0; i--) {
    const it = index.play.items[i]!;
    if (!actIds.has(it.id)) break;
    before.unshift(it);
    if (it.kind === 'line') {
      if (!firstLineSeen) {
        firstLineSeen = true;
        if (!roles.includes(it.speakerId)) cue = it;
      }
      seenLines++;
      if (seenLines >= Math.max(lines, 1)) break;
    }
  }
  return { before, cue };
}

/** Следующий элемент после реплики (для показа ремарки после неё в читке). */
export const itemAt = (index: PlayIndex, id: ItemId, offset: number): Item | undefined => {
  const p = index.pos.get(id);
  return p === undefined ? undefined : index.play.items[p + offset];
};

// ---------------------------------------------------------------------------
// Поиск по тексту (FR-16)

export const normalizeForSearch = (s: string) => s.toLowerCase().replace(/ё/g, 'е');

export interface SearchHit {
  item: Item;
  before: string;
  match: string;
  after: string;
}

export function itemText(item: Item): string {
  return item.kind === 'line'
    ? item.segments.map((s) => (s.kind === 'aside' ? `(${s.text})` : s.text)).join(' ')
    : item.text;
}

export function searchPlay(index: PlayIndex, query: string, limit = 50): SearchHit[] {
  const q = normalizeForSearch(query.trim());
  if (q.length < 2) return [];
  const hits: SearchHit[] = [];
  for (const item of index.play.items) {
    const text = itemText(item);
    const at = normalizeForSearch(text).indexOf(q);
    if (at < 0) continue;
    const start = Math.max(0, at - 40);
    const end = Math.min(text.length, at + q.length + 60);
    hits.push({
      item,
      before: (start > 0 ? '…' : '') + text.slice(start, at),
      match: text.slice(at, at + q.length),
      after: text.slice(at + q.length, end) + (end < text.length ? '…' : ''),
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

export const speakerName = (index: PlayIndex, item: Item) =>
  item.kind === 'line' ? (index.characters.get(item.speakerId)?.name ?? item.speakerId) : '';

export const lineSpeech = (line: Line) => speechText(line);
