// FR-10. Прогресс и статистика: выученность по сценам и роли, серия дней, время, проблемные реплики.
import { useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import type { CardRow, ReviewRow } from '../../engine/model';
import { overallRatio, roleProgress, summarize } from '../../engine/progress';
import { getLine, lineSpeech, myLinesInScope, parseRoles, roleNames, ALL_SCOPE } from '../../engine/queries';
import { useLiveQuery } from '../../app/hooks';
import { repo } from '../../app/services';
import { useApp } from '../../app/store';
import { formatDuration, percent, Progress, TopBar } from '../../app/ui';

export default function Stats() {
  const params = useParams();
  const index = useApp((s) => s.index)!;
  const roles = useMemo(() => parseRoles(params.roles, index), [params.roles, index]);
  const cards = useLiveQuery(() => repo.getCards(), [], new Map<string, CardRow>());
  const reviews = useLiveQuery(() => repo.allReviews(), [], [] as ReviewRow[]);
  const readScenes = useLiveQuery(() => repo.readScenes(), [], new Set<string>());
  const [now] = useState(() => Date.now());
  const lineIds = useMemo(() => new Set<string>(myLinesInScope(index, roles, ALL_SCOPE).map((l) => l.id)), [index, roles]);
  const scenes = useMemo(() => roleProgress(index, roles, cards, readScenes, now), [index, roles, cards, readScenes, now]);
  const summary = useMemo(() => summarize(reviews, cards, lineIds, now), [reviews, cards, lineIds, now]);
  if (!roles.length) return <Navigate to="/roles" replace />;
  const maxReviews = Math.max(1, ...summary.days.map((d) => d.reviews));
  const base = `/r/${roles.join(',')}`;

  return (
    <>
      <TopBar title="Статистика" subtitle={roleNames(index, roles)} back={base} />
      <main className="page">
        <div className="kpis" style={{ marginTop: 16 }}>
          <div className="kpi">
            <strong>{percent(overallRatio(scenes))}</strong>
            <span>роли выучено</span>
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
            <strong>{summary.totalReviews}</strong>
            <span>оценок всего</span>
          </div>
          <div className="kpi">
            <strong>{percent(summary.knownShare)}</strong>
            <span>«Знал» в режимах вспоминания</span>
          </div>
        </div>

        <h2 className="section-title">Последние 14 дней</h2>
        <div className="card">
          <div className="bars" role="img" aria-label={`Оценок по дням: ${summary.days.map((d) => d.reviews).join(', ')}`}>
            {summary.days.map((d) => (
              <span key={d.day} style={{ height: `${(d.reviews / maxReviews) * 100}%` }} title={`${d.day}: ${d.reviews} оценок, ${formatDuration(d.ms)}`} />
            ))}
          </div>
          <div className="bars-labels" aria-hidden="true">
            {summary.days.map((d) => (
              <span key={d.day}>{d.day.slice(8)}</span>
            ))}
          </div>
        </div>

        <h2 className="section-title">По сценам</h2>
        <ul className="scene-list">
          {scenes.map((s) => (
            <li key={s.ref.scene.id} className="scene" style={{ gridTemplateColumns: '1fr' }}>
              <span className="scene__title">
                Д.{s.ref.act.n} · {s.ref.number}. {s.ref.scene.title}
              </span>
              <div className="scene__meta" style={{ gridColumn: 1 }}>
                <span style={{ flex: '1 1 120px' }}>
                  <Progress value={s.ratio} label={`Выученность сцены «${s.ref.scene.title}»`} />
                </span>
                <span>
                  {s.learned}/{s.total} · «Знал» {percent(s.knownShare)}
                </span>
              </div>
            </li>
          ))}
        </ul>

        <h2 className="section-title">Проблемные реплики</h2>
        {summary.problems.length === 0 ? (
          <p className="muted">Пока нет — оценки «Не знал» и «С ошибкой» появятся здесь.</p>
        ) : (
          <ul className="scene-list">
            {summary.problems.map((p) => {
              const line = getLine(index, p.lineId);
              if (!line) return null;
              return (
                <li key={p.lineId} className="scene" style={{ gridTemplateColumns: '1fr' }}>
                  <span className="play-text">{lineSpeech(line).slice(0, 140)}</span>
                  <div className="scene__meta" style={{ gridColumn: 1 }}>
                    <span>
                      Не знал: {p.again} · С ошибкой: {p.hard} · прогноз {percent(p.retrievability)}
                    </span>
                  </div>
                  <div className="scene__actions">
                    <Link className="btn btn--small btn--primary" to={`${base}/train/cue?scope=${p.lineId}-${p.lineId}`}>
                      Повторить
                    </Link>
                    <Link className="btn btn--small btn--ghost" to={`${base}/read?at=${p.lineId}`}>
                      В тексте
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
