import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionRow } from '../../src/engine/model';
import type { Play } from '../../src/engine/types';
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

const { play } = miniPlay();
const session = (over: Partial<SessionRow> = {}): SessionRow => ({
  id: 'x1',
  rolesKey: 'a',
  mode: 'run',
  startedAt: T,
  updatedAt: T,
  activeMs: 1000,
  lines: 1,
  scenes: ['a1s01'],
  ...over,
});

describe('схема и миграции', () => {
  it('создаёт все таблицы текущей версии', async () => {
    expect(db.verno).toBe(SCHEMA_VERSION);
    expect(db.tables.map((t) => t.name).sort()).toEqual(['cards', 'cursors', 'errors', 'favorites', 'meta', 'notes', 'reviews', 'sceneReads', 'sessions']);
    expect(MIGRATIONS.map((m) => m.version)).toEqual([...MIGRATIONS.map((m) => m.version)].sort((a, b) => a - b));
  });

  it('данные версии 1 переживают открытие последней версией', async () => {
    const name = `migrate-${++n}`;
    const v1 = new TextLearningDB(name, 1);
    await v1.open();
    await v1.cards.put({ lineId: 'L0001', due: T, updatedAt: T });
    await v1.notes.put({ lineId: 'L0001', text: 'смысл', updatedAt: T });
    await v1.cursors.put({ key: 'a:cue:all', itemId: 'L0004', updatedAt: T });
    v1.close();
    const latest = new TextLearningDB(name);
    await latest.open();
    expect(await latest.cards.count()).toBe(1);
    expect((await latest.notes.get('L0001'))?.text).toBe('смысл');
    expect((await latest.cursors.get('a:cue:all'))?.itemId).toBe('L0004');
    expect(await latest.sessions.count()).toBe(0);
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
  it('журнал сессий: по связке ролей и по порядку начала', async () => {
    await repo.saveSession(session({ id: 'b', startedAt: T + 10, updatedAt: T + 10 }));
    await repo.saveSession(session({ id: 'a', startedAt: T }));
    await repo.saveSession(session({ id: 'c', rolesKey: 'b', updatedAt: T + 20 }));
    await repo.saveSession(session({ id: 'a', startedAt: T, activeMs: 5000 }));
    expect((await repo.sessions('a')).map((s) => [s.id, s.activeMs])).toEqual([
      ['a', 5000],
      ['b', 1000],
    ]);
    expect(await repo.sessions()).toHaveLength(3);
    expect(await repo.countSessionsSince(T)).toBe(2);
  });

  it('избранное: снятие хранится, чтобы пережить слияние копий', async () => {
    await repo.setFavorite('L0001', true);
    await repo.setFavorite('L0004', true);
    expect(await repo.favorites()).toEqual(new Set(['L0001', 'L0004']));
    await repo.setFavorite('L0001', false);
    expect(await repo.favorites()).toEqual(new Set(['L0004']));
    expect((await db.favorites.get('L0001'))?.on).toBe(false);
  });

  it('курсоры и мета', async () => {
    await repo.saveCursor('a:run:all', 'L0004');
    expect((await repo.getCursor('a:run:all'))?.itemId).toBe('L0004');
    expect(await repo.allCursors()).toHaveLength(1);
    await repo.saveCursor('a:run:all', null);
    expect(await repo.getCursor('a:run:all')).toBeUndefined();
    await repo.setMeta('x', { a: 1 });
    expect(await repo.getMeta('x')).toEqual({ a: 1 });
  });

  it('журнал ошибок — кольцевой, последние 200', async () => {
    for (let i = 0; i < ERROR_LOG_LIMIT + 5; i++) await repo.logError({ ts: i, source: 'test', message: `e${i}` });
    expect(await db.errors.count()).toBe(ERROR_LOG_LIMIT);
    expect((await repo.recentErrors(1))[0]?.message).toBe(`e${ERROR_LOG_LIMIT + 4}`);
  });

  it('сброс прогресса: журнал, позиции и данные прежних версий; избранное и заметки остаются', async () => {
    await repo.saveSession(session());
    await repo.saveCursor('a:run:all', 'L0004');
    await repo.setFavorite('L0004', true);
    await db.cards.put({ lineId: 'L0001' });
    await db.reviews.add({ lineId: 'L0001', ts: T });
    await db.notes.put({ lineId: 'L0001', text: 'смысл' });
    await repo.resetProgress();
    expect(await db.sessions.count()).toBe(0);
    expect(await db.cursors.count()).toBe(0);
    expect(await db.cards.count()).toBe(0);
    expect(await db.reviews.count()).toBe(0);
    expect(await repo.favorites()).toEqual(new Set(['L0004']));
    expect(await db.notes.count()).toBe(1);
  });
});

describe('сверка с новой сборкой текста', () => {
  it('удаляет избранное и позиции на реплики, которых больше нет', async () => {
    await repo.setFavorite('L0004', true);
    await repo.setFavorite('L0999', true);
    await repo.saveCursor('a:run:all', 'L0004');
    await repo.saveCursor('a:run:a1', 'L0998');
    expect(await reconcileWithPlay(db, play)).toEqual({ removedFavorites: 1, removedCursors: 1, changed: true });
    expect(await repo.favorites()).toEqual(new Set(['L0004']));
    expect(await repo.allCursors()).toHaveLength(1);
    expect(await reconcileWithPlay(db, play)).toMatchObject({ changed: false });

    await repo.setFavorite('L0997', true);
    const edited: Play = { ...play, sourceHash: 'other' };
    expect(await reconcileWithPlay(db, edited)).toMatchObject({ removedFavorites: 1, changed: true });
    expect(await reconcileWithPlay(db, edited, { force: true })).toMatchObject({ removedFavorites: 0, removedCursors: 0, changed: true });
  });
});

describe('резервная копия', () => {
  it('экспорт → импорт в пустую базу переносит журнал, избранное и позиции', async () => {
    await repo.saveSession(session());
    await repo.setFavorite('L0001', true);
    await repo.setFavorite('L0004', false);
    await repo.saveCursor('a:run:all', 'L0004');
    const settings = { ...DEFAULT_SETTINGS, speed: 1.5, updatedAt: T };
    const backup = await exportBackup(db, { playId: 'mini', playSourceHash: play.sourceHash, settings });
    expect(backup).toMatchObject({ version: 2, sessions: [session()] });
    expect(backup.favorites).toHaveLength(2);

    const other = new TextLearningDB(`import-${++n}`);
    await other.open();
    const parsed = parseBackup(JSON.stringify(backup), 'mini');
    const res = await importBackup(other, parsed, DEFAULT_SETTINGS);
    expect(res).toMatchObject({ sessions: 1, favorites: 2, cursors: 1, legacy: false });
    expect(res.settings?.speed).toBe(1.5);
    expect(await new Repo(other).favorites()).toEqual(new Set(['L0001']));
    const again = await importBackup(other, parsed, settings);
    expect(again).toMatchObject({ sessions: 0, favorites: 0, cursors: 0, settings: null });
    other.close();
    await Dexie.delete(other.name);
  });

  it('при слиянии побеждает последнее изменение, снятие из избранного переносится', async () => {
    await repo.saveSession(session({ activeMs: 9000, updatedAt: T + 10 }));
    await db.favorites.put({ lineId: 'L0001', on: true, updatedAt: T });
    await db.favorites.put({ lineId: 'L0004', on: true, updatedAt: T + 100 });
    const backup = parseBackup(
      JSON.stringify({
        format: 'text-learning-backup',
        version: 2,
        playId: 'mini',
        sessions: [session({ activeMs: 1000, updatedAt: T }), session({ id: 'x2' })],
        favorites: [
          { lineId: 'L0001', on: false, updatedAt: T + 50 },
          { lineId: 'L0004', on: false, updatedAt: T + 50 },
        ],
      }),
      'mini',
    );
    const res = await importBackup(db, backup, DEFAULT_SETTINGS);
    expect(res).toMatchObject({ sessions: 1, favorites: 1 });
    expect((await db.sessions.get('x1'))?.activeMs).toBe(9000);
    expect(await repo.favorites()).toEqual(new Set(['L0004']));
  });

  it('копия прежней версии: переносятся позиции, оценки и заметки пропускаются', async () => {
    const backup = parseBackup(
      JSON.stringify({
        format: 'text-learning-backup',
        version: 1,
        playId: 'mini',
        cards: [{ lineId: 'L0001', updatedAt: T }],
        reviews: [{ lineId: 'L0001', ts: T }],
        notes: [{ lineId: 'L0001', text: 'смысл', updatedAt: T }],
        cursors: [{ key: 'a:letters:all', itemId: 'L0004', updatedAt: T }],
      }),
      'mini',
    );
    expect(await importBackup(db, backup, DEFAULT_SETTINGS)).toMatchObject({ sessions: 0, favorites: 0, cursors: 1, legacy: true });
    expect(await db.cards.count()).toBe(0);
    expect(await db.notes.count()).toBe(0);
  });

  it('отклоняет чужие и повреждённые файлы и записи', () => {
    expect(() => parseBackup('не json', 'mini')).toThrow(BackupError);
    expect(() => parseBackup('{"format":"x"}', 'mini')).toThrow(/не файл резервной копии/);
    expect(() => parseBackup('{"format":"text-learning-backup","version":9,"playId":"mini"}', 'mini')).toThrow(/более новой версией/);
    expect(() => parseBackup('{"format":"text-learning-backup","version":2,"playId":"other"}', 'mini')).toThrow(/другой пьесе/);
    const b = parseBackup(
      JSON.stringify({
        format: 'text-learning-backup',
        version: 2,
        playId: 'mini',
        sessions: [session({ mode: 'cue' as SessionRow['mode'] }), { id: 'y' }, session({ scenes: [1] as unknown as string[] }), session({ id: 'ok' })],
        favorites: [{ lineId: 'L0001' }, { lineId: 'L0004', on: true, updatedAt: T }],
        cursors: 'bad',
      }),
      'mini',
    );
    expect(b.sessions.map((s) => s.id)).toEqual(['ok']);
    expect(b.favorites.map((f) => f.lineId)).toEqual(['L0004']);
    expect(b.cursors).toEqual([]);
    expect(backupFileName(new Date('2026-11-20T18:30:00Z'))).toBe('text-learning-2026-11-20.json');
  });
});

describe('настройки', () => {
  it('приводят мусор к допустимым значениям и отбрасывают поля прежних версий', () => {
    const s = sanitizeSettings({ theme: 'neon', speed: 7, fontSize: -3, context: 2.6, cueWords: 1, premiere: '2026-12-01', characterRate: { dama: 9, starik: 'x' }, audioRunK: 1.23, audioRun: 'nope', runFlow: 'nope' });
    expect(s).toMatchObject({ theme: 'system', speed: 2, fontSize: 0, context: 3, cueWords: 5, characterRate: { dama: 1.5, starik: 1 }, audioRunK: 1.2, audioRun: 'cue', runFlow: 'all' });
    expect(s).not.toHaveProperty('premiere');
    expect(sanitizeSettings({ runFlow: 'mine' }).runFlow).toBe('mine');
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
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
