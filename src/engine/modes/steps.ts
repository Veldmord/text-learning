// Шаги сессии для каждого режима: какие реплики, части монологов и головоломки проходит актёр.
import { speechText } from '../play-format';
import { myLinesInScope, scenesWithRoles, type PlayIndex, type Scope } from '../queries';
import { isWeak, retrievability } from '../srs';
import { chunkSentences, seededShuffle } from '../text-transforms';
import type { Line, LineId } from '../types';
import type { CardRow } from '../model';
import { LONG_LINE_WORDS, type ModeId } from './index';

export interface OrderPiece {
  id: string;
  text: string;
}

export type Step =
  | { kind: 'line'; lineId: LineId }
  | {
      kind: 'chunk';
      lineId: LineId;
      /** Номер шага наращивания, с 1 */
      part: number;
      parts: number;
      /** Индексы предложений, которые нужно воспроизвести на этом шаге (1 + 2 + … + part) */
      sentenceIdx: number[];
    }
  | {
      kind: 'order';
      id: string;
      title: string;
      /** Реплика-якорь для курсора и журнала */
      lineId: LineId;
      /** Правильный порядок */
      pieces: OrderPiece[];
      /** Порядок показа (детерминированно перемешан) */
      shuffled: OrderPiece[];
    };

export interface BuildStepsInput {
  index: PlayIndex;
  mode: ModeId;
  roles: string[];
  scope: Scope;
  cards: Map<string, CardRow>;
  now: number;
}

const MAX_ORDER_PIECES = 6;

function chunkSteps(line: Line): Step[] {
  const groups = chunkSentences(line.sentences.map((s) => s.text));
  if (groups.length < 2) return [{ kind: 'line', lineId: line.id }];
  const steps: Step[] = [];
  let acc: number[] = [];
  groups.forEach((g, i) => {
    acc = [...acc, ...g];
    steps.push({ kind: 'chunk', lineId: line.id, part: i + 1, parts: groups.length, sentenceIdx: acc });
  });
  return steps;
}

function orderSteps(index: PlayIndex, lines: Line[], roles: string[]): Step[] {
  const inScope = new Set(lines.map((l) => l.id));
  const steps: Step[] = [];
  for (const ref of scenesWithRoles(index, roles)) {
    const mine = ref.scene.itemIds
      .filter((id) => inScope.has(id as LineId))
      .map((id) => index.byId.get(id))
      .filter((it): it is Line => it?.kind === 'line');
    if (!mine.length) continue;
    for (let k = 0; k * MAX_ORDER_PIECES < mine.length; k++) {
      const group = mine.slice(k * MAX_ORDER_PIECES, (k + 1) * MAX_ORDER_PIECES);
      if (group.length < 2) continue;
      const pieces = group.map((l) => ({ id: l.id, text: speechText(l) }));
      const id = `${ref.scene.id}:${k + 1}`;
      steps.push({
        kind: 'order',
        id,
        title: `${ref.scene.title}: мои реплики${mine.length > MAX_ORDER_PIECES ? `, часть ${k + 1}` : ''}`,
        lineId: group[0]!.id,
        pieces,
        shuffled: seededShuffle(pieces, id),
      });
    }
    for (const l of mine.filter((m) => m.words > LONG_LINE_WORDS && m.sentences.length >= 3)) {
      const pieces = l.sentences.map((s) => ({ id: s.id, text: s.text }));
      for (let k = 0; k * MAX_ORDER_PIECES * 2 < pieces.length; k++) {
        const group = pieces.slice(k * MAX_ORDER_PIECES * 2, (k + 1) * MAX_ORDER_PIECES * 2);
        if (group.length < 2) continue;
        const id = `${l.id}:${k + 1}`;
        steps.push({
          kind: 'order',
          id,
          title: `Монолог ${l.id}: порядок предложений${pieces.length > MAX_ORDER_PIECES * 2 ? `, часть ${k + 1}` : ''}`,
          lineId: l.id,
          pieces: group,
          shuffled: seededShuffle(group, id),
        });
      }
    }
  }
  return steps;
}

export function buildSteps({ index, mode, roles, scope, cards, now }: BuildStepsInput): Step[] {
  let lines = myLinesInScope(index, roles, scope);
  if (scope.weak || mode === 'weak') lines = lines.filter((l) => isWeak(cards.get(l.id), now));

  switch (mode) {
    case 'weak': {
      const pos = (l: Line) => index.pos.get(l.id) ?? 0;
      const r = (l: Line) => retrievability(cards.get(l.id), now);
      return [...lines].sort((a, b) => r(a) - r(b) || pos(a) - pos(b)).map((l) => ({ kind: 'line', lineId: l.id }));
    }
    case 'chunks':
      return lines.filter((l) => l.words > LONG_LINE_WORDS).flatMap(chunkSteps);
    case 'order':
      return orderSteps(index, lines, roles);
    case 'read':
      return [];
    default:
      return lines.map((l) => ({ kind: 'line', lineId: l.id }));
  }
}

export const stepLineId = (step: Step | undefined): LineId | undefined => step?.lineId;

/** Позиция для продолжения: первый шаг с этой репликой (или первый после неё по тексту). */
export function findStepIndex(steps: Step[], index: PlayIndex, lineId: string | undefined): number {
  if (!lineId) return 0;
  const exact = steps.findIndex((s) => s.lineId === lineId);
  if (exact >= 0) return exact;
  const target = index.pos.get(lineId);
  if (target === undefined) return 0;
  const after = steps.findIndex((s) => (index.pos.get(s.lineId) ?? 0) >= target);
  return after >= 0 ? after : 0;
}
