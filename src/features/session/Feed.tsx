// Лента «Первых букв» и «Прогона с буквами»: что сказано до текущей реплики, текущая реплика партнёра или своя — первыми буквами.
import { useEffect, useMemo, useRef } from 'react';
import { stepPlan } from '../../engine/audio-plan';
import { MODES } from '../../engine/modes';
import { linePieces } from '../../engine/modes/render';
import type { Step } from '../../engine/modes/steps';
import { speechText } from '../../engine/play-format';
import type { PlayIndex } from '../../engine/queries';
import type { SessionState } from '../../engine/session-machine';
import type { Line } from '../../engine/types';
import { usePlayback, useSettings } from '../../app/store';
import { plural } from '../../app/ui';
import { ContextItem, Pieces } from './LineText';

export function Feed({
  index,
  roles,
  state,
  step,
  line,
  onReplay,
  onTapLine,
}: {
  index: PlayIndex;
  roles: string[];
  state: SessionState;
  step: Step;
  line: Line;
  onReplay: () => void;
  onTapLine: () => void;
}) {
  const settings = useSettings();
  const unit = usePlayback((s) => s.unit);
  const mode = state.mode;
  const revealed = state.phase === 'revealed';
  const showAsides = settings.directions !== 'skip';
  const plan = useMemo(() => stepPlan(mode, index, line.id, roles, settings), [mode, index, line.id, roles, settings]);
  const name = index.characters.get(line.speakerId)?.name ?? '';
  const pieces = linePieces(line, { revealed, hints: state.hints, showAsides });
  const hiddenWords = pieces.filter((p) => p.kind === 'letters').length;

  // Лента сцены: в поле зрения то, что звучит, а когда очередь дошла до вас — своя реплика
  const currentRef = useRef<HTMLDivElement>(null);
  const speakingId = unit?.itemId;
  const yourTurn = step.mine && (state.phase === 'prompt' || state.phase === 'revealed');
  useEffect(() => {
    if (mode !== 'run') return;
    const el = speakingId && !yourTurn ? document.querySelector(`[data-item="${speakingId}"]`) : currentRef.current;
    const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    el?.scrollIntoView?.({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
  }, [mode, speakingId, yourTurn, line.id]);

  return (
    <div>
      <div className="session-meta">
        <span>{MODES[mode].title}</span>
        <span aria-label={`Шаг ${state.index + 1} из ${state.steps.length}`}>
          {state.index + 1} / {state.steps.length}
        </span>
      </div>

      {plan.visible.map((it) => (
        <ContextItem
          key={it.id}
          item={it}
          index={index}
          isCue={step.mine && it.id === plan.cueLine?.id}
          isMine={it.kind === 'line' && roles.includes(it.speakerId)}
          speaking={unit?.itemId === it.id}
          showAsides={showAsides}
          {...(step.mine && it.id === plan.cueLine?.id ? { onReplay } : {})}
        />
      ))}

      {step.mine ? (
        <div ref={currentRef} className={`item item--mine${unit?.itemId === line.id ? ' item--speaking' : ''}`} data-item={line.id}>
          <div className="item__head">
            <span>{name} · вы</span>
            {line.continuation && <span className="chip">после ремарки</span>}
          </div>
          <div className="play-text mine-line" onClick={revealed ? undefined : onTapLine}>
            <Pieces pieces={pieces} />
            {!revealed && hiddenWords > 0 && (
              <span className="sr-only">
                Реплика первыми буквами: {hiddenWords} {plural(hiddenWords, 'слово', 'слова', 'слов')}.
              </span>
            )}
          </div>
        </div>
      ) : (
        <div ref={currentRef}>
          <ContextItem item={line} index={index} isCue isMine={false} speaking showAsides={showAsides} onReplay={onReplay} />
        </div>
      )}
      <div className="sr-only" aria-live="polite">
        {revealed ? `${name}: ${speechText(line)}` : ''}
      </div>
    </div>
  );
}
