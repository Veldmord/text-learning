// FR-02. Обзор роли: карта сцен с выученностью, «Путь роли», диапазон, режимы, продолжение, офлайн.
import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { LONG_LINE_WORDS, MODES, TRAIN_MODES, isModeId, type ModeId } from '../../engine/modes';
import { adviseScene, overallRatio, roleProgress, type Advice, type SceneProgress } from '../../engine/progress';
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
import { isWeak } from '../../engine/srs';
import { useLiveQuery } from '../../app/hooks';
import { repo } from '../../app/services';
import { useApp, useSettings } from '../../app/store';
import { Icon, percent, plural, Progress, TopBar } from '../../app/ui';
import { OfflinePanel } from './OfflinePanel';
import { ScopePicker, scopeKind } from './ScopePicker';

function adviceLabel(a: Advice): string {
  return a.then ? `${MODES[a.mode].title} → ${MODES[a.then].title}` : MODES[a.mode].title;
}

/** Рекомендация для диапазона: слабые — первыми, затем первая невыученная сцена. */
function adviseScope(scenes: SceneProgress[], dueTotal: number): Advice | null {
  if (dueTotal > 0) return { mode: 'weak', reason: `${dueTotal} ${plural(dueTotal, 'реплика ждёт', 'реплики ждут', 'реплик ждут')} повторения` };
  const pending = scenes.map(adviseScene).find((a) => a.mode !== 'audio');
  if (pending) return pending;
  return scenes.length ? { mode: 'audio', reason: 'Всё выучено — прогоняйте на слух' } : null;
}

