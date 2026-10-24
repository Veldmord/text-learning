import { describe, expect, it } from 'vitest';
import type { SpeechUnit } from '../../src/engine/audio-plan';
import type { SessionRow } from '../../src/engine/model';
import type { ModeId } from '../../src/engine/modes';
import { buildSteps } from '../../src/engine/modes/steps';
import { parseScope } from '../../src/engine/queries';
import { SessionRunner, STEP_TIME_CAP_MS, type AudioPort, type PlayOptions, type RunnerSettings, type StorePort } from '../../src/engine/session-runner';
import { miniPlay } from './fixtures';

class FakeAudio implements AudioPort {
  played: SpeechUnit[][] = [];
  opts: (PlayOptions | undefined)[] = [];
  silences: number[] = [];
  stops = 0;
  paused = false;
  resumable = true;
  private pending: ((v: boolean) => void) | null = null;
  play(units: SpeechUnit[], opts?: PlayOptions) {
    this.played.push(units);
    this.opts.push(opts);
    // Как и настоящий движок, пустая очередь «доигрывается» сразу
    if (!units.length) return Promise.resolve(true);
    return new Promise<boolean>((r) => (this.pending = r));
  }
  silence(ms: number) {
    this.silences.push(ms);
    return new Promise<boolean>((r) => (this.pending = r));
  }
  /** Доиграть текущий фрагмент */
  async finish() {
    const p = this.pending;
    this.pending = null;
    p?.(true);
    await new Promise((r) => setTimeout(r, 0));
  }
  stop() {
    this.stops++;
    const p = this.pending;
    this.pending = null;
    p?.(false);
  }
  pause() {
    this.paused = true;
  }
  resume() {
    this.paused = false;
    return this.resumable;
  }
}

