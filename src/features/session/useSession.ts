// Связка SessionRunner с React: создание, загрузка шагов и курсора, снимок состояния, настройки.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
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
    runFlow: s.runFlow,
    autoAdvance: s.autoAdvance,
    echo: s.echo,
    audioRunK: s.audioRunK,
    audioRun: s.audioRun,
    skipScenesWithoutRole: s.skipScenesWithoutRole,
  };
};

export interface SessionHandle {
  runner: SessionRunner;
  /** Шаги построены, курсор прочитан */
  ready: boolean;
  /** Сессия запущена кнопкой «Начать» или выбором места */
  started: boolean;
  /** Начать с реплики `fromItemId`, по умолчанию — с места остановки */
  start: (fromItemId?: string | null) => void;
  switchMode: (mode: ModeId) => Promise<void>;
  /** Вариант аудиопрогона меняется прямо в режиме: текущая реплика начинается заново */
  setAudioRun: (audioRun: AudioRunSpan) => void;
  steps: Step[];
  /** Откуда начнётся сессия: место из ссылки или где актёр остановился */
  resumeItemId: string | undefined;
  /** Текущий режим (до старта — выбранный, после — режим раннера) */
  mode: ModeId;
}

/** Звук на iOS разблокируется только в обработчике жеста — вызываем до старта сессии. */
function unlockAudio() {
  try {
    audioEngine().unlock();
  } catch (e) {
    // Без разблокировки звука тренировка всё равно идёт: текст и голос браузера
    reportError(e, 'audio');
  }
}

export function useSession(index: PlayIndex, roles: string[], scope: Scope, scopeKey: string, initialMode: ModeId, at: string | null): SessionHandle {
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
          onSaved: () => void requestPersist(),
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
  const [resumeItemId, setResumeItemId] = useState<string | undefined>();
  const [mode, setMode] = useState<ModeId>(initialMode);
  const runFlow = useSettings((s) => s.runFlow);
  const skipScenesWithoutRole = useSettings((s) => s.skipScenesWithoutRole);
  const build = useCallback(
    (m: ModeId) => buildSteps({ index, mode: m, roles, scope, runFlow: getSettings().runFlow, skipScenesWithoutRole: getSettings().skipScenesWithoutRole }),
    [index, roles, scope],
  );

  useEffect(() => {
    runner.revive();
    return () => runner.dispose();
  }, [runner]);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setStarted(false);
    (async () => {
      const built = build(initialMode);
      const cursor = at ? undefined : await repo.getCursor(cursorKey(key, initialMode, scopeKey));
      if (cancelled) return;
      setSteps(built);
      setResumeItemId(at ?? cursor?.itemId);
      setReady(true);
    })().catch((e: unknown) => reportError(e, 'session'));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runner]);

  // Ход прогона и пропуск сцен меняют набор шагов: пересобираем на лету, позиция сохраняется
  const firstBuild = useRef(true);
  useEffect(() => {
    if (firstBuild.current) {
      firstBuild.current = false;
      return;
    }
    const built = build(mode);
    setSteps(built);
    if (started) runner.setMode(mode, built);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runFlow, skipScenesWithoutRole]);

  const start = useCallback(
    (fromItemId?: string | null) => {
      unlockAudio();
      runner.start(steps, fromItemId === undefined ? resumeItemId : fromItemId, mode);
      setStarted(true);
    },
    [runner, steps, resumeItemId, mode],
  );

  const switchMode = useCallback(
    async (next: ModeId) => {
      const built = build(next);
      setSteps(built);
      setMode(next);
      if (started) runner.setMode(next, built);
      else setResumeItemId((await repo.getCursor(cursorKey(key, next, scopeKey)))?.itemId);
    },
    [build, key, scopeKey, runner, started],
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

  return { runner, ready, started, start, switchMode, setAudioRun, steps, resumeItemId, mode };
}

export function useRunnerState(runner: SessionRunner) {
  return useSyncExternalStore(runner.subscribe, runner.getState, runner.getState);
}
