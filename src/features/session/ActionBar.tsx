// Действия сессии внизу, в зоне большого пальца (раздел 6.3).
import type { ModeId } from '../../engine/modes';
import { currentStep, onPartner, type SessionState } from '../../engine/session-machine';
import { Icon } from '../../app/ui';

export interface SessionActions {
  reveal: () => void;
  hint: () => void;
  next: () => void;
  back: () => void;
  pause: () => void;
}

export function ActionBar({ state, mode, act }: { state: SessionState; mode: ModeId; act: SessionActions }) {
  const revealed = state.phase === 'revealed';
  const step = currentStep(state);
  return (
    <nav className="actionbar" aria-label="Управление">
      <div className="actionbar__inner">
        {mode !== 'audio' &&
          (onPartner(state) ? (
            <div className="actionbar__row actionbar__row--1">
              <button className="btn" type="button" onClick={act.pause} aria-label={`${state.paused ? 'Продолжить' : 'Пауза'} (пробел)`}>
                <Icon name={state.paused ? 'play' : 'pause'} /> {state.paused ? 'Продолжить' : 'Пауза'}
              </button>
            </div>
          ) : (
            step?.mine &&
            !revealed && (
              <div className="actionbar__row">
                <button className="btn" type="button" onClick={act.hint} aria-label="Суфлёр: следующее слово (H)">
                  Суфлёр
                </button>
                <button className="btn btn--primary" type="button" onClick={act.reveal} aria-label="Открыть (пробел)">
                  Открыть
                </button>
              </div>
            )
          ))}
        <div className="actionbar__row">
          <button className="btn" type="button" onClick={act.back} aria-label="Назад (←)">
            <Icon name="back" /> Назад
          </button>
          <button className={`btn${revealed && mode !== 'audio' ? ' btn--primary' : ''}`} type="button" onClick={act.next} aria-label="Далее (→)">
            Далее <Icon name="next" />
          </button>
        </div>
      </div>
    </nav>
  );
}
