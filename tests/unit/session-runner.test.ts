import { describe, expect, it } from 'vitest';
import type { SpeechUnit } from '../../src/engine/audio-plan';
import type { CardRow, ReviewRow } from '../../src/engine/model';
import { buildSteps } from '../../src/engine/modes/steps';
import { parseScope } from '../../src/engine/queries';
import { SessionRunner, type AudioPort, type RunnerSettings, type StorePort } from '../../src/engine/session-runner';
import type { LineId } from '../../src/engine/types';
import { miniPlay } from './fixtures';

class FakeAudio implements AudioPort {
  played: SpeechUnit[][] = [];
  silences: number[] = [];
  stops = 0;
  paused = false;
  resumable = true;
  private pending: ((v: boolean) => void) | null = null;
  play(units: SpeechUnit[]) {
    this.played.push(units);
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
  cards = new Map<string, CardRow>();
  reviews = new Map<number, ReviewRow>();
  cursors = new Map<string, string>();
  private nextId = 1;
  async getCard(lineId: LineId) {
    return this.cards.get(lineId);
  }
  async commitReview(review: ReviewRow, card: CardRow) {
    this.cards.set(card.lineId, card);
    const id = this.nextId++;
    this.reviews.set(id, { ...review, id });
    return id;
  }
  async undoReview(id: number) {
    const r = this.reviews.get(id);
    if (!r) return;
    if (r.prevCard) this.cards.set(r.lineId, r.prevCard);
    else this.cards.delete(r.lineId);
    this.reviews.delete(id);
  }
  async saveCursor(key: string, itemId: string | null) {
    if (itemId === null) this.cursors.delete(key);
    else this.cursors.set(key, itemId);
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));

const settings: RunnerSettings = {
  cueLength: 'full',
  cueWords: 10,
  directions: 'text',
  context: 1,
  pauseMs: 0,
  autoAdvance: true,
  echo: false,
  audioRunK: 1.5,
  premiere: null,
};

function setup(mode: 'cue' | 'audio' | 'chunks' | 'letters' = 'cue', over: Partial<RunnerSettings> = {}) {
  const { index } = miniPlay();
  const audio = new FakeAudio();
  const store = new MemoryStore();
  const errors: unknown[] = [];
  let graded = 0;
  let t = 1_000_000;
  const runner = new SessionRunner(
    {
      index,
      roles: ['a'],
      scopeKey: 'all',
      audio,
      store,
      settings: () => ({ ...settings, ...over }),
      clipMs: () => 1000,
      now: () => (t += 1000),
      onGraded: () => graded++,
      onError: (e) => errors.push(e),
    },
    mode,
  );
  const steps = buildSteps({ index, mode, roles: ['a'], scope: parseScope(''), cards: new Map(), now: t });
  return { index, audio, store, runner, steps, errors, graded: () => graded };
}

describe('SessionRunner', () => {
  it('играет подсказку партнёра, сохраняет курсор и оценку', async () => {
    const { audio, store, runner, steps, graded } = setup();
    runner.start(steps);
    await tick();
    expect(audio.played.slice(0, 2)).toEqual([[], []]);
    expect(runner.getState().phase).toBe('prompt');
    runner.dispatch({ type: 'next', now: 0 });
    expect(runner.currentLine()?.id).toBe('L0004');
    await tick();
    expect(runner.getState().phase).toBe('cue');
    expect(audio.played.at(-1)?.map((u) => u.itemId)).toEqual(['L0003']);
    await audio.finish();
    expect(runner.getState().phase).toBe('prompt');
    runner.dispatch({ type: 'reveal' });
    runner.dispatch({ type: 'grade', rating: 'good', now: 0 });
    await runner.flush();
    expect(store.cards.get('L0004')?.reps).toBe(1);
    expect([...store.reviews.values()][0]).toMatchObject({ lineId: 'L0004', mode: 'cue', rating: 'good', fsrs: true, prevCard: null });
    expect(store.cursors.get('a:cue:all')).toBe('L0007');
    expect(graded()).toBe(1);
    expect(runner.getState().graded[1]).toBe(1);
  });

  it('«Назад» отменяет оценку и восстанавливает карточку', async () => {
    const { store, runner, steps } = setup();
    runner.start(steps);
    runner.dispatch({ type: 'reveal' });
    runner.dispatch({ type: 'grade', rating: 'again', now: 0 });
    await runner.flush();
    expect(store.cards.has('L0001')).toBe(true);
    runner.dispatch({ type: 'back', now: 0 });
    await runner.flush();
    expect(store.cards.has('L0001')).toBe(false);
    expect(store.reviews.size).toBe(0);
  });

  it('продолжает с сохранённого места и меняет режим без потери позиции', async () => {
    const { runner, steps, index } = setup();
    runner.start(steps, 'L0007');
    expect(runner.currentLine()?.id).toBe('L0007');
    runner.setMode('letters', buildSteps({ index, mode: 'letters', roles: ['a'], scope: parseScope(''), cards: new Map(), now: 0 }));
    expect(runner.getState()).toMatchObject({ mode: 'letters', index: 2 });
  });

  it('конец диапазона удаляет курсор', async () => {
    const { store, runner, steps } = setup();
    runner.start(steps, 'L0009');
    runner.dispatch({ type: 'next', now: 0 });
    runner.dispatch({ type: 'next', now: 0 });
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

  it('пауза, которой нечего продолжать, завершает фрагмент', async () => {
    const { audio, runner, steps } = setup('audio');
    runner.start(steps);
    runner.dispatch({ type: 'togglePause' });
    expect(audio.paused).toBe(true);
    audio.resumable = false;
    runner.dispatch({ type: 'togglePause' });
    expect(runner.getState().phase).toBe('cue');
  });

  it('эхо и части монолога пишут детали в журнал', async () => {
    const { audio, store, runner, index } = setup('chunks', { echo: true });
    const steps = [
      { kind: 'chunk' as const, lineId: 'L0004' as const, part: 1, parts: 2, sentenceIdx: [0] },
      { kind: 'chunk' as const, lineId: 'L0004' as const, part: 2, parts: 2, sentenceIdx: [0, 1] },
    ];
    runner.start(steps);
    runner.dispatch({ type: 'reveal' });
    expect(audio.played.at(-1)?.map((u) => u.sentenceId)).toEqual(['S0004.1']);
    runner.dispatch({ type: 'grade', rating: 'again', now: 0 });
    runner.dispatch({ type: 'reveal' });
    runner.dispatch({ type: 'grade', rating: 'good', now: 0 });
    await runner.flush();
    expect([...store.reviews.values()].map((r) => r.detail)).toEqual(['часть 1/2', 'часть 1/2, попытка 2']);
    expect(index.byId.get('L0004')).toBeDefined();
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
  });
});
