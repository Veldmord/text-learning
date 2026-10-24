// Экран «Текст» (раздел 5.1): вся пьеса, подсвечена своя роль; поиск (FR-16), избранное (FR-11) и «Прогон отсюда».
import { useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { parseRoles, roleNames, sceneRefLabel, searchPlay, speakerName, type PlayIndex, type SceneRef } from '../../engine/queries';
import type { Item, Line } from '../../engine/types';
import { useLiveQuery, useScrollTo } from '../../app/hooks';
import { repo } from '../../app/services';
import { useApp, useSettings } from '../../app/store';
import { Icon, TopBar } from '../../app/ui';
import { ItemBody } from '../session/LineText';

export default function TextScreen() {
  const params = useParams();
  const index = useApp((s) => s.index)!;
  const roles = useMemo(() => parseRoles(params.roles, index), [params.roles, index]);
  if (!roles.length) return <Navigate to="/roles" replace />;
  return <PlayText index={index} roles={roles} />;
}

interface LineActions {
  selected: string | null;
  onSelect: (id: string | null) => void;
  favorites: ReadonlySet<string>;
  onFavorite: (id: Line['id'], on: boolean) => void;
  onRunFrom: (id: string) => void;
}

function PlayText({ index, roles }: { index: PlayIndex; roles: string[] }) {
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const at = search.get('at');
  const favOnly = search.get('fav') === '1';
  const directions = useSettings((s) => s.directions);
  const skipScenesWithoutRole = useSettings((s) => s.skipScenesWithoutRole);
  const favorites = useLiveQuery(() => repo.favorites(), [], new Set<string>());
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const hits = useMemo(() => searchPlay(index, query), [index, query]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(at);
  const base = `/r/${roles.join(',')}`;

  const atScene = at ? index.sceneOfItem.get(at)?.scene.id : undefined;
  useScrollTo(favOnly ? null : at, true);

  const jump = (id: string) => {
    setSearchOpen(false);
    const scene = index.sceneOfItem.get(id)?.scene.id;
    if (scene) setExpanded((s) => new Set(s).add(scene));
    setSelected(id);
    setSearch({ at: id }, { replace: true });
  };

  const actions: LineActions = {
    selected,
    onSelect: setSelected,
    favorites,
    onFavorite: (id, on) => void repo.setFavorite(id, on),
    onRunFrom: (id) => navigate(`${base}/train/run?at=${id}`),
  };

  return (
    <>
      <TopBar
        title="Текст"
        subtitle={roleNames(index, roles)}
        back={base}
        actions={
          <>
            <button className="btn btn--icon" type="button" aria-label="Поиск по тексту" aria-expanded={searchOpen} onClick={() => setSearchOpen((v) => !v)}>
              <Icon name="search" />
            </button>
            <button
              className="btn btn--icon"
              type="button"
              aria-label="Только избранное"
              aria-pressed={favOnly}
              onClick={() => setSearch(favOnly ? (at ? { at } : {}) : { fav: '1' }, { replace: true })}
            >
              <Icon name={favOnly ? 'star' : 'starOutline'} />
            </button>
          </>
        }
      />
      <main className="page">
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
                    {h.item.kind === 'line' ? speakerName(index, h.item) : 'Ремарка'} · {index.sceneOfItem.get(h.item.id)?.scene.title}
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

        {favOnly ? (
          <FavoritesList index={index} roles={roles} actions={actions} onShow={jump} />
        ) : (
          <>
            <div className="field">
              <label className="field__label" htmlFor="scene-jump">
                Перейти к сцене
              </label>
              <select id="scene-jump" className="input" value="" onChange={(e) => e.target.value && jump(e.target.value)}>
                <option value="">Выберите сцену…</option>
                {index.scenes.map((ref) => (
                  <option key={ref.scene.id} value={ref.scene.itemIds[0]}>
                    {sceneRefLabel(ref)}
                    {ref.scene.characterIds.some((c) => roles.includes(c)) ? '' : ' (без вашей роли)'}
                  </option>
                ))}
              </select>
            </div>
            <p className="small muted">Ваши реплики подсвечены. Нажмите на реплику, чтобы добавить её в избранное или начать с неё прогон.</p>

            {index.play.acts.map((act) => (
              <section key={act.n} aria-labelledby={`act-${act.n}`}>
                <h2 id={`act-${act.n}`} className="section-title">
                  {act.title}
                </h2>
                {act.scenes.map((scene) => {
                  const ref = index.sceneById.get(scene.id)!;
                  const mine = scene.characterIds.some((c) => roles.includes(c));
                  const collapsed = skipScenesWithoutRole && !mine && !expanded.has(scene.id) && atScene !== scene.id;
                  return (
                    <SceneBlock
                      key={scene.id}
                      index={index}
                      sceneRef={ref}
                      roles={roles}
                      collapsed={collapsed}
                      onExpand={() => setExpanded((s) => new Set(s).add(scene.id))}
                      showDirections={directions !== 'skip'}
                      actions={actions}
                    />
                  );
                })}
              </section>
            ))}
          </>
        )}
      </main>
    </>
  );
}

function SceneBlock({
  index,
  sceneRef,
  roles,
  collapsed,
  onExpand,
  showDirections,
  actions,
}: {
  index: PlayIndex;
  sceneRef: SceneRef;
  roles: string[];
  collapsed: boolean;
  onExpand: () => void;
  showDirections: boolean;
  actions: LineActions;
}) {
  const { scene } = sceneRef;
  return (
    <section aria-labelledby={`scene-${scene.id}`} style={{ marginBottom: 24 }}>
      <h3 id={`scene-${scene.id}`} className="scene-head">
        {sceneRef.number}. {scene.title}
      </h3>
      {collapsed ? (
        <button className="btn btn--ghost btn--small" type="button" onClick={onExpand}>
          Сцена без вашей роли — развернуть ({scene.itemIds.length})
        </button>
      ) : (
        scene.itemIds.map((id) => {
          const item = index.byId.get(id)!;
          if (item.kind === 'direction' && !showDirections) return null;
          return <TextItem key={id} item={item} index={index} mine={item.kind === 'line' && roles.includes(item.speakerId)} showAsides={showDirections} actions={actions} />;
        })
      )}
    </section>
  );
}

function TextItem({ item, index, mine, showAsides, actions }: { item: Item; index: PlayIndex; mine: boolean; showAsides: boolean; actions: LineActions }) {
  if (item.kind === 'direction') {
    return (
      <div id={item.id} className="item item--direction">
        <ItemBody item={item} showAsides />
      </div>
    );
  }
  const selected = actions.selected === item.id;
  const favorite = actions.favorites.has(item.id);
  return (
    <div id={item.id} className={`item${mine ? ' item--mine' : ''}${selected ? ' item--selected' : ''}`}>
      <button type="button" className="text-line" aria-expanded={selected} onClick={() => actions.onSelect(selected ? null : item.id)}>
        <span className="item__head">
          <span style={{ flex: 1 }}>
            {speakerName(index, item)}
            {mine && ' · вы'}
          </span>
          {favorite && <Icon name="star" label="В избранном" />}
        </span>
        <span className="play-text">
          <ItemBody item={item} showAsides={showAsides} />
        </span>
      </button>
      {selected && <LineActionsRow line={item} favorite={favorite} actions={actions} />}
    </div>
  );
}

function LineActionsRow({ line, favorite, actions, onShow }: { line: Line; favorite: boolean; actions: LineActions; onShow?: () => void }) {
  return (
    <div className="row text-actions">
      <button className="btn btn--small" type="button" aria-pressed={favorite} onClick={() => actions.onFavorite(line.id, !favorite)}>
        <Icon name={favorite ? 'star' : 'starOutline'} /> {favorite ? 'Убрать из избранного' : 'В избранное'}
      </button>
      <button className="btn btn--small btn--primary" type="button" onClick={() => actions.onRunFrom(line.id)}>
        <Icon name="play" /> Прогон отсюда
      </button>
      {onShow && (
        <button className="btn btn--small btn--ghost" type="button" onClick={onShow}>
          В тексте
        </button>
      )}
    </div>
  );
}

function FavoritesList({ index, roles, actions, onShow }: { index: PlayIndex; roles: string[]; actions: LineActions; onShow: (id: string) => void }) {
  const lines = index.lines.filter((l) => actions.favorites.has(l.id));
  if (!lines.length) {
    return (
      <p className="muted" style={{ marginTop: 16 }}>
        В избранном пока пусто. Нажмите на реплику в тексте и выберите «В избранное».
      </p>
    );
  }
  return (
    <>
      <h2 className="section-title">Избранное · {lines.length}</h2>
      {lines.map((l) => {
        const mine = roles.includes(l.speakerId);
        const ref = index.sceneOfItem.get(l.id);
        return (
          <div key={l.id} className={`item${mine ? ' item--mine' : ''}`}>
            <div className="item__head">
              <span style={{ flex: 1 }}>
                {speakerName(index, l)}
                {mine && ' · вы'}
              </span>
            </div>
            {ref && <p className="small muted" style={{ margin: '2px 0 4px' }}>{sceneRefLabel(ref)}</p>}
            <div className="play-text">
              <ItemBody item={l} showAsides />
            </div>
            <LineActionsRow line={l} favorite actions={actions} onShow={() => onShow(l.id)} />
          </div>
        );
      })}
    </>
  );
}
