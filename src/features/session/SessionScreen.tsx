// Экран тренировки (раздел 6.3): лента сцены сверху, своя реплика первыми буквами, действия — в зоне большого пальца.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { isModeId, MODES, TRAIN_MODES, type ModeId } from '../../engine/modes';
import { formatScope, getLine, parseRoles, parseScope, roleNames, scopeItemIds, scopeLabel, type PlayIndex, type Scope } from '../../engine/queries';
import { awaitsMine, currentStep, onPartner } from '../../engine/session-machine';
import { clearMediaSession, setPlaybackState, updateMediaSession } from '../../audio/media-session';
import { useHotkeys, useLiveQuery, useSwipe, useWakeLock } from '../../app/hooks';
import { repo } from '../../app/services';
import { BASE_URL, useApp, usePlayback, useSettings } from '../../app/store';
import { Icon, Sheet, TopBar } from '../../app/ui';
import { formatSpeed, SPEEDS, VoiceSettings } from '../settings/VoiceSettings';
import { ActionBar } from './ActionBar';
import { AudioStage } from './AudioStage';
import { Feed } from './Feed';
import { ModeSettings } from './ModeSettings';
import { NavigationSheet } from './NavigationSheet';
import { Done, StartGate } from './StartGate';
import { useRunnerState, useSession } from './useSession';

export function SessionScreen() {
  const params = useParams();
  const [search] = useSearchParams();
  const index = useApp((s) => s.index)!;
  const roles = useMemo(() => parseRoles(params.roles, index), [params.roles, index]);
  const scopeStr = search.get('scope') ?? 'all';
  const scope = useMemo(() => parseScope(scopeStr), [scopeStr]);
  if (!roles.length) return <Navigate to="/roles" replace />;
  const base = `/r/${roles.join(',')}`;
  if (params.mode === 'read') return <Navigate to={`${base}/read`} replace />;
  // Режимы прежних версий (по репликам, слабые места и другие) ведут в прогон с тем же диапазоном
  if (!isModeId(params.mode)) return <Navigate to={`${base}/train/run?scope=${encodeURIComponent(formatScope(scope))}`} replace />;
  return <Session key={`${roles.join(',')}|${formatScope(scope)}`} index={index} roles={roles} scope={scope} urlMode={params.mode} at={search.get('at')} />;
}