class MemoryStore implements StorePort {
  cursors = new Map<string, string>();
  sessions = new Map<string, SessionRow>();
  async saveCursor(key: string, itemId: string | null) {
    if (itemId === null) this.cursors.delete(key);
    else this.cursors.set(key, itemId);
  }
  async saveSession(row: SessionRow) {
    this.sessions.set(row.id, row);
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

const settings: RunnerSettings = {
  cueLength: 'full',
  cueWords: 10,
  directions: 'text',
  context: 1,
  pauseMs: 0,
  runFlow: 'all',
  autoAdvance: true,
  echo: false,
  audioRunK: 1.5,
  audioRun: 'cue',
  skipScenesWithoutRole: true,
};

function setup(mode: ModeId = 'letters', over: Partial<RunnerSettings> = {}, scopeKey = 'all') {
  const { index } = miniPlay();
  const audio = new FakeAudio();
  const store = new MemoryStore();
  const errors: unknown[] = [];
  let saved = 0;
  let ids = 0;
  const clock = { t: 1_000_000 };
  const s = { ...settings, ...over };
  const runner = new SessionRunner(
    {
      index,
      roles: ['a'],
      scopeKey,
      audio,
      store,
      settings: () => s,
      clipMs: () => 1000,
      now: () => clock.t,
      newId: () => `s${++ids}`,
      onSaved: () => saved++,
      onError: (e) => errors.push(e),
    },
    mode,
  );
  const build = (m: ModeId) => buildSteps({ index, mode: m, roles: ['a'], scope: parseScope(scopeKey), runFlow: s.runFlow, skipScenesWithoutRole: s.skipScenesWithoutRole });
  const next = (ms = 0) => {
    clock.t += ms;
    runner.dispatch({ type: 'next', now: clock.t });
  };
  return { index, audio, store, runner, steps: build(mode), build, errors, saved: () => saved, clock, next };
}

describe('SessionRunner', () => {
  it('играет подсказку партнёра и сохраняет курсор', async () => {
    const { audio, store, runner, steps, next } = setup();
    runner.start(steps);
    await tick();
    expect(audio.played.slice(0, 2)).toEqual([[], []]);
    expect(runner.getState().phase).toBe('prompt');
    next();
    next();
    expect(runner.currentLine()?.id).toBe('L0004');
    await tick();
    expect(runner.getState().phase).toBe('cue');
    expect(audio.played.at(-1)?.map((u) => u.itemId)).toEqual(['L0003']);
    // В «Первых буквах» после подсказки сразу своя реплика
    expect(audio.opts.at(-1)).toBeUndefined();
    await audio.finish();
    expect(runner.getState().phase).toBe('prompt');
    await runner.flush();
    expect(store.cursors.get('a:letters:all')).toBe('L0004');
  });

  it('журнал сессии: время, сказанные реплики и сцена, пройденная целиком', async () => {
    const { store, runner, steps, next, saved } = setup();
    runner.start(steps);
    await tick();
    next(4000);
    next(1000);
    await tick();
    next();
    next(2000);
    next(1000);
    await runner.flush();
    const rows = [...store.sessions.values()];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 's1', rolesKey: 'a', mode: 'letters', startedAt: 1_000_000, activeMs: 8000, lines: 2, scenes: ['a1s01'] });
    expect(runner.getSession()).toEqual(rows[0]);
    expect(saved()).toBe(2);
  });

  it('сцена не засчитывается, если до своих реплик не дошла очередь', async () => {
    const { store, runner, steps, next } = setup();
    runner.start(steps, 'L0004');
    await tick();
    next();
    next();
    next();
    await runner.flush();
    expect([...store.sessions.values()][0]).toMatchObject({ lines: 1, scenes: [] });
  });

  it('уход с экрана посреди реплики: время и сказанная реплика идут в журнал', async () => {
    const { store, runner, steps, clock } = setup();
    runner.dispose();
    expect(store.sessions.size).toBe(0);
    runner.revive();
    runner.start(steps);
    await tick();
    clock.t += 7000;
    runner.dispose();
    runner.dispose();
    await runner.flush();
    expect([...store.sessions.values()]).toEqual([expect.objectContaining({ activeMs: 7000, lines: 1, scenes: [] })]);
  });

  it('время на шаге ограничено: актёр мог отойти от телефона', async () => {
    const { store, runner, steps, next } = setup();
    runner.start(steps);
    await tick();
    next();
    next(60 * 60_000);
    await runner.flush();
    expect([...store.sessions.values()][0]!.activeMs).toBe(STEP_TIME_CAP_MS);
  });

  it('смена режима на лету: позиция сохраняется, журнал — новая запись', async () => {
    const { store, runner, steps, build, clock } = setup();
    runner.start(steps, 'L0007');
    expect(runner.currentLine()?.id).toBe('L0007');
    clock.t += 3000;
    runner.setMode('run', build('run'));
    expect(runner.getState()).toMatchObject({ mode: 'run', index: 5 });
    runner.jumpTo('L0009');
    await runner.flush();
    expect([...store.sessions.values()].map((r) => [r.mode, r.activeMs])).toEqual([
      ['letters', 3000],
      ['run', 0],
    ]);
  });

  it('прогон по очереди: реплики партнёров звучат по одной и сами ведут к своей', async () => {
    const { audio, runner, steps } = setup('run');
    runner.start(steps, 'L0002');
    expect(runner.getState().index).toBe(1);
    await tick();
    expect(audio.played.at(-1)?.map((u) => u.sentenceId)).toEqual(['S0002.1', 'S0002.2']);
    // После реплики партнёра — пауза между репликами; ремарки перед ней — без паузы
    expect(audio.opts.slice(-2)).toEqual([undefined, { pauseAfter: true }]);
    await audio.finish();
    expect(runner.getState()).toMatchObject({ index: 2, phase: 'cue' });
    expect(audio.played.at(-1)?.map((u) => u.itemId)).toEqual(['L0003']);
    await audio.finish();
    expect(runner.getState()).toMatchObject({ index: 3, phase: 'prompt' });
    expect(runner.currentLine()?.id).toBe('L0004');
  });

  it('прогон по очереди: «Начать» с места из ссылки и переход по навигации', async () => {
    const { runner, steps } = setup('run');
    runner.start(steps, 'D0003');
    expect(runner.currentLine()?.id).toBe('L0006');
    runner.jumpTo('L0002');
    expect(runner.getState().index).toBe(1);
    runner.jumpTo('L0005');
    expect(runner.currentLine()?.id).toBe('L0006');
  });

  it('конец диапазона удаляет курсор', async () => {
    const { store, runner, steps, next } = setup();
    runner.start(steps, 'L0009');
    next();
    next();
    next();
    await runner.flush();
    expect(runner.getState().phase).toBe('done');
    expect(store.cursors.size).toBe(0);
  });

  it('аудиопрогон: тишина длиной реплика × k, затем следующая', async () => {
    const { audio, runner, steps, index } = setup('audio');
    runner.start(steps);
    await audio.finish();
    await audio.finish();
    const l1 = index.byId.get('L0001')!;
    expect(audio.silences[0]).toBe(Math.round(l1.sentences.length * (1000 + 150) * 1.5));
    await audio.finish();
    expect(runner.getState().index).toBe(1);
  });

  it('аудиопрогон «Вся пьеса»: всё после своей прошлой реплики, стоп на своей до «Продолжить»', async () => {
    const { audio, runner, steps } = setup('audio', { audioRun: 'play', skipScenesWithoutRole: false });
    runner.start(steps, 'L0007');
    expect(audio.played.at(-1)?.map((u) => u.itemId)).toEqual(['L0005']);
    await audio.finish();
    expect(audio.played.at(-1)?.map((u) => u.itemId)).toEqual(['L0006']);
    await audio.finish();
    expect(runner.getState()).toMatchObject({ index: 2, phase: 'prompt', audio: null });
    expect(audio.silences).toEqual([]);
    runner.dispatch({ type: 'proceed', now: 0 });
    expect(runner.currentLine()?.id).toBe('L0009');
  });

  it('аудиопрогон «Вся пьеса»: сцены без роли пропускаются, диапазон не покидается', async () => {
    const skip = setup('audio', { audioRun: 'play' });
    skip.runner.start(skip.steps, 'L0007');
    await skip.audio.finish();
    expect(skip.audio.played.flat().map((u) => u.itemId)).toEqual(['L0006']);

    const act2 = setup('audio', { audioRun: 'play', skipScenesWithoutRole: false }, 'a2');
    act2.runner.start(act2.steps);
    await act2.audio.finish();
    expect(act2.audio.played.flat().map((u) => u.itemId)).toEqual(['L0006']);
  });

  it('смена варианта аудиопрогона начинает текущую реплику заново', async () => {
    const { audio, runner, steps } = setup('audio');
    runner.start(steps, 'L0004');
    const before = audio.played.length;
    runner.restartStep();
    expect(runner.getState()).toMatchObject({ index: 1, phase: 'context' });
    expect(audio.played.length).toBe(before + 1);
  });

  it('пауза, которой нечего продолжать, завершает фрагмент', async () => {
    const { audio, runner, steps } = setup('audio');
    runner.start(steps);
    runner.dispatch({ type: 'togglePause' });
    expect(audio.paused).toBe(true);
    audio.resumable = false;
    runner.dispatch({ type: 'togglePause' });
    expect(runner.getState().phase).toBe('cue');
  });

  it('эхо озвучивает свою реплику после «Открыть»', async () => {
    const { audio, runner, steps } = setup('letters', { echo: true });
    runner.start(steps, 'L0004');
    runner.dispatch({ type: 'reveal' });
    expect(audio.played.at(-1)?.map((u) => u.sentenceId)).toEqual(['S0004.1', 'S0004.2']);
  });

  it('ошибка аудио не останавливает сессию', async () => {
    const { audio, runner, steps, errors } = setup();
    audio.play = () => Promise.reject(new Error('boom'));
    runner.start(steps, 'L0004');
    await tick();
    expect(errors).toHaveLength(2);
    expect(runner.getState().phase).toBe('prompt');
    runner.dispose();
    runner.dispatch({ type: 'next', now: 0 });
    expect(runner.getState().phase).toBe('prompt');
    runner.revive();
  });
});