export function RoleOverview() {
  const params = useParams();
  const [search, setSearch] = useSearchParams();
  const navigate = useNavigate();
  const index = useApp((s) => s.index)!;
  const update = useSettings((s) => s.update);
  const lastRoles = useSettings((s) => s.lastRoles);
  const roles = useMemo(() => parseRoles(params.roles, index), [params.roles, index]);
  const key = rolesKey(roles);
  const scope = useMemo(() => parseScope(search.get('scope')), [search]);

  const cards = useLiveQuery(() => repo.getCards(), [], new Map());
  const readScenes = useLiveQuery(() => repo.readScenes(), [], new Set<string>());
  const cursors = useLiveQuery(() => repo.allCursors(), [], []);

  useEffect(() => {
    if (roles.length && lastRoles !== roles.join(',')) update({ lastRoles: roles.join(',') });
  }, [roles, lastRoles, update]);

  const [now] = useState(() => Date.now());
  const scenes = useMemo(() => roleProgress(index, roles, cards, readScenes, now), [index, roles, cards, readScenes, now]);
  const scopeIds = useMemo(() => scopeItemIds(index, scope), [index, scope]);
  const scopeScenes = scenes.filter((s) => s.ref.scene.itemIds.some((id) => scopeIds.has(id)));
  const linesInScope = useMemo(() => myLinesInScope(index, roles, scope), [index, roles, scope]);
  const weakAll = useMemo(() => myLinesInScope(index, roles, { parts: [], weak: false }).filter((l) => isWeak(cards.get(l.id), now)), [index, roles, cards, now]);
  const dueInScope = linesInScope.filter((l) => isWeak(cards.get(l.id), now)).length;

  if (!roles.length) return <Navigate to="/roles" replace />;

  const stats = roleStats(index, roles);
  const ratio = overallRatio(scenes);
  const advice = adviseScope(scopeScenes, dueInScope);
  const scopeStr = formatScope(scope);
  const trainUrl = (mode: ModeId, s: string = scopeStr) =>
    mode === 'read' ? `/r/${roles.join(',')}/read${s !== 'all' ? `?at=${firstItemOf(s)}` : ''}` : `/r/${roles.join(',')}/train/${mode}?scope=${encodeURIComponent(s)}`;
  function firstItemOf(s: string): string {
    const first = index.play.items.find((it) => scopeItemIds(index, parseScope(s)).has(it.id));
    return first?.id ?? '';
  }
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
    setScope({ parts: ordered.map((id) => ({ kind: 'scene' as const, id })), weak: scope.weak });
  };

  const lastCursor = cursors
    .filter((c) => c.key.startsWith(`${key}:`))
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const resume = lastCursor
    ? (() => {
        const [, mode, sc] = lastCursor.key.split(':');
        const line = getLine(index, lastCursor.itemId);
        return isModeId(mode) && line ? { mode, scope: sc ?? 'all', line } : null;
      })()
    : null;
  const longLines = linesInScope.filter((l) => l.words > LONG_LINE_WORDS).length;
  const sceneMode = scopeKind(scope) === 'scenes';

  return (
    <>
      <TopBar
        title={roleNames(index, roles)}
        subtitle={`${stats.lines} ${plural(stats.lines, 'реплика', 'реплики', 'реплик')} · ${stats.words} ${plural(stats.words, 'слово', 'слова', 'слов')}`}
        actions={
          <>
            <Link className="btn btn--icon" to={`/r/${roles.join(',')}/read`} aria-label="Читка пьесы">
              <Icon name="book" />
            </Link>
            <Link className="btn btn--icon" to={`/r/${roles.join(',')}/stats`} aria-label="Статистика">
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
            <strong>Выучено {percent(ratio)}</strong>
            <Link to="/roles" className="small">
              Сменить роль
            </Link>
          </div>
          <Progress value={ratio} label="Выученность роли" />
          <p className="small muted" style={{ marginBottom: 0 }}>
            Реплика выучена, когда прогноз вспоминания на сегодня не ниже 90 %.
          </p>
        </section>

        {weakAll.length > 0 && (
          <section className="card card--accent">
            <div className="row row--between">
              <div>
                <strong>Слабые места</strong> <span className="chip chip--due">{weakAll.length}</span>
                <p className="small muted" style={{ margin: '4px 0 0' }}>
                  Ежедневное повторение — 5–10 минут
                </p>
              </div>
              <Link className="btn btn--primary" to={trainUrl('weak', 'all')}>
                Повторить
              </Link>
            </div>
          </section>
        )}

        {resume && (
          <section className="card">
            <div className="row row--between">
              <div style={{ minWidth: 0, flex: 1 }}>
                <strong>Продолжить: {MODES[resume.mode].title}</strong>
                <p className="small muted" style={{ margin: '4px 0 0' }}>
                  {scopeLabel(index, parseScope(resume.scope))} · «{lineSpeech(resume.line).slice(0, 60)}…»
                </p>
              </div>
              <Link className="btn" to={trainUrl(resume.mode, resume.scope)}>
                <Icon name="play" /> Продолжить
              </Link>
            </div>
          </section>
        )}

        <h2 className="section-title">Диапазон</h2>
        <ScopePicker index={index} roles={roles} scope={scope} onChange={setScope} />
        <p className="small muted">
          {scopeLabel(index, scope)}: {linesInScope.length} {plural(linesInScope.length, 'реплика', 'реплики', 'реплик')}
          {scope.weak ? '' : `, из них слабых ${dueInScope}`}
        </p>

        <h2 className="section-title">Режим</h2>
        {advice && (
          <p className="small">
            <strong>Путь роли:</strong> {adviceLabel(advice)} — {advice.reason}.
          </p>
        )}
        <div className="grid-modes">
          {(['read', ...TRAIN_MODES] as ModeId[]).map((m) => {
            const def = MODES[m];
            const disabled = m !== 'read' && m !== 'weak' && linesInScope.length === 0;
            const chunksEmpty = m === 'chunks' && longLines === 0;
            const recommended = advice?.mode === m;
            const label = m === 'chunks' ? `${def.description} В диапазоне: ${longLines}.` : def.description;
            if (disabled || chunksEmpty) {
              return (
                <div key={m} className="mode-card" aria-disabled="true" style={{ opacity: 0.5 }}>
                  <span className="mode-card__icon" aria-hidden="true">
                    {def.icon}
                  </span>
                  <strong>{def.title}</strong>
                  <span>{chunksEmpty ? 'В диапазоне нет реплик длиннее 40 слов' : 'В диапазоне нет ваших реплик'}</span>
                </div>
              );
            }
            return (
              <Link key={m} to={trainUrl(m)} className={`mode-card${recommended ? ' mode-card--recommended' : ''}`}>
                <span className="mode-card__icon" aria-hidden="true">
                  {def.icon}
                </span>
                <strong>
                  {def.title}
                  {recommended && <span className="sr-only"> (рекомендуется)</span>}
                </strong>
                <span>{label}</span>
              </Link>
            );
          })}
        </div>

        <h2 className="section-title">Карта сцен</h2>
        <ul className="scene-list">
          {scenes.map((p) => {
            const a = adviseScene(p);
            const sceneId = p.ref.scene.id;
            const checked = scope.parts.some((x) => x.kind === 'scene' && x.id === sceneId);
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
                  <span style={{ flex: '1 1 120px' }}>
                    <Progress value={p.ratio} label={`Выученность сцены «${p.ref.scene.title}»`} />
                  </span>
                  <span>
                    {percent(p.ratio)} · {p.total} {plural(p.total, 'реплика', 'реплики', 'реплик')}
                  </span>
                  {p.due > 0 && <span className="chip chip--due">{p.due} к повторению</span>}
                </div>
                <div className="scene__actions">
                  <button className="btn btn--small btn--primary" type="button" onClick={() => navigate(trainUrl(a.mode, sceneId))} title={a.reason}>
                    {adviceLabel(a)}
                  </button>
                  {a.mode !== 'cue' && (
                    <button className="btn btn--small" type="button" onClick={() => navigate(trainUrl('cue', sceneId))}>
                      По репликам
                    </button>
                  )}
                  {a.mode !== 'read' && (
                    <button className="btn btn--small btn--ghost" type="button" onClick={() => navigate(trainUrl('read', sceneId))}>
                      Читать
                    </button>
                  )}
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
