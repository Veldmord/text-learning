// Экран аудиопрогона: кто говорит, что сейчас происходит, большая кнопка паузы и «Продолжить».
import type { AudioRunSpan } from '../../engine/audio-plan';
import { getLine, type PlayIndex } from '../../engine/queries';
import { awaitsMine, currentStep, type SessionState } from '../../engine/session-machine';
import { Icon } from '../../app/ui';
import { AudioRunSetting } from './ModeSettings';

export function AudioStage({
  index,
  state,
  speakerName,
  onToggle,
  onAudioRun,
}: {
  index: PlayIndex;
  state: SessionState;
  speakerName: string | null;
  onToggle: () => void;
  onAudioRun: (v: AudioRunSpan) => void;
}) {
  const step = currentStep(state);
  const line = step ? getLine(index, step.itemId) : undefined;
  const waiting = awaitsMine(state);
  const mineNow = waiting || state.audio === 'silence' || state.audio === 'echo';
  const status = waiting
    ? 'Ваша реплика — говорите, затем «Продолжить»'
    : state.audio === 'silence'
      ? 'Ваша реплика — говорите'
      : state.audio === 'echo'
        ? 'Эхо: ваша реплика'
        : state.audio === 'cue' || state.audio === 'context'
          ? 'Слушайте партнёра'
          : '…';
  return (
    <div className="audio-stage">
      <div className="session-meta" style={{ width: '100%' }}>
        <span>Аудиопрогон</span>
        <span>
          {state.index + 1} / {state.steps.length}
        </span>
      </div>
      {!state.paused && state.audio && <span className="pulse" aria-hidden="true" />}
      <div className="audio-stage__who" aria-live="polite">
        {mineNow ? (line ? (index.characters.get(line.speakerId)?.name ?? '') : '') : (speakerName ?? '')}
      </div>
      <div className="audio-stage__state" aria-live="polite">
        {state.paused ? 'Пауза' : status}
      </div>
      <button className="btn btn--primary big-play" type="button" onClick={onToggle} aria-label={state.paused || waiting ? 'Продолжить' : 'Пауза'}>
        <Icon name={state.paused || waiting ? 'play' : 'pause'} />
      </button>
      <p className="small muted">Можно заблокировать экран — управление с гарнитуры и экрана блокировки.</p>
      <div className="session-settings">
        <AudioRunSetting onChange={onAudioRun} />
      </div>
    </div>
  );
}
