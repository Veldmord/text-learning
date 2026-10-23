// Экран тренировки (раздел 6.3): контекст и подсказка партнёра сверху, своя реплика, действия — в зоне большого пальца.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { stepPlan, type AudioRunSpan } from '../../engine/audio-plan';
import { isModeId, MODES, TRAIN_MODES, type ModeId } from '../../engine/modes';
import { linePieces } from '../../engine/modes/render';
import type { Step } from '../../engine/modes/steps';
import { speechText } from '../../engine/play-format';
import { formatScope, getLine, parseRoles, parseScope, roleNames, scopeLabel, type PlayIndex, type Scope } from '../../engine/queries';
import { awaitsMine, currentStep, orderSuggestion, type SessionState } from '../../engine/session-machine';
import { GRADE_LABEL, type Grade3 } from '../../engine/srs';
import { VANISH_LEVELS, wordDiff } from '../../engine/text-transforms';
import type { Line } from '../../engine/types';
import { clearMediaSession, setPlaybackState, updateMediaSession } from '../../audio/media-session';
import { useHotkeys, useLiveQuery, useSwipe, useWakeLock } from '../../app/hooks';
import { repo } from '../../app/services';
import { BASE_URL, useApp, usePlayback, useSettings } from '../../app/store';
import { Icon, plural, Segmented, Sheet, Switch, TopBar } from '../../app/ui';
import { formatSpeed, SPEEDS, VoiceSettings } from '../settings/VoiceSettings';
import { ContextItem, Pieces } from './LineText';
import { useRunnerState, useSession } from './useSession';

export function SessionScreen() {
  const params = useParams();
  const [search] = useSearchParams();
  const index = useApp((s) => s.index)!;
  const roles = useMemo(() => parseRoles(params.roles, index), [params.roles, index]);
  const scopeStr = search.get('scope') ?? 'all';
  const scope = useMemo(() => parseScope(scopeStr), [scopeStr]);
  const mode: ModeId = isModeId(params.mode) && params.mode !== 'read' ? params.mode : 'cue';
  if (!roles.length) return <Navigate to="/roles" replace />;
  if (params.mode === 'read') return <Navigate to={`/r/${roles.join(',')}/read`} replace />;
  return <Session key={`${roles.join(',')}|${formatScope(scope)}`} index={index} roles={roles} scope={scope} urlMode={mode} />;
}

const GRADES: Grade3[] = ['again', 'hard', 'good'];

