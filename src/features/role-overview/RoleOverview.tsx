// FR-02. Обзор роли: пройденные сцены, главные кнопки «Открыть текст» и «Прогон с буквами», продолжение, диапазон, карта сцен, офлайн.
import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { SessionRow } from '../../engine/model';
import { isModeId, MODES, RUN_FLOWS, type ModeId } from '../../engine/modes';
import { passCount, passedShare, roleProgress, summarize } from '../../engine/progress';
import {
  formatScope,
  getLine,
  lineSpeech,
  myLinesInScope,
  parseRoles,
  parseScope,
  roleNames,
  roleStats,
  rolesKey,
  scopeItemIds,
  scopeLabel,
  type Scope,
} from '../../engine/queries';
import { useLiveQuery } from '../../app/hooks';
import { repo } from '../../app/services';
import { useApp, useSettings } from '../../app/store';
import { formatDay, formatDuration, Icon, plural, preview, Progress, TopBar } from '../../app/ui';
import { OfflinePanel } from './OfflinePanel';
import { ScopePicker, scopeKind } from './ScopePicker';

export function RoleOverview() {
  const params = useParams();
  const [search, setSearch] = useSearchParams();
  const navigate = useNavigate();
  const index = useApp((s) => s.index)!;
  const update = useSettings((s) => s.update);
  const lastRoles = useSettings((s) => s.lastRoles);
  const runFlow = useSettings((s) => s.runFlow);
  const roles = useMemo(() => parseRoles(params.roles, index), [params.roles, index]);
  const key = rolesKey(roles);
  const scope = useMemo(() => parseScope(search.get('scope')), [search]);

  const sessions = useLiveQuery(() => repo.sessions(key), [key], [] as SessionRow[]);
  const favorites = useLiveQuery(() => repo.favorites(), [], new Set<string>());
  const cursors = useLiveQuery(() => repo.allCursors(), [], []);

  useEffect(() => {
    if (roles.length && lastRoles !== roles.join(',')) update({ lastRoles: roles.join(',') });
  }, [roles, lastRoles, update]);

  const [now] = useState(() => Date.now());
  const scenes = useMemo(() => roleProgress(index, roles, sessions), [index, roles, sessions]);
  const week = useMemo(() => summarize(sessions, now, 7), [sessions, now]);
  const linesInScope = useMemo(() => myLinesInScope(index, roles, scope), [index, roles, scope]);

  if (!roles.length) return <Navigate to="/roles" replace />;

  const base = `/r/${roles.join(',')}`;
  const stats = roleStats(index, roles);
  const passed = scenes.filter((s) => passCount(s) > 0).length;
  const scopeStr = formatScope(scope);
  const trainUrl = (mode: ModeId, s: string = scopeStr) => `${base}/train/${mode}?scope=${encodeURIComponent(s)}`;
  const firstItemOf = (s: string) => {
    const ids = scopeItemIds(index, parseScope(s));
    return index.play.items.find((it) => ids.has(it.id))?.id;
  };
  const textUrl = (s: string = scopeStr) => {
    const first = s === 'all' ? undefined : firstItemOf(s);
    return `${base}/read${first ? `?at=${first}` : ''}`;
  };
  const setScope = (s: Scope) => {
    const next = new URLSearchParams(search);
    const str = formatScope(s);
    if (str === 'all') next.delete('scope');
    else next.set('scope', str);
    setSearch(next, { replace: true });
  };

  const toggleScene = (sceneId: string, on: boolean) => {
    const ids = scope.parts.filter((p) => p.kind === 'scene').map((p) => (p.kind === 'scene' ? p.id : ''));
    const nextIds = on ? [...new Set([...ids, sceneId])] : ids.filter((id) => id !== sceneId);
    const ordered = index.scenes.map((r) => r.scene.id).filter((id) => nextIds.includes(id));
    setScope({ parts: ordered.map((id) => ({ kind: 'scene' as const, id })) });
  };

  const lastCursor = cursors
    .filter((c) => c.key.startsWith(`${key}:`))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .find((c) => isModeId(c.key.split(':')[1]));
  const resume = lastCursor
    ? (() => {
        const [, mode, sc] = lastCursor.key.split(':');
        const line = getLine(index, lastCursor.itemId);
        return isModeId(mode) && line ? { mode, scope: sc ?? 'all', line } : null;
      })()
    : null;
  const favCount = index.lines.filter((l) => favorites.has(l.id)).length;
  const empty = linesInScope.length === 0;
  const sceneMode = scopeKind(scope) === 'scenes';

  return (
    <>
      <TopBar
        title={roleNames(index, roles)}
        subtitle={`${stats.lines} ${plural(stats.lines, 'реплика', 'реплики', 'реплик')} · ${stats.words} ${plural(stats.words, 'слово', 'слова', 'слов')}`}
        actions={
          <>
            <Link className="btn btn--icon" to={`${base}/stats`} aria-label="Статистика">
              <Icon name="chart" />
            </Link>
            <Link className="btn btn--icon" to="/settings" aria-label="Настройки">
              <Icon name="gear" />
            </Link>
          </>
        }
      />
      <main className="page">
        <section className="card">
          <div className="row row--between">
            <strong>
              Пройдено сцен: {passed} из {scenes.length}
            </strong>
            <Link to="/roles" className="small">
              Сменить роль
            </Link>
          </div>
          <Progress value={passedShare(scenes)} label="Пройдено сцен" />
          <p className="small muted" style={{ marginBottom: 0 }}>
            За 7 дней: {formatDuration(week.totalMs)}
            {week.streak > 0 && ` · ${week.streak} ${plural(week.streak, 'день', 'дня', 'дней')} подряд`}. Сцена пройдена, когда в одной тренировке встретились все ваши
            реплики в ней.
          </p>
        </section>

        {resume && (
          <section className="card">
            <div className="row row--between">
              <div style={{ minWidth: 0, flex: 1 }}>
                <strong>Продолжить: {MODES[resume.mode].title}</strong>
                <p className="small muted" style={{ margin: '4px 0 0' }}>
                  {scopeLabel(index, parseScope(resume.scope))} · «{preview(lineSpeech(resume.line))}»
                </p>
              </div>
              <Link className="btn" to={trainUrl(resume.mode, resume.scope)}>
                <Icon name="play" /> Продолжить
              </Link>
            </div>
          </section>
        )}

        <div className="main-actions">
          <Link className="main-action" to={textUrl()}>
            <span className="main-action__icon" aria-hidden="true">
              📖
            </span>
            <strong>Открыть текст</strong>
            <span>Вся пьеса, подсвечена ваша роль</span>
          </Link>
          {empty ? (
            <div className="main-action main-action--primary" aria-disabled="true">
              <span className="main-action__icon" aria-hidden="true">
                {MODES.run.icon}
              </span>
              <strong>{MODES.run.title}</strong>
              <span>В диапазоне нет ваших реплик</span>
            </div>
          ) : (
            <Link className="main-action main-action--primary" to={trainUrl('run')}>
              <span className="main-action__icon" aria-hidden="true">
                {MODES.run.icon}
              </span>
              <strong>{MODES.run.title}</strong>
              <span>{RUN_FLOWS[runFlow].label}</span>
            </Link>
          )}
        </div>
        <div className="grid-modes">
          {(['letters', 'audio'] as const).map((m) =>
            empty ? (
              <div key={m} className="mode-card" aria-disabled="true">
                <span className="mode-card__icon" aria-hidden="true">
                  {MODES[m].icon}
                </span>
                <strong>{MODES[m].title}</strong>
                <span>В диапазоне нет ваших реплик</span>
              </div>
            ) : (
              <Link key={m} to={trainUrl(m)} className="mode-card">
                <span className="mode-card__icon" aria-hidden="true">
                  {MODES[m].icon}
                </span>
                <strong>{MODES[m].title}</strong>
                <span>{MODES[m].when}</span>
              </Link>
            ),
          )}
          <Link to={`${base}/read?fav=1`} className="mode-card">
            <span className="mode-card__icon" aria-hidden="true">
              <Icon name="star" />
            </span>
            <strong>Избранное · {favCount}</strong>
            <span>{favCount ? 'Отмеченные реплики' : 'Отмечайте реплики в тексте'}</span>
          </Link>
        </div>

        <h2 className="section-title">Диапазон</h2>
        <ScopePicker index={index} roles={roles} scope={scope} onChange={setScope} />
        <p className="small muted">
          {scopeLabel(index, scope)}: {linesInScope.length} {plural(linesInScope.length, 'реплика', 'реплики', 'реплик')}
        </p>

        <h2 className="section-title">Карта сцен</h2>
        <ul className="scene-list">
          {scenes.map((p) => {
            const sceneId = p.ref.scene.id;
            const checked = scope.parts.some((x) => x.kind === 'scene' && x.id === sceneId);
            const count = passCount(p);
            return (
              <li key={sceneId} className="scene">
                {sceneMode ? (
                  <input type="checkbox" checked={checked} onChange={(e) => toggleScene(sceneId, e.target.checked)} aria-label={`Выбрать сцену «${p.ref.scene.title}»`} />
                ) : (
                  <span className="chip" aria-hidden="true">
                    {p.ref.act.n}.{p.ref.number}
                  </span>
                )}
                <span className="scene__title">
                  {sceneMode && `${p.ref.act.n}.${p.ref.number} `}
                  {p.ref.scene.title}
                </span>
                <div className="scene__meta">
                  <span>
                    {p.total} {plural(p.total, 'реплика', 'реплики', 'реплик')}
                  </span>
                  {count > 0 ? (
                    <span className="chip chip--done">
                      <Icon name="check" /> {count} {plural(count, 'прогон', 'прогона', 'прогонов')} · {formatDay(p.lastPassAt!, now)}
                    </span>
                  ) : (
                    <span>не пройдена</span>
                  )}
                </div>
                <div className="scene__actions">
                  <button className="btn btn--small btn--primary" type="button" onClick={() => navigate(trainUrl('run', sceneId))}>
                    Прогон
                  </button>
                  <button className="btn btn--small btn--ghost" type="button" onClick={() => navigate(textUrl(sceneId))}>
                    Текст
                  </button>
                </div>
              </li>
            );
          })}
        </ul>

        <OfflinePanel roles={roles} />
      </main>
    </>
  );
}
