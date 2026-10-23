import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyGrade, newCard, type ReviewRow } from '../../src/engine/model';
import { getLine } from '../../src/engine/queries';
import type { Line, Play } from '../../src/engine/types';
import { BackupError, backupFileName, exportBackup, importBackup, parseBackup } from '../../src/storage/backup';
import { getDb, setDb, TextLearningDB } from '../../src/storage/db';
import { MIGRATIONS, SCHEMA_VERSION } from '../../src/storage/migrations';
import { reconcileWithPlay } from '../../src/storage/reconcile';
import { ERROR_LOG_LIMIT, Repo } from '../../src/storage/repo';
import { DEFAULT_SETTINGS, loadSettings, sanitizeSettings, saveSettings, SETTINGS_KEY } from '../../src/storage/settings';
import { miniPlay } from './fixtures';

let n = 0;
let db: TextLearningDB;
let repo: Repo;
const T = new Date(2026, 10, 1).getTime();

beforeEach(async () => {
  db = new TextLearningDB(`test-${++n}`);
  await db.open();
  repo = new Repo(db);
});

afterEach(async () => {
  db.close();
  await Dexie.delete(db.name);
});

const { index, play } = miniPlay();
const line = (id: string) => getLine(index, id)!;
const review = (lineId: `L${string}`, ts: number, prevCard: ReviewRow['prevCard'] = null): ReviewRow => ({
  lineId,
  mode: 'cue',
  rating: 'good',
  hinted: false,
  fsrs: true,
  ts,
  durationMs: 1000,
  prevCard,
});

describe('схема и миграции', () => {
  it('создаёт все таблицы текущей версии', async () => {
    expect(db.verno).toBe(SCHEMA_VERSION);
    expect(db.tables.map((t) => t.name).sort()).toEqual(['cards', 'cursors', 'errors', 'meta', 'notes', 'reviews', 'sceneReads']);
    expect(MIGRATIONS.map((m) => m.version)).toEqual([...MIGRATIONS.map((m) => m.version)].sort((a, b) => a - b));
  });

  it('данные версии 1 переживают открытие последней версией', async () => {
    const name = `migrate-${++n}`;
    const v1 = new TextLearningDB(name, 1);
    await v1.open();
    await v1.cards.put(newCard(line('L0001'), T));
    v1.close();
    const latest = new TextLearningDB(name);
    await latest.open();
    expect(await latest.cards.count()).toBe(1);
    latest.close();
    await Dexie.delete(name);
  });

  it('getDb возвращает один экземпляр, setDb подменяет его', () => {
    setDb(db);
    expect(getDb()).toBe(db);
    setDb(null);
    expect(getDb()).not.toBe(db);
    setDb(null);
  });
});

describe('Repo', () => {
  it('атомарно пишет оценку и отменяет её с восстановлением карточки', async () => {
    const first = applyGrade(undefined, { line: line('L0001'), mode: 'cue', affectsFsrs: true, rating: 'good', now: T });
    const id1 = await repo.commitReview(review('L0001', T), first);
    const second = applyGrade(first, { line: line('L0001'), mode: 'cue', affectsFsrs: true, rating: 'again', now: T + 1000 });
    const id2 = await repo.commitReview({ ...review('L0001', T + 1000, first), id: 99 }, second);
    expect(id2).not.toBe(99);
    expect((await repo.getCard('L0001'))?.lapses).toBe(second.lapses);
    await repo.undoReview(id2);
    expect(await repo.getCard('L0001')).toEqual(first);
    await repo.undoReview(id1);
    expect(await repo.getCard('L0001')).toBeUndefined();
    expect(await repo.allReviews()).toEqual([]);
    await repo.undoReview(12345);
  });

  it('курсоры, заметки, прочитанные сцены, мета', async () => {
    await repo.saveCursor('a:cue:all', 'L0004');
    expect((await repo.getCursor('a:cue:all'))?.itemId).toBe('L0004');
    await repo.saveCursor('a:cue:all', null);
    expect(await repo.getCursor('a:cue:all')).toBeUndefined();
    await repo.saveNote('L0001', '  Хочет удержать его  ');
    expect((await repo.getNote('L0001'))?.text).toBe('Хочет удержать его');
    expect((await repo.allNotes()).size).toBe(1);
    await repo.saveNote('L0001', ' ');
    expect(await repo.getNote('L0001')).toBeUndefined();
    await repo.markSceneRead('a1s01');
    expect(await repo.readScenes()).toEqual(new Set(['a1s01']));
    await repo.setMeta('x', { a: 1 });
    expect(await repo.getMeta('x')).toEqual({ a: 1 });
    expect((await repo.allCursors()).length).toBe(0);
  });

  it('журнал ошибок — кольцевой, последние 200', async () => {
    for (let i = 0; i < ERROR_LOG_LIMIT + 5; i++) await repo.logError({ ts: i, source: 'test', message: `e${i}` });
    expect(await db.errors.count()).toBe(ERROR_LOG_LIMIT);
    expect((await repo.recentErrors(1))[0]?.message).toBe(`e${ERROR_LOG_LIMIT + 4}`);
  });

  it('считает оценки после даты и сбрасывает прогресс', async () => {
    await repo.commitReview(review('L0001', T), newCard(line('L0001'), T));
    await repo.commitReview(review('L0004', T + 5), newCard(line('L0004'), T));
    expect(await repo.countReviewsSince(T)).toBe(1);
    expect((await repo.getCards()).size).toBe(2);
    await repo.resetProgress();
    expect(await db.cards.count()).toBe(0);
    expect(await db.reviews.count()).toBe(0);
  });
});