function Session({ index, roles, scope, urlMode }: { index: PlayIndex; roles: string[]; scope: Scope; urlMode: ModeId }) {
  const navigate = useNavigate();
  const scopeKey = formatScope(scope);
  const session = useSession(index, roles, scope, scopeKey, urlMode);
  const { runner, started } = session;
  const state = useRunnerState(runner);
  const settings = useSettings();
  const setSessionActive = useApp((s) => s.setSessionActive);
  const unit = usePlayback((s) => s.unit);
  const [sheet, setSheet] = useState<'settings' | 'modes' | null>(null);
  const mode = started ? state.mode : session.mode;
  const def = MODES[mode];
  const overviewUrl = `/r/${roles.join(',')}${scopeKey !== 'all' ? `?scope=${encodeURIComponent(scopeKey)}` : ''}`;

  useEffect(() => {
    setSessionActive(true);
    return () => {
      setSessionActive(false);
      clearMediaSession();
    };
  }, [setSessionActive]);

  // Режим из URL (например, «Назад» в браузере) — переключаем на лету
  useEffect(() => {
    if (urlMode !== mode) void session.switchMode(urlMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlMode]);

  const active = started && state.phase !== 'done';
  useWakeLock(active);

  const step = currentStep(state);
  const line = step ? getLine(index, step.lineId) : undefined;
  const sceneRef = step ? index.sceneOfItem.get(step.lineId) : undefined;

  const dispatch = runner.dispatch;
  const now = () => Date.now();
  const act = useMemo(
    () => ({
      reveal: () => dispatch({ type: 'reveal' }),
      hint: () => dispatch({ type: 'hint' }),
      next: () => dispatch({ type: 'next', now: now() }),
      back: () => dispatch({ type: 'back', now: now() }),
      grade: (rating: Grade3) => dispatch({ type: 'grade', rating, now: now() }),
      replay: () => dispatch({ type: 'replayCue' }),
      tapCue: () => dispatch({ type: 'tapCue' }),
      pause: () => dispatch({ type: 'togglePause' }),
      proceed: () => dispatch({ type: 'proceed', now: now() }),
    }),
    [dispatch],
  );
  // Главная кнопка, пробел и гарнитура: в аудиопрогоне — пауза или «Продолжить» после своей реплики
  const toggle = mode !== 'audio' ? act.reveal : awaitsMine(state) ? act.proceed : act.pause;

  const switchMode = useCallback(
    (m: ModeId) => {
      setSheet(null);
      void session.switchMode(m);
      navigate(`/r/${roles.join(',')}/train/${m}?scope=${encodeURIComponent(scopeKey)}`, { replace: true });
    },
    [session, navigate, roles, scopeKey],
  );

  // MediaSession: гарнитура и экран блокировки
  const speakerName = unit ? (unit.speakerId === 'narrator' ? 'Ремарка' : (index.characters.get(unit.speakerId)?.name ?? '')) : roleNames(index, roles);
  useEffect(() => {
    if (!active) return;
    updateMediaSession(
      { title: speakerName, artist: sceneRef ? `Д.${sceneRef.act.n} · ${sceneRef.scene.title}` : '', album: index.play.title },
      { play: toggle, pause: toggle, next: act.next, previous: act.back },
      BASE_URL,
    );
    setPlaybackState(state.audio && !state.paused ? 'playing' : 'paused');
  }, [active, toggle, act, speakerName, sceneRef, index, state.audio, state.paused]);

  const graded = def.graded && mode !== 'audio';
  useHotkeys(
    {
      Space: toggle,
      '1': () => graded && act.grade('again'),
      '2': () => graded && act.grade('hard'),
      '3': () => graded && act.grade('good'),
      h: act.hint,
      'р': act.hint,
      r: act.replay,
      'к': act.replay,
      ArrowRight: act.next,
      ArrowLeft: act.back,
    },
    active,
  );
  const swipe = useSwipe(act.next, act.back, active && step?.kind !== 'order');

  const suggestion = useMemo((): Grade3 | null => {
    if (state.phase !== 'revealed' || !step) return null;
    if (step.kind === 'order') return orderSuggestion(state.order);
    if (mode === 'type' && line) return wordDiff(speechText(line), state.typed).suggested;
    return null;
  }, [state.phase, state.order, state.typed, step, mode, line]);

  const sceneTitle = sceneRef ? `Д.${sceneRef.act.n} · Сцена ${sceneRef.number}` : def.title;

  return (
    <>
      <TopBar
        title={started && sceneRef ? sceneTitle : def.title}
        subtitle={started && sceneRef ? sceneRef.scene.title : scopeLabel(index, scope)}
        back={overviewUrl}
        actions={
          <>
            <button
              className="btn btn--ghost btn--small"
              type="button"
              aria-label={`Скорость ${formatSpeed(settings.speed)}, нажмите, чтобы изменить`}
              onClick={() => settings.update({ speed: SPEEDS[(SPEEDS.indexOf(settings.speed) + 1) % SPEEDS.length] ?? 1 })}
            >
              {formatSpeed(settings.speed)}
            </button>
            <button className="btn btn--icon" type="button" aria-label="Настройки сессии" onClick={() => setSheet('settings')}>
              <Icon name="gear" />
            </button>
          </>
        }
      />
      <main className="page page--session" {...swipe}>
        {!session.ready ? (
          <div className="loader" role="status">
            Готовим реплики…
          </div>
        ) : !started ? (
          <StartGate
            index={index}
            mode={mode}
            steps={session.steps}
            scope={scope}
            onStart={session.start}
            onModes={() => setSheet('modes')}
            onAudioRun={session.setAudioRun}
            overviewUrl={overviewUrl}
          />
        ) : state.phase === 'done' ? (
          <Done mode={mode} startedAt={session.startedAt} total={state.steps.length} onRestart={() => runner.start(state.steps)} overviewUrl={overviewUrl} onModes={() => setSheet('modes')} />
        ) : mode === 'audio' ? (
          <AudioStage index={index} state={state} speakerName={unit ? speakerName : null} onToggle={toggle} onAudioRun={session.setAudioRun} />
        ) : step && line ? (
          <StepView
            index={index}
            roles={roles}
            state={state}
            step={step}
            line={line}
            onReplay={act.replay}
            onTapLine={mode === 'letters' || mode === 'run' ? act.reveal : act.tapCue}
            onPick={(pieceId) => dispatch({ type: 'orderPick', pieceId })}
            onType={(text) => dispatch({ type: 'typeInput', text })}
          />
        ) : null}
      </main>
      {active && <ActionBar state={state} mode={mode} act={act} suggestion={suggestion} />}
      <Sheet title="Настройки сессии" open={sheet === 'settings'} onClose={() => setSheet(null)}>
        <button className="btn btn--block" type="button" onClick={() => setSheet('modes')}>
          Режим: {def.title} — сменить
        </button>
        <VoiceSettings compact />
      </Sheet>
      <Sheet title="Режим тренировки" open={sheet === 'modes'} onClose={() => setSheet(null)}>
        <p className="small muted">Режим переключается на лету, позиция сохраняется.</p>
        <div className="grid-modes">
          {TRAIN_MODES.map((m) => (
            <button key={m} type="button" className={`mode-card${m === mode ? ' mode-card--recommended' : ''}`} aria-pressed={m === mode} onClick={() => switchMode(m)}>
              <span className="mode-card__icon" aria-hidden="true">
                {MODES[m].icon}
              </span>
              <strong>{MODES[m].title}</strong>
              <span>{MODES[m].when}</span>
            </button>
          ))}
        </div>
      </Sheet>
    </>
  );
}

// ---------------------------------------------------------------------------

function StartGate({
  index,
  mode,
  steps,
  scope,
  onStart,
  onModes,
  onAudioRun,
  overviewUrl,
}: {
  index: PlayIndex;
  mode: ModeId;
  steps: Step[];
  scope: Scope;
  onStart: () => void;
  onModes: () => void;
  onAudioRun: (v: AudioRunSpan) => void;
  overviewUrl: string;
}) {
  const def = MODES[mode];
  if (!steps.length) {
    return (
      <div className="start-gate">
        <h2>{def.title}</h2>
        <p className="muted">
          {mode === 'weak' || scope.weak
            ? 'Сейчас нет реплик, которым пора на повторение. Отличная работа!'
            : mode === 'chunks'
              ? 'В этом диапазоне нет реплик длиннее 40 слов.'
              : 'В этом диапазоне нет ваших реплик.'}
        </p>
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
  const unit = mode === 'order' ? ['головоломка', 'головоломки', 'головоломок'] : mode === 'chunks' ? ['шаг', 'шага', 'шагов'] : ['реплика', 'реплики', 'реплик'];
  return (
    <div className="start-gate">
      <span style={{ fontSize: '2.5rem' }} aria-hidden="true">
        {def.icon}
      </span>
      <h2 style={{ margin: 0 }}>{def.title}</h2>
      <p className="muted" style={{ margin: 0, maxWidth: 520 }}>
        {def.description}
      </p>
      <p className="small">
        {scopeLabel(index, scope)} · {steps.length} {plural(steps.length, unit[0]!, unit[1]!, unit[2]!)}
      </p>
      <button className="btn btn--primary big-play" type="button" onClick={onStart} aria-label="Начать">
        <Icon name="play" />
      </button>
      <span className="small muted">Начать. Звук включается по нажатию.</span>
      <button className="btn btn--ghost btn--small" type="button" onClick={onModes}>
        Сменить режим
      </button>
      {mode === 'audio' && <AudioRunSetting onChange={onAudioRun} />}
      {mode === 'audio' && <p className="small muted">Наушники: пауза — «Показать/пауза», следующий трек — «Далее», предыдущий — «Назад».</p>}
    </div>
  );
}

function AudioRunSetting({ onChange }: { onChange: (v: AudioRunSpan) => void }) {
  const value = useSettings((s) => s.audioRun);
  const skipScenes = useSettings((s) => s.skipScenesWithoutRole);
  const update = useSettings((s) => s.update);
  return (
    <div style={{ width: '100%', maxWidth: 520, textAlign: 'left' }}>
      <Segmented<AudioRunSpan>
        label="Что звучит"
        value={value}
        onChange={onChange}
        options={[
          { value: 'cue', label: 'Подсказка → моя реплика' },
          { value: 'play', label: 'Вся пьеса' },
        ]}
        hint={
          value === 'cue'
            ? 'Звучит подсказка партнёра, на вашей реплике — пауза, затем прогон идёт дальше сам.'
            : 'Звучат все реплики подряд. На вашей реплике звук останавливается: скажите её и нажмите «Продолжить».'
        }
      />
      {value === 'play' && (
        <Switch
          label="Пропускать сцены без моей роли"
          hint={skipScenes ? 'Звучат только сцены, где вы заняты' : 'Звучит вся пьеса с начала диапазона'}
          checked={skipScenes}
          onChange={(v) => update({ skipScenesWithoutRole: v })}
        />
      )}
    </div>
  );
}

function Done({ mode, startedAt, total, onRestart, overviewUrl, onModes }: { mode: ModeId; startedAt: number; total: number; onRestart: () => void; overviewUrl: string; onModes: () => void }) {
  const reviews = useLiveQuery(() => repo.allReviews().then((all) => all.filter((r) => r.ts >= startedAt && r.mode === mode)), [startedAt, mode], []);
  const count = (g: Grade3) => reviews.filter((r) => r.rating === g).length;
  return (
    <div className="start-gate" role="status">
      <span style={{ fontSize: '2.5rem' }} aria-hidden="true">
        🎉
      </span>
      <h2 style={{ margin: 0 }}>Диапазон пройден</h2>
      {MODES[mode].graded ? (
        <p>
          Знал: <strong>{count('good')}</strong> · С ошибкой: <strong>{count('hard')}</strong> · Не знал: <strong>{count('again')}</strong>
        </p>
      ) : (
        <p>
          Пройдено шагов: <strong>{total}</strong>
        </p>
      )}
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

// ---------------------------------------------------------------------------

function StepView({
  index,
  roles,
  state,
  step,
  line,
  onReplay,
  onTapLine,
  onPick,
  onType,
}: {
  index: PlayIndex;
  roles: string[];
  state: SessionState;
  step: Step;
  line: Line;
  onReplay: () => void;
  onTapLine: () => void;
  onPick: (pieceId: string) => void;
  onType: (text: string) => void;
}) {
  const settings = useSettings();
  const unit = usePlayback((s) => s.unit);
  const card = useLiveQuery(() => repo.getCard(line.id), [line.id], undefined);
  const note = useLiveQuery(() => repo.getNote(line.id), [line.id], undefined);
  const mode = state.mode;
  const revealed = state.phase === 'revealed';
  const showAsides = settings.directions !== 'skip';
  const plan = useMemo(
    () => (step.kind === 'order' || (step.kind === 'chunk' && step.part > 1) ? null : stepPlan(mode, index, line.id, roles, settings)),
    [mode, index, line.id, roles, settings, step],
  );
  const name = index.characters.get(line.speakerId)?.name ?? '';
  const sentenceIdx = step.kind === 'chunk' ? step.sentenceIdx : undefined;
  const vanishLevel = card?.vanishLevel ?? 0;
  const pieces = linePieces(line, { mode, revealed, hints: state.hints, vanishLevel, showAsides, ...(sentenceIdx ? { sentenceIdx } : {}) });
  const fullText = sentenceIdx ? sentenceIdx.map((i) => line.sentences[i]?.text ?? '').join(' ') : speechText(line);
  const hiddenWords = pieces.filter((p) => p.kind === 'blank' || p.kind === 'letters').length;

  // Лента сцены: в поле зрения то, что звучит, а когда очередь дошла до вас — своя реплика
  const mineRef = useRef<HTMLDivElement>(null);
  const speakingId = unit?.itemId;
  const yourTurn = state.phase === 'prompt' || state.phase === 'revealed';
  useEffect(() => {
    if (mode !== 'run') return;
    const el = speakingId ? document.querySelector(`[data-item="${speakingId}"]`) : yourTurn ? mineRef.current : null;
    const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    el?.scrollIntoView?.({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
  }, [mode, speakingId, yourTurn, line.id]);

  return (
    <div>
      <div className="session-meta">
        <span>
          {MODES[mode].title}
          {mode === 'vanish' && <span className="chip"> скрыто {VANISH_LEVELS[vanishLevel]} %</span>}
          {step.kind === 'chunk' && (
            <span className="chip">
              часть {step.part} из {step.parts}
            </span>
          )}
          {state.attempt > 0 && <span className="chip">попытка {state.attempt + 1}</span>}
        </span>
        <span aria-label={`Шаг ${state.index + 1} из ${state.steps.length}`}>
          {state.index + 1} / {state.steps.length}
        </span>
      </div>

      {step.kind === 'order' ? (
        <OrderPuzzle state={state} step={step} onPick={onPick} />
      ) : (
        <>
          {plan?.visible.map((it) => (
            <ContextItem
              key={it.id}
              item={it}
              index={index}
              isCue={it.id === plan.cueLine?.id}
              isMine={it.kind === 'line' && roles.includes(it.speakerId)}
              speaking={unit?.itemId === it.id}
              showAsides={showAsides}
              {...(it.id === plan.cueLine?.id ? { onReplay } : {})}
            />
          ))}
          <div ref={mineRef} className={`item item--mine${unit?.itemId === line.id ? ' item--speaking' : ''}`} data-item={line.id}>
            <div className="item__head">
              <span>{name} · вы</span>
              {line.continuation && <span className="chip">после ремарки</span>}
            </div>
            <div className="play-text mine-line" onClick={revealed ? undefined : onTapLine}>
              <Pieces pieces={pieces} />
              {!revealed && hiddenWords > 0 && <span className="sr-only">Реплика скрыта: {hiddenWords} {plural(hiddenWords, 'слово', 'слова', 'слов')}.</span>}
            </div>
            {mode === 'type' && <TypedAnswer state={state} expected={fullText} onType={onType} />}
            {revealed && note && (
              <p className="small muted" style={{ marginBottom: 0 }}>
                <strong>Заметка:</strong> {note.text}
              </p>
            )}
          </div>
        </>
      )}
      <div className="sr-only" aria-live="polite">
        {revealed && step.kind !== 'order' ? `${name}: ${fullText}` : ''}
      </div>
    </div>
  );
}

function TypedAnswer({ state, expected, onType }: { state: SessionState; expected: string; onType: (text: string) => void }) {
  const revealed = state.phase === 'revealed';
  const diff = useMemo(() => (revealed ? wordDiff(expected, state.typed) : null), [revealed, expected, state.typed]);
  if (!diff) {
    return (
      <div className="field">
        <label className="field__label" htmlFor="typed">
          Наберите реплику по памяти
        </label>
        <textarea
          id="typed"
          className="input"
          value={state.typed}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          lang="ru"
          onChange={(e) => onType(e.target.value)}
        />
      </div>
    );
  }
  return (
    <div className="field" aria-label="Сравнение по словам">
      <span className="field__label">
        Совпадение {Math.round(diff.accuracy * 100)} % · ошибок {diff.errors} · предлагаемая оценка: {GRADE_LABEL[diff.suggested]}
      </span>
      <p className="play-text" style={{ margin: 0 }}>
        {diff.ops.map((o, i) => {
          if (o.op === 'eq') return <span key={i} className="diff-eq">{o.expected} </span>;
          if (o.op === 'del')
            return (
              <span key={i} className="diff-del" title="Пропущено">
                {o.expected}{' '}
              </span>
            );
          if (o.op === 'ins')
            return (
              <span key={i} className="diff-ins" title="Лишнее">
                {o.typed}{' '}
              </span>
            );
          return (
            <span key={i} className="diff-sub" title={`Вы написали: ${o.typed}`}>
              {o.expected} <span className="diff-ins">{o.typed}</span>{' '}
            </span>
          );
        })}
      </p>
    </div>
  );
}

function OrderPuzzle({ state, step, onPick }: { state: SessionState; step: Extract<Step, { kind: 'order' }>; onPick: (id: string) => void }) {
  const revealed = state.phase === 'revealed';
  const placed = state.order.placed;
  const remaining = step.shuffled.filter((p) => !placed.includes(p.id));
  return (
    <div>
      <h2 style={{ fontSize: '1.05rem' }}>{step.title}</h2>
      <p className="small muted">Нажимайте реплики в том порядке, в котором вы их говорите.</p>
      {revealed ? (
        <>
          <ol className="order-placed">
            {step.pieces.map((p) => (
              <li key={p.id}>{p.text}</li>
            ))}
          </ol>
          <p role="status">
            {state.order.gaveUp ? 'Показан правильный порядок.' : `Ошибок: ${state.order.mistakes}.`} Предлагаемая оценка: <strong>{GRADE_LABEL[orderSuggestion(state.order)]}</strong>
          </p>
        </>
      ) : (
        <>
          {placed.length > 0 && (
            <ol className="order-placed" aria-label="Уже по порядку">
              {placed.map((id) => (
                <li key={id}>{step.pieces.find((p) => p.id === id)?.text}</li>
              ))}
            </ol>
          )}
          <div className="order-pieces">
            {remaining.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`order-piece${state.order.wrong === p.id ? ' order-piece--wrong' : ''}`}
                onClick={() => onPick(p.id)}
              >
                {p.text}
              </button>
            ))}
          </div>
          <p className="small muted" aria-live="polite">
            {state.order.wrong ? 'Не эта — попробуйте другую.' : ''} Ошибок: {state.order.mistakes}
          </p>
        </>
      )}
    </div>
  );
}

function AudioStage({
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
  const line = step ? getLine(index, step.lineId) : undefined;
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
      <AudioRunSetting onChange={onAudioRun} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function ActionBar({
  state,
  mode,
  act,
  suggestion,
}: {
  state: SessionState;
  mode: ModeId;
  act: { reveal: () => void; hint: () => void; next: () => void; back: () => void; grade: (g: Grade3) => void; pause: () => void };
  suggestion: Grade3 | null;
}) {
  const step = currentStep(state);
  const revealed = state.phase === 'revealed';
  const nav = (
    <div className="actionbar__row">
      <button className="btn" type="button" onClick={act.back} aria-label="Назад (←)">
        <Icon name="back" /> Назад
      </button>
      <button className="btn" type="button" onClick={act.next} aria-label="Далее (→)">
        Далее <Icon name="next" />
      </button>
    </div>
  );
  if (mode === 'audio') {
    return (
      <nav className="actionbar" aria-label="Управление">
        <div className="actionbar__inner">{nav}</div>
      </nav>
    );
  }
  return (
    <nav className="actionbar" aria-label="Управление">
      <div className="actionbar__inner">
        {revealed ? (
          <div className="actionbar__row actionbar__row--3" role="group" aria-label="Оценка">
            {GRADES.map((g, i) => (
              <button
                key={g}
                type="button"
                className={`btn btn--${g}${suggestion === g ? ' btn--suggested' : ''}`}
                onClick={() => act.grade(g)}
                aria-label={`${GRADE_LABEL[g]} (${i + 1})`}
              >
                {GRADE_LABEL[g]}
              </button>
            ))}
          </div>
        ) : step?.kind === 'order' ? (
          <div className="actionbar__row" style={{ gridTemplateColumns: '1fr' }}>
            <button className="btn" type="button" onClick={act.reveal}>
              Сдаться и показать порядок
            </button>
          </div>
        ) : (
          <div className="actionbar__row">
            <button className="btn" type="button" onClick={act.hint} aria-label="Суфлёр: следующее слово (H)">
              Суфлёр
            </button>
            <button className="btn btn--primary" type="button" onClick={act.reveal} aria-label={`${mode === 'type' ? 'Проверить' : 'Показать'} (пробел)`}>
              {mode === 'type' ? 'Проверить' : mode === 'letters' || mode === 'run' ? 'Открыть' : 'Показать'}
            </button>
          </div>
        )}
        {nav}
      </div>
    </nav>
  );
}
