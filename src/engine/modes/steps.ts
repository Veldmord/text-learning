// Шаги сессии: какие реплики проходит актёр. Свои реплики ждут актёра, реплики партнёров звучат и ведут сцену дальше.
import { myLinesInScope, scopeItemIds, type PlayIndex, type Scope } from '../queries';
import type { LineId } from '../types';
import type { ModeId, RunFlow } from './index';

export interface Step {
  itemId: LineId;
  /** Своя реплика: прогон останавливается на ней. Реплика партнёра звучит и сама ведёт дальше. */
  mine: boolean;
}

export interface BuildStepsInput {
  index: PlayIndex;
  mode: ModeId;
  roles: string[];
  scope: Scope;
  runFlow: RunFlow;
  skipScenesWithoutRole: boolean;
}

/**
 * «Прогон: все реплики по очереди» — каждая реплика диапазона по порядку текста (ремарки видны в ленте и звучат
 * в начале следующего шага). Остальные режимы и «сразу к моим репликам» — только свои реплики.
 */
export function buildSteps({ index, mode, roles, scope, runFlow, skipScenesWithoutRole }: BuildStepsInput): Step[] {
  if (mode !== 'run' || runFlow === 'mine') return myLinesInScope(index, roles, scope).map((l) => ({ itemId: l.id, mine: true }));
  const ids = scopeItemIds(index, scope);
  const set = new Set(roles);
  return index.lines
    .filter((l) => ids.has(l.id))
    .filter((l) => !skipScenesWithoutRole || index.sceneOfItem.get(l.id)?.scene.characterIds.some((c) => set.has(c)))
    .map((l) => ({ itemId: l.id, mine: set.has(l.speakerId) }));
}

/** В шагах есть хотя бы одна своя реплика — иначе тренировать нечего. */
export const hasMine = (steps: Step[]): boolean => steps.some((s) => s.mine);

/** Позиция для продолжения и навигации: шаг с этим элементом или первый после него по тексту. */
export function findStepIndex(steps: Step[], index: PlayIndex, itemId: string | null | undefined): number {
  if (!itemId) return 0;
  const exact = steps.findIndex((s) => s.itemId === itemId);
  if (exact >= 0) return exact;
  const target = index.pos.get(itemId);
  if (target === undefined) return 0;
  const after = steps.findIndex((s) => (index.pos.get(s.itemId) ?? 0) >= target);
  return after >= 0 ? after : 0;
}
