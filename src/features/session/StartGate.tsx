// Перед стартом: что за режим, откуда начнём, выбор места и настройки хода. После конца — итог сессии.
import { Link } from 'react-router-dom';
import type { AudioRunSpan } from '../../engine/audio-plan';
import type { SessionRow } from '../../engine/model';
import { MODES, type ModeId } from '../../engine/modes';
import { findStepIndex, hasMine, type Step } from '../../engine/modes/steps';
import { getLine, lineSpeech, sceneRefLabel, scopeLabel, speakerName, type PlayIndex, type Scope } from '../../engine/queries';
import { formatDuration, Icon, plural, preview } from '../../app/ui';
import { ModeSettings } from './ModeSettings';

/** «Д.1 · 3. Встреча — Борис: «Пришёл. Устал.»» */
export function placeLabel(index: PlayIndex, itemId: string): string {
  const ref = index.sceneOfItem.get(itemId);
  const line = getLine(index, itemId);
  const where = ref ? sceneRefLabel(ref) : '';
  return line ? `${where} — ${speakerName(index, line)}: «${preview(lineSpeech(line), 50)}»` : where;
}

export function StartGate({
  index,
  mode,
  steps,
  scope,
  resumeItemId,
  onStart,
  onPickPlace,
  onModes,
  onAudioRun,
  overviewUrl,
}: {
  index: PlayIndex;
  mode: ModeId;
  steps: Step[];
  scope: Scope;
  resumeItemId: string | undefined;
  onStart: (fromItemId?: string | null) => void;
  onPickPlace: () => void;
  onModes: () => void;
  onAudioRun: (v: AudioRunSpan) => void;
  overviewUrl: string;
}) {
  const def = MODES[mode];
  if (!hasMine(steps)) {
    return (
      <div className="start-gate">
        <h2>{def.title}</h2>
        <p className="muted">В этом диапазоне нет ваших реплик.</p>
        <div className="row">
          <Link className="btn btn--primary" to={overviewUrl}>
            К обзору роли
          </Link>
          <button className="btn" type="button" onClick={onModes}>
            Другой режим
          </button>
        </div>
      </div>
    );
  }
  const mine = steps.filter((s) => s.mine).length;
  const from = findStepIndex(steps, index, resumeItemId);
  const fromItem = steps[from]?.itemId;
  return (
    <div className="start-gate">
      <span style={{ fontSize: '2.5rem' }} aria-hidden="true">
        {def.icon}
      </span>
      <h2 style={{ margin: 0 }}>{def.title}</h2>
      <p className="muted" style={{ margin: 0, maxWidth: 520 }}>
        {def.description}
      </p>
      <p className="small" style={{ margin: 0 }}>
        {scopeLabel(index, scope)} · {mine} {plural(mine, 'ваша реплика', 'ваши реплики', 'ваших реплик')}
      </p>
      {from > 0 && fromItem && (
        <p className="small" style={{ margin: 0, maxWidth: 520 }}>
          <strong>Начнём с места:</strong> {placeLabel(index, fromItem)}
        </p>
      )}
      <button className="btn btn--primary big-play" type="button" onClick={() => onStart()} aria-label="Начать">
        <Icon name="play" />
      </button>
      <span className="small muted">Начать. Звук включается по нажатию.</span>
      <div className="row" style={{ justifyContent: 'center' }}>
        <button className="btn btn--small" type="button" onClick={onPickPlace}>
          <Icon name="list" /> Выбрать место
        </button>
        {from > 0 && (
          <button className="btn btn--small btn--ghost" type="button" onClick={() => onStart(null)}>
            С начала
          </button>
        )}
        <button className="btn btn--small btn--ghost" type="button" onClick={onModes}>
          Сменить режим
        </button>
      </div>
      <div className="session-settings">
        <ModeSettings mode={mode} onAudioRun={onAudioRun} />
      </div>
      {mode === 'audio' && <p className="small muted">Наушники: play/pause — пауза или «Продолжить», следующий трек — «Далее», предыдущий — «Назад».</p>}
    </div>
  );
}

export function Done({
  session,
  total,
  onRestart,
  overviewUrl,
  onModes,
}: {
  session: SessionRow | null;
  total: number;
  onRestart: () => void;
  overviewUrl: string;
  onModes: () => void;
}) {
  const scenes = session?.scenes.length ?? 0;
  return (
    <div className="start-gate" role="status">
      <span style={{ fontSize: '2.5rem' }} aria-hidden="true">
        🎉
      </span>
      <h2 style={{ margin: 0 }}>Диапазон пройден</h2>
      <p style={{ margin: 0 }}>
        Своих реплик: <strong>{session?.lines ?? 0}</strong> · Сцен целиком: <strong>{scenes}</strong> · Время: <strong>{formatDuration(session?.activeMs ?? 0)}</strong>
      </p>
      <p className="small muted" style={{ margin: 0 }}>
        Шагов в диапазоне: {total}
      </p>
      <div className="row" style={{ justifyContent: 'center' }}>
        <button className="btn btn--primary" type="button" onClick={onRestart}>
          Ещё раз
        </button>
        <button className="btn" type="button" onClick={onModes}>
          Другой режим
        </button>
        <Link className="btn btn--ghost" to={overviewUrl}>
          К обзору
        </Link>
      </div>
    </div>
  );
}
