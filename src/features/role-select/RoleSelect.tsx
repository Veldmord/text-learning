// FR-01. Выбор роли: персонажи с числом реплик и слов, можно выбрать несколько (совмещение, «Санитары»).
// Экран строится из cast.json и не ждёт загрузки текста пьесы — это первый экран при первом визите.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import cast from '../../data/cast.json';
import { useSettings } from '../../app/store';
import { Icon, plural, TopBar } from '../../app/ui';

const speaking = cast.characters.filter((c) => c.speaking).sort((a, b) => b.lines - a.lines);
const groups = [...new Set(speaking.map((c) => c.group).filter((g): g is string => !!g))];

export function RoleSelect() {
  const lastRoles = useSettings((s) => s.lastRoles);
  const update = useSettings((s) => s.update);
  const navigate = useNavigate();
  const [selected, setSelected] = useState<string[]>(() => (lastRoles ?? '').split(',').filter((id) => speaking.some((c) => c.id === id)));

  const toggle = (ids: string[], on: boolean) =>
    setSelected((cur) => (on ? [...new Set([...cur, ...ids])] : cur.filter((id) => !ids.includes(id))));

  const start = () => {
    if (!selected.length) return;
    const roles = speaking.map((c) => c.id).filter((id) => selected.includes(id));
    update({ lastRoles: roles.join(',') });
    navigate(`/r/${roles.join(',')}`);
  };

  const total = speaking.filter((c) => selected.includes(c.id)).reduce((n, c) => n + c.lines, 0);

  return (
    <>
      <TopBar
        title={cast.title}
        subtitle={`${cast.author} · ${cast.subtitle}`}
        actions={
          <Link className="btn btn--icon" to="/settings" aria-label="Настройки">
            <Icon name="gear" />
          </Link>
        }
      />
      <main className="page">
        <h2 className="section-title">Какую роль вы учите?</h2>
        <p className="muted">Можно выбрать несколько ролей, если вы их совмещаете. Выбор запоминается.</p>
        <ul className="role-list">
          {speaking.map((c) => {
            const checked = selected.includes(c.id);
            return (
              <li key={c.id} className={`role-item${checked ? ' role-item--checked' : ''}`}>
                <label>
                  <input type="checkbox" checked={checked} onChange={(e) => toggle([c.id], e.target.checked)} />
                  <span className="role-item__name">{c.name}</span>
                  <span className="role-item__meta">
                    {c.lines} {plural(c.lines, 'реплика', 'реплики', 'реплик')} · {c.words} {plural(c.words, 'слово', 'слова', 'слов')}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        {groups.map((g) => {
          const ids = speaking.filter((c) => c.group === g).map((c) => c.id);
          const all = ids.every((id) => selected.includes(id));
          return (
            <button key={g} type="button" className="btn btn--small" style={{ marginTop: 12 }} onClick={() => toggle(ids, !all)}>
              {all ? `Снять группу «${g}»` : `Выбрать группу «${g}» целиком`}
            </button>
          );
        })}
        <div style={{ marginTop: 24 }}>
          <button className="btn btn--primary btn--block" type="button" disabled={!selected.length} onClick={start}>
            {selected.length ? `Учить: ${total} ${plural(total, 'реплика', 'реплики', 'реплик')}` : 'Выберите роль'}
          </button>
        </div>
        <p className="small muted" style={{ marginTop: 24 }}>
          <Link to="/about">О проекте</Link>
        </p>
      </main>
    </>
  );
}
