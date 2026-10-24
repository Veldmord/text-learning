// FR-10. Прогресс и статистика: пройденные сцены, серия дней, время тренировок, прогоны по сценам.
import { useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import type { SessionRow } from '../../engine/model';
import { MODES, TRAIN_MODES } from '../../engine/modes';
import { passCount, roleProgress, summarize } from '../../engine/progress';
import { parseRoles, roleNames, rolesKey } from '../../engine/queries';
import { useLiveQuery } from '../../app/hooks';
import { repo } from '../../app/services';
import { useApp } from '../../app/store';
import { formatDay, formatDuration, TopBar } from '../../app/ui';

export default function Stats() {
  const params = useParams();
  const index = useApp((s) => s.index)!;
  const roles = useMemo(() => parseRoles(params.roles, index), [params.roles, index]);
  const key = rolesKey(roles);
  const sessions = useLiveQuery(() => repo.sessions(key), [key], [] as SessionRow[]);
  const [now] = useState(() => Date.now());
  const scenes = useMemo(() => roleProgress(index, roles, sessions), [index, roles, sessions]);
  const summary = useMemo(() => summarize(sessions, now), [sessions, now]);
  if (!roles.length) return <Navigate to="/roles" replace />;
  const maxMs = Math.max(1, ...summary.days.map((d) => d.ms));
  const passed = scenes.filter((s) => passCount(s) > 0).length;
  const base = `/r/${roles.join(',')}`;

  return (
    <>
      <TopBar title="Статистика" subtitle={roleNames(index, roles)} back={base} />
      <main className="page">
        <div className="kpis" style={{ marginTop: 16 }}>
          <div className="kpi">
            <strong>
              {passed}/{scenes.length}
            </strong>
            <span>сцен пройдено</span>
          </div>
          <div className="kpi">
            <strong>{summary.streak}</strong>
            <span>дней подряд</span>
          </div>
          <div className="kpi">
            <strong>{formatDuration(summary.totalMs)}</strong>
            <span>время тренировок</span>
          </div>
          <div className="kpi">
            <strong>{summary.totalPasses}</strong>
            <span>прогонов сцен</span>
          </div>
          <div className="kpi">
            <strong>{summary.lines}</strong>
            <span>своих реплик сказано</span>
          </div>
        </div>

        <h2 className="section-title">Последние 14 дней</h2>
        <div className="card">
          <div className="bars" role="img" aria-label={`Минут тренировок по дням: ${summary.days.map((d) => Math.round(d.ms / 60_000)).join(', ')}`}>
            {summary.days.map((d) => (
              <span key={d.day} style={{ height: `${(d.ms / maxMs) * 100}%` }} title={`${d.day}: ${formatDuration(d.ms)}, своих реплик ${d.lines}`} />
            ))}
          </div>
          <div className="bars-labels" aria-hidden="true">
            {summary.days.map((d) => (
              <span key={d.day}>{d.day.slice(8)}</span>
            ))}
          </div>
        </div>

        <h2 className="section-title">По сценам</h2>
        <p className="small muted">Сцена пройдена, когда в одной тренировке встретились все ваши реплики в ней.</p>
        <ul className="scene-list">
          {scenes.map((s) => (
            <li key={s.ref.scene.id} className="scene" style={{ gridTemplateColumns: '1fr' }}>
              <span className="scene__title">
                Д.{s.ref.act.n} · {s.ref.number}. {s.ref.scene.title}
              </span>
              <div className="scene__meta" style={{ gridColumn: 1 }}>
                {passCount(s) > 0 ? (
                  <>
                    {TRAIN_MODES.map((m) => (
                      <span key={m}>
                        {MODES[m].short}: {s.passes[m]}
                      </span>
                    ))}
                    <span>последний — {formatDay(s.lastPassAt!, now)}</span>
                  </>
                ) : (
                  <span>не пройдена · {s.total} ваших реплик</span>
                )}
              </div>
              <div className="scene__actions">
                <Link className="btn btn--small btn--primary" to={`${base}/train/run?scope=${s.ref.scene.id}`}>
                  Прогон
                </Link>
                <Link className="btn btn--small btn--ghost" to={`${base}/read?at=${s.ref.scene.itemIds[0]}`}>
                  Текст
                </Link>
              </div>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
