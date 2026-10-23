// Связка SessionRunner с React: создание, загрузка шагов и курсора, снимок состояния, настройки.
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { AudioRunSpan } from '../../engine/audio-plan';
import type { ModeId } from '../../engine/modes';
import { buildSteps, type Step } from '../../engine/modes/steps';
import { cursorKey } from '../../engine/model';
import { rolesKey, type PlayIndex, type Scope } from '../../engine/queries';
import { SessionRunner, type RunnerSettings } from '../../engine/session-runner';
import { audioEngine, clipMs, reportError, repo, requestPersist } from '../../app/services';
import { getSettings, useSettings } from '../../app/store';

const runnerSettings = (): RunnerSettings => {
  const s = getSettings();
  return {
    cueLength: s.cueLength,
    cueWords: s.cueWords,
    directions: s.directions,
    context: s.context,
    pauseMs: s.pauseMs,
    autoAdvance: s.autoAdvance,
    echo: s.echo,
    audioRunK: s.audioRunK,
    audioRun: s.audioRun,
    skipScenesWithoutRole: s.skipScenesWithoutRole,
    premiere: s.premiere,
  };
};

export interface SessionHandle {
  runner: SessionRunner;
  /** Шаги построены, курсор прочитан */
  ready: boolean;
  /** Сессия запущена кнопкой «Начать» */
  started: boolean;
  start: () => void;
  switchMode: (mode: ModeId) => Promise<void>;
  /** Вариант аудиопрогона меняется прямо в режиме: текущая реплика начинается заново */
  setAudioRun: (audioRun: AudioRunSpan) => void;
  steps: Step[];
  startedAt: number;
  /** Текущий режим (до старта — выбранный, после — режим раннера) */
  mode: ModeId;
}

export function useSession(index: PlayIndex, roles: string[], scope: Scope, scopeKey: string, initialMode: ModeId): SessionHandle {
  const key = rolesKey(roles);
  // Раннер живёт, пока не сменились роли или диапазон; смена режима — на лету (FR-04)
  const runner = useMemo(
    () =>
      new SessionRunner(
        {
          index,
          roles,
          scopeKey,
          audio: audioEngine(),
          store: repo,
          settings: runnerSettings,
          clipMs,
          onGraded: () => void requestPersist(),
          onError: (e) => reportError(e, 'session'),
        },
        initialMode,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [index, key, scopeKey],
  );
  const [ready, setReady] = useState(false);
  const [started, setStarted] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [resumeLineId, setResumeLineId] = useState<string | undefined>();
  const [startedAt] = useState(() => Date.now());
  const [mode, setMode] = useState<ModeId>(initialMode);

  useEffect(() => {
    runner.revive();
    return () => runner.dispose();
  }, [runner]);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setStarted(false);
    (async () => {
      const cards = await repo.getCards();
      const built = buildSteps({ index, mode: initialMode, roles, scope, cards, now: Date.now() });
      const cursor = await repo.getCursor(cursorKey(key, initialMode, scopeKey));
      if (cancelled) return;
      setSteps(built);
      setResumeLineId(cursor?.itemId);
      setReady(true);
    })().catch((e: unknown) => reportError(e, 'session'));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runner]);

  const start = useCallback(() => {
    try {
      audioEngine().unlock();
    } catch (e) {
      // Без разблокировки звука тренировка всё равно идёт: текст и голос браузера
      reportError(e, 'audio');
    }
    runner.start(steps, resumeLineId, mode);
    setStarted(true);
  }, [runner, steps, resumeLineId, mode]);

  const switchMode = useCallback(
    async (mode: ModeId) => {
      const cards = await repo.getCards();
      const built = buildSteps({ index, mode, roles, scope, cards, now: Date.now() });
      setSteps(built);
      setMode(mode);
      if (started) runner.setMode(mode, built);
      else setResumeLineId((await repo.getCursor(cursorKey(key, mode, scopeKey)))?.itemId);
    },
    [index, roles, scope, key, scopeKey, runner, started],
  );

  // Автопереход, «эхо» и остановка на своей реплике применяются сразу, без перезапуска сессии
  const autoAdvance = useSettings((s) => s.autoAdvance);
  const echo = useSettings((s) => s.echo);
  const waitOnMine = useSettings((s) => s.audioRun === 'play');
  useEffect(() => {
    runner.dispatch({ type: 'setOptions', autoAdvance, echo, waitOnMine });
  }, [runner, autoAdvance, echo, waitOnMine]);

  const setAudioRun = useCallback(
    (audioRun: AudioRunSpan) => {
      useSettings.getState().update({ audioRun });
      runner.dispatch({ type: 'setOptions', waitOnMine: audioRun === 'play' });
      if (started) runner.restartStep();
    },
    [runner, started],
  );

  return { runner, ready, started, start, switchMode, setAudioRun, steps, startedAt, mode };
}

export function useRunnerState(runner: SessionRunner) {
  return useSyncExternalStore(runner.subscribe, runner.getState, runner.getState);
}