describe('сверка с новой сборкой текста', () => {
  it('сбрасывает только карточки изменённых реплик и помечает заметки', async () => {
    const graded = applyGrade(undefined, { line: line('L0001'), mode: 'cue', affectsFsrs: true, rating: 'good', now: T });
    await db.cards.bulkPut([graded, { ...newCard(line('L0004'), T), vanishLevel: 2 }, { ...newCard(line('L0001'), T), lineId: 'L0999' }]);
    await repo.commitReview(review('L0001', T), graded);
    await repo.saveNote('L0004', 'зачем');
    expect(await reconcileWithPlay(db, play, { now: T })).toMatchObject({ changed: true, resetCards: 1 });
    expect(await reconcileWithPlay(db, play, { now: T })).toMatchObject({ changed: false });

    const edited: Play = {
      ...play,
      sourceHash: 'other',
      items: play.items.map((it) => (it.id === 'L0004' ? ({ ...it, textHash: 'deadbeef' } as Line) : it)),
    };
    const r = await reconcileWithPlay(db, edited, { now: T + 1 });
    expect(r).toEqual({ resetCards: 1, staleNotes: 1, changed: true });
    expect((await repo.getCard('L0004'))?.vanishLevel).toBe(0);
    expect((await repo.getCard('L0001'))?.reps).toBe(1);
    expect((await repo.getNote('L0004'))?.stale).toBe(true);
    expect(await db.reviews.count()).toBe(1);
    expect(await reconcileWithPlay(db, edited, { now: T + 2, force: true })).toMatchObject({ resetCards: 0, staleNotes: 0 });
  });
});

describe('резервная копия', () => {
  it('экспорт → импорт в пустую базу переносит всё', async () => {
    await repo.commitReview(review('L0001', T), applyGrade(undefined, { line: line('L0001'), mode: 'cue', affectsFsrs: true, rating: 'good', now: T }));
    await repo.saveNote('L0001', 'смысл');
    await repo.saveCursor('a:cue:all', 'L0004');
    await repo.markSceneRead('a1s01');
    const settings = { ...DEFAULT_SETTINGS, speed: 1.5, updatedAt: T };
    const backup = await exportBackup(db, { playId: 'mini', playSourceHash: play.sourceHash, settings });
    expect(backup.reviews[0]).not.toHaveProperty('id');

    const other = new TextLearningDB(`import-${++n}`);
    await other.open();
    const parsed = parseBackup(JSON.stringify(backup), 'mini');
    const res = await importBackup(other, parsed, DEFAULT_SETTINGS);
    expect(res).toMatchObject({ cards: 1, reviews: 1, notes: 1, cursors: 1, sceneReads: 1 });
    expect(res.settings?.speed).toBe(1.5);
    const again = await importBackup(other, parsed, settings);
    expect(again).toMatchObject({ cards: 0, reviews: 0, notes: 0, cursors: 0, sceneReads: 0, settings: null });
    other.close();
    await Dexie.delete(other.name);
  });

  it('при слиянии побеждает последнее изменение', async () => {
    const older = { ...newCard(line('L0001'), T), vanishLevel: 1, updatedAt: T };
    const newer = { ...older, vanishLevel: 3, updatedAt: T + 10 };
    await db.cards.put(newer);
    const backup = parseBackup(
      JSON.stringify({ format: 'text-learning-backup', version: 1, playId: 'mini', cards: [older], notes: [{ lineId: 'L0004', text: 'новое', updatedAt: T + 50 }] }),
      'mini',
    );
    const res = await importBackup(db, backup, DEFAULT_SETTINGS);
    expect(res.cards).toBe(0);
    expect((await repo.getCard('L0001'))?.vanishLevel).toBe(3);
    expect((await repo.getNote('L0004'))?.text).toBe('новое');
  });

  it('отклоняет чужие и повреждённые файлы', () => {
    expect(() => parseBackup('не json', 'mini')).toThrow(BackupError);
    expect(() => parseBackup('{"format":"x"}', 'mini')).toThrow(/не файл резервной копии/);
    expect(() => parseBackup('{"format":"text-learning-backup","version":9,"playId":"mini"}', 'mini')).toThrow(/более новой версией/);
    expect(() => parseBackup('{"format":"text-learning-backup","version":1,"playId":"other"}', 'mini')).toThrow(/другой пьесе/);
    const b = parseBackup('{"format":"text-learning-backup","version":1,"playId":"mini","cards":[{"x":1}],"reviews":"bad"}', 'mini');
    expect(b.cards).toEqual([]);
    expect(b.reviews).toEqual([]);
    expect(backupFileName(new Date('2026-11-20T18:30:00Z'))).toBe('text-learning-2026-11-20.json');
  });
});

describe('настройки', () => {
  it('приводят мусор к допустимым значениям', () => {
    const s = sanitizeSettings({ theme: 'neon', speed: 7, fontSize: -3, context: 2.6, cueWords: 1, premiere: '2026-12-01', characterRate: { dama: 9, starik: 'x' }, audioRunK: 1.23, audioRun: 'nope' });
    expect(s).toMatchObject({ theme: 'system', speed: 2, fontSize: 0, context: 3, cueWords: 5, premiere: '2026-12-01', characterRate: { dama: 1.5, starik: 1 }, audioRunK: 1.2, audioRun: 'cue' });
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings({ premiere: '1 декабря' }).premiere).toBeNull();
  });

  it('читаются и пишутся в localStorage, без него — значения по умолчанию', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    saveSettings({ ...DEFAULT_SETTINGS, theme: 'dark' });
    expect(JSON.parse(store.get(SETTINGS_KEY)!).theme).toBe('dark');
    expect(loadSettings().theme).toBe('dark');
    store.set(SETTINGS_KEY, '{oops');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    vi.unstubAllGlobals();
  });
});
