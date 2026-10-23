// Режим «Знакомство» (раздел 5.1): вся пьеса с подсвеченной ролью, все голоса, заметки «зачем я это говорю» (FR-11),
// поиск по тексту с переходом к реплике (FR-16). Сцена считается открытой, когда актёр дочитал её до конца.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import { lineUnits, readThroughUnits, directionUnits } from '../../engine/audio-plan';
import type { NoteRow } from '../../engine/model';
import { parseRoles, roleNames, searchPlay, type PlayIndex, type SceneRef } from '../../engine/queries';
import type { Item, Line } from '../../engine/types';
import { useLiveQuery, useScrollTo } from '../../app/hooks';
import { audioEngine, repo, reportError } from '../../app/services';
import { useApp, usePlayback, useSettings } from '../../app/store';
import { Icon, TopBar } from '../../app/ui';
import { ItemBody } from '../session/LineText';

export default function ReadThrough() {
  const params = useParams();
  const index = useApp((s) => s.index)!;
  const roles = useMemo(() => parseRoles(params.roles, index), [params.roles, index]);
  if (!roles.length) return <Navigate to="/roles" replace />;
  return <Reader index={index} roles={roles} />;
}

function Reader({ index, roles }: { index: PlayIndex; roles: string[] }) {
  const [search, setSearch] = useSearchParams();
  const at = search.get('at');
  const settings = useSettings();
  const notes = useLiveQuery(() => repo.allNotes(), [], new Map<string, NoteRow>());
  const readScenes = useLiveQuery(() => repo.readScenes(), [], new Set<string>());
  const unit = usePlayback((s) => s.unit);
  const [playing, setPlaying] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const hits = useMemo(() => searchPlay(index, query), [index, query]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const atScene = at ? index.sceneOfItem.get(at)?.scene.id : undefined;
  useScrollTo(at, true);

  useEffect(() => () => audioEngine().stop(), []);

  const play = (units: ReturnType<typeof lineUnits>) => {
    const engine = audioEngine();
    engine.unlock();
    setPlaying(true);
    engine
      .play(units)
      .catch((e: unknown) => reportError(e, 'read'))
      .finally(() => setPlaying(false));
  };
  const stop = () => {
    audioEngine().stop();
    setPlaying(false);
  };

  const jump = (id: string) => {
    setSearchOpen(false);
    const scene = index.sceneOfItem.get(id)?.scene.id;
    if (scene) setExpanded((s) => new Set(s).add(scene));
    setSearch({ at: id }, { replace: true });
  };

  return (
    <>
      <TopBar
        title="Знакомство"
        subtitle={roleNames(index, roles)}
        back={`/r/${roles.join(',')}`}
        actions={
          <button className="btn btn--icon" type="button" aria-label="Поиск по тексту" aria-expanded={searchOpen} onClick={() => setSearchOpen((v) => !v)}>
            <Icon name="search" />
          </button>
        }
      />
      <main className="page" style={{ paddingBottom: playing ? 120 : undefined }}>
        {searchOpen && (
          <section className="card" role="search">
            <label className="field__label" htmlFor="search">
              Поиск по тексту пьесы
            </label>
            <input id="search" className="input" type="search" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Например: Моцарт" />
            {query.trim().length >= 2 && (
              <div aria-live="polite" className="small muted" style={{ margin: '8px 0' }}>
                Найдено: {hits.length}
                {hits.length === 50 ? '+' : ''}
              </div>
            )}
            <div>
              {hits.map((h) => (
                <button key={h.item.id} type="button" className="search-hit" onClick={() => jump(h.item.id)}>
                  <span className="small muted">
                    {h.item.kind === 'line' ? (index.characters.get(h.item.speakerId)?.name ?? '') : 'Ремарка'} · {index.sceneOfItem.get(h.item.id)?.scene.title}
                  </span>
                  <br />
                  {h.before}
                  <mark>{h.match}</mark>
                  {h.after}
                </button>
              ))}
            </div>
          </section>
        )}

        <div className="field">
          <label className="field__label" htmlFor="scene-jump">
            Перейти к сцене
          </label>
          <select id="scene-jump" className="input" value="" onChange={(e) => e.target.value && jump(e.target.value)}>
            <option value="">Выберите сцену…</option>
            {index.scenes.map((ref) => (
              <option key={ref.scene.id} value={ref.scene.itemIds[0]}>
                Д.{ref.act.n} · {ref.number}. {ref.scene.title}
                {ref.scene.characterIds.some((c) => roles.includes(c)) ? '' : ' (без вашей роли)'}
              </option>
            ))}
          </select>
        </div>

        <p className="small muted">
          Ваши реплики подсвечены. Нажмите «Заметка», чтобы записать, зачем персонаж это говорит: цель, действие, смысл. Сцена отмечается прочитанной, когда вы дочитаете её до
          конца.
        </p>

        {index.play.acts.map((act) => (
          <section key={act.n} aria-labelledby={`act-${act.n}`}>
            <h2 id={`act-${act.n}`} className="section-title">
              {act.title}
            </h2>
            {act.scenes.map((scene) => {
              const ref = index.sceneById.get(scene.id)!;
              const mine = scene.characterIds.some((c) => roles.includes(c));
              const collapsed = settings.skipScenesWithoutRole && !mine && !expanded.has(scene.id) && atScene !== scene.id;
              return (
                <SceneBlock
                  key={scene.id}
                  index={index}
                  sceneRef={ref}
                  roles={roles}
                  collapsed={collapsed}
                  onExpand={() => setExpanded((s) => new Set(s).add(scene.id))}
                  read={readScenes.has(scene.id)}
                  notes={notes}
                  speakingId={unit?.itemId}
                  onPlayScene={(fromId) => play(readThroughUnits(index, fromId, settings))}
                  onPlayItem={(item) => play(item.kind === 'line' ? lineUnits(item) : directionUnits(item))}
                />
              );
            })}
          </section>
        ))}
      </main>
      {playing && (
        <nav className="actionbar" aria-label="Воспроизведение">
          <div className="actionbar__inner">
            <div className="row row--between">
              <span className="small">
                <Icon name="speaker" /> {unit ? (unit.speakerId === 'narrator' ? 'Ремарка' : index.characters.get(unit.speakerId)?.name) : 'Озвучка'}
              </span>
              <button className="btn" type="button" onClick={stop}>
                Стоп
              </button>
            </div>
          </div>
        </nav>
      )}
    </>
  );
}

function SceneBlock({
  index,
  sceneRef,
  roles,
  collapsed,
  onExpand,
  read,
  notes,
  speakingId,
  onPlayScene,
  onPlayItem,
}: {
  index: PlayIndex;
  sceneRef: SceneRef;
  roles: string[];
  collapsed: boolean;
  onExpand: () => void;
  read: boolean;
  notes: Map<string, NoteRow>;
  speakingId: string | undefined;
  onPlayScene: (fromId: string) => void;
  onPlayItem: (item: Item) => void;
}) {
  const settings = useSettings();
  const { scene } = sceneRef;
  const mine = scene.characterIds.some((c) => roles.includes(c));
  const endRef = useRef<HTMLDivElement>(null);

  // Дочитал до конца — сцена открыта для «Пути роли»
  useEffect(() => {
    const el = endRef.current;
    if (!el || read || !mine || collapsed || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        void repo.markSceneRead(scene.id);
        obs.disconnect();
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [read, mine, collapsed, scene.id]);

  return (
    <section aria-labelledby={`scene-${scene.id}`} style={{ marginBottom: 24 }}>
      <div className="row row--between" style={{ position: 'sticky', top: 56, background: 'var(--bg)', zIndex: 5, padding: '6px 0' }}>
        <h3 id={`scene-${scene.id}`} style={{ margin: 0, fontSize: '1rem' }}>
          {sceneRef.number}. {scene.title} {read && <span className="chip">прочитано</span>}
        </h3>
        {!collapsed && (
          <button className="btn btn--small" type="button" onClick={() => onPlayScene(scene.itemIds[0]!)}>
            <Icon name="play" /> Слушать
          </button>
        )}
      </div>
      {collapsed ? (
        <button className="btn btn--ghost btn--small" type="button" onClick={onExpand}>
          Сцена без вашей роли — развернуть ({scene.itemIds.length})
        </button>
      ) : (
        <>
          {scene.itemIds.map((id) => {
            const item = index.byId.get(id)!;
            if (item.kind === 'direction' && settings.directions === 'skip') return null;
            return (
              <ReadItem
                key={id}
                item={item}
                index={index}
                mine={item.kind === 'line' && roles.includes(item.speakerId)}
                note={notes.get(id)}
                speaking={speakingId === id}
                showAsides={settings.directions !== 'skip'}
                onPlay={() => onPlayItem(item)}
                onPlayFrom={() => onPlayScene(id)}
              />
            );
          })}
          <div ref={endRef} className="row" style={{ justifyContent: 'center', padding: 8 }}>
            {mine && !read && (
              <button className="btn btn--small btn--ghost" type="button" onClick={() => void repo.markSceneRead(scene.id)}>
                <Icon name="check" /> Сцена прочитана
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function ReadItem({
  item,
  index,
  mine,
  note,
  speaking,
  showAsides,
  onPlay,
  onPlayFrom,
}: {
  item: Item;
  index: PlayIndex;
  mine: boolean;
  note: NoteRow | undefined;
  speaking: boolean;
  showAsides: boolean;
  onPlay: () => void;
  onPlayFrom: () => void;
}) {
  const [editing, setEditing] = useState(false);
  if (item.kind === 'direction') {
    return (
      <div id={item.id} className={`item item--direction${speaking ? ' item--speaking' : ''}`}>
        <ItemBody item={item} showAsides />
      </div>
    );
  }
  const line: Line = item;
  return (
    <div id={line.id} className={`item${mine ? ' item--mine' : ''}${speaking ? ' item--speaking' : ''}`}>
      <div className="item__head">
        <span style={{ flex: 1 }}>
          {index.characters.get(line.speakerId)?.name}
          {mine && ' · вы'}
        </span>
        <button className="btn btn--icon" type="button" onClick={onPlay} aria-label="Озвучить реплику">
          <Icon name="speaker" />
        </button>
        <button className="btn btn--icon" type="button" onClick={onPlayFrom} aria-label="Слушать сцену с этой реплики">
          <Icon name="play" />
        </button>
      </div>
      <div className="play-text">
        <ItemBody item={line} showAsides={showAsides} />
      </div>
      {mine && (
        <div style={{ marginTop: 6 }}>
          {editing ? (
            <NoteEditor lineId={line.id} note={note} onDone={() => setEditing(false)} />
          ) : (
            <>
              {note && (
                <p className="small" style={{ margin: '4px 0' }}>
                  <strong>Зачем:</strong> {note.text} {note.stale && <span className="chip">текст изменился</span>}
                </p>
              )}
              <button className="btn btn--ghost btn--small" type="button" onClick={() => setEditing(true)}>
                {note ? 'Изменить заметку' : 'Заметка'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function NoteEditor({ lineId, note, onDone }: { lineId: Line['id']; note: NoteRow | undefined; onDone: () => void }) {
  const [text, setText] = useState(note?.text ?? '');
  const id = `note-${lineId}`;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void repo.saveNote(lineId, text).then(onDone);
      }}
    >
      <label className="field__label small" htmlFor={id}>
        Зачем я это говорю? Цель, действие, смысл
      </label>
      <textarea id={id} className="input" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
      <div className="row" style={{ marginTop: 6 }}>
        <button className="btn btn--primary btn--small" type="submit">
          Сохранить
        </button>
        <button className="btn btn--ghost btn--small" type="button" onClick={onDone}>
          Отмена
        </button>
      </div>
    </form>
  );
}