function Session({ index, roles, scope, urlMode, at }: { index: PlayIndex; roles: string[]; scope: Scope; urlMode: ModeId; at: string | null }) {
  const navigate = useNavigate();
  const [, setSearch] = useSearchParams();
  const scopeKey = formatScope(scope);
  const session = useSession(index, roles, scope, scopeKey, urlMode, at);
  const { runner, started } = session;
  const state = useRunnerState(runner);
  const settings = useSettings();
  const setSessionActive = useApp((s) => s.setSessionActive);
  const unit = usePlayback((s) => s.unit);
  const favorites = useLiveQuery(() => repo.favorites(), [], new Set<string>());
  const [sheet, setSheet] = useState<'settings' | 'modes' | 'nav' | null>(null);
  const mode = started ? state.mode : session.mode;
  const def = MODES[mode];
  const base = `/r/${roles.join(',')}`;
  const overviewUrl = `${base}${scopeKey !== 'all' ? `?scope=${encodeURIComponent(scopeKey)}` : ''}`;
  const scopeIds = useMemo(() => scopeItemIds(index, scope), [index, scope]);

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
  const line = step ? getLine(index, step.itemId) : undefined;
  const sceneRef = step ? index.sceneOfItem.get(step.itemId) : undefined;

  const dispatch = runner.dispatch;
  const act = useMemo(() => {
    const now = () => Date.now();
    return {
      reveal: () => dispatch({ type: 'reveal' }),
      hint: () => dispatch({ type: 'hint' }),
      next: () => dispatch({ type: 'next', now: now() }),
      back: () => dispatch({ type: 'back', now: now() }),
      replay: () => dispatch({ type: 'replayCue' }),
      tapCue: () => dispatch({ type: 'tapCue' }),
      pause: () => dispatch({ type: 'togglePause' }),
      proceed: () => dispatch({ type: 'proceed', now: now() }),
    };
  }, [dispatch]);

  // Пробел, главная кнопка и гарнитура: на реплике партнёра — пауза, на своей — открыть, потом — далее
  const toggle =
    mode === 'audio' ? (awaitsMine(state) ? act.proceed : act.pause) : onPartner(state) ? act.pause : state.phase === 'revealed' ? act.next : act.reveal;
  // Повтор подсказки: в прогоне по очереди подсказка — предыдущий шаг, он звучит заново и возвращает к своей реплике
  const replay = mode === 'run' && settings.runFlow === 'all' && step?.mine && state.steps[state.index - 1]?.mine === false ? act.back : act.replay;

  const switchMode = useCallback(
    (m: ModeId) => {
      setSheet(null);
      void session.switchMode(m);
      navigate(`${base}/train/${m}?scope=${encodeURIComponent(scopeKey)}`, { replace: true });
    },
    [session, navigate, base, scopeKey],
  );

  const start = (fromItemId?: string | null) => {
    session.start(fromItemId);
    // Место из ссылки нужно только для старта: после перезагрузки сессия продолжится с курсора
    if (at) {
      setSearch(
        (p) => {
          p.delete('at');
          return p;
        },
        { replace: true },
      );
    }
  };

  const pickPlace = (itemId: string) => {
    setSheet(null);
    if (started && state.phase !== 'done') runner.jumpTo(itemId);
    else start(itemId);
  };

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

  useHotkeys(
    {
      Space: toggle,
      h: act.hint,
      'р': act.hint,
      r: replay,
      'к': replay,
      ArrowRight: act.next,
      ArrowLeft: act.back,
    },
    active,
  );
  const swipe = useSwipe(act.next, act.back, active);

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
            <button className="btn btn--icon" type="button" aria-label="Навигация по сценам и репликам" onClick={() => setSheet('nav')} disabled={!session.ready}>
              <Icon name="list" />
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
            resumeItemId={session.resumeItemId}
            onStart={start}
            onPickPlace={() => setSheet('nav')}
            onModes={() => setSheet('modes')}
            onAudioRun={session.setAudioRun}
            overviewUrl={overviewUrl}
          />
        ) : state.phase === 'done' ? (
          <Done session={runner.getSession()} total={state.steps.length} onRestart={() => runner.start(state.steps)} overviewUrl={overviewUrl} onModes={() => setSheet('modes')} />
        ) : mode === 'audio' ? (
          <AudioStage index={index} state={state} speakerName={unit ? speakerName : null} onToggle={toggle} onAudioRun={session.setAudioRun} />
        ) : step && line ? (
          <Feed index={index} roles={roles} state={state} step={step} line={line} onReplay={replay} onTapLine={act.reveal} />
        ) : null}
      </main>
      {active && <ActionBar state={state} mode={mode} act={act} />}
      <Sheet title="Настройки сессии" open={sheet === 'settings'} onClose={() => setSheet(null)}>
        <button className="btn btn--block" type="button" onClick={() => setSheet('modes')}>
          Режим: {def.title} — сменить
        </button>
        <ModeSettings mode={mode} onAudioRun={session.setAudioRun} />
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
      <NavigationSheet
        open={sheet === 'nav'}
        onClose={() => setSheet(null)}
        index={index}
        roles={roles}
        steps={started ? state.steps : session.steps}
        scopeIds={scopeIds}
        currentItemId={started && state.phase !== 'done' ? step?.itemId : session.resumeItemId}
        favorites={favorites}
        onPick={pickPlace}
        onWholeRole={scopeKey === 'all' ? null : () => navigate(`${base}/train/${mode}${step ? `?at=${step.itemId}` : ''}`)}
      />
    </>
  );
}
