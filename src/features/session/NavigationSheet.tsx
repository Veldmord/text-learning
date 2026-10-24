// Навигация по месту в диалоге: сцены и реплики диапазона, поиск по ключевым словам, избранное.
import { useMemo, useState } from 'react';
import type { Step } from '../../engine/modes/steps';
import { lineSpeech, sceneRefLabel, searchPlay, speakerName, type PlayIndex, type SceneRef } from '../../engine/queries';
import type { Line } from '../../engine/types';
import { Icon, plural, preview, Segmented, Sheet } from '../../app/ui';

type Tab = 'scenes' | 'search' | 'favorites';

export function NavigationSheet({
  open,
  onClose,
  index,
  roles,
  steps,
  scopeIds,
  currentItemId,
  favorites,
  onPick,
  onWholeRole,
}: {
  open: boolean;
  onClose: () => void;
  index: PlayIndex;
  roles: string[];
  steps: Step[];
  /** Элементы диапазона сессии */
  scopeIds: ReadonlySet<string>;
  currentItemId: string | undefined;
  favorites: ReadonlySet<string>;
  onPick: (itemId: string) => void;
  /** Расширить диапазон до всей роли; нет — диапазон уже вся роль */
  onWholeRole: (() => void) | null;
}) {
  const [tab, setTab] = useState<Tab>('scenes');
  // Сцены сессии по порядку текста
  const scenes = useMemo(() => {
    const out: SceneRef[] = [];
    for (const s of steps) {
      const ref = index.sceneOfItem.get(s.itemId);
      if (ref && out[out.length - 1] !== ref) out.push(ref);
    }
    return out;
  }, [index, steps]);
  const within = useMemo(() => new Set(scenes.flatMap((r) => r.scene.itemIds).filter((id) => scopeIds.has(id))), [scenes, scopeIds]);

  return (
    <Sheet title="Навигация" open={open} onClose={onClose}>
      <Segmented<Tab>
        label="Где начать"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'scenes', label: 'Сцены' },
          { value: 'search', label: 'Поиск' },
          { value: 'favorites', label: 'Избранное' },
        ]}
      />
      {tab === 'scenes' && <ScenesTab index={index} roles={roles} scenes={scenes} within={within} currentItemId={currentItemId} favorites={favorites} onPick={onPick} />}
      {tab === 'search' && <SearchTab index={index} roles={roles} within={within} onPick={onPick} />}
      {tab === 'favorites' && <FavoritesTab index={index} roles={roles} within={within} favorites={favorites} onPick={onPick} />}
      {onWholeRole && (
        <p className="small muted">
          Показан выбранный диапазон.{' '}
          <button className="btn btn--ghost btn--small" type="button" onClick={onWholeRole}>
            Вся роль
          </button>
        </p>
      )}
    </Sheet>
  );
}

function LineButton({
  index,
  line,
  mine,
  current,
  favorite,
  onPick,
  label,
}: {
  index: PlayIndex;
  line: Line;
  mine: boolean;
  current?: boolean;
  favorite: boolean;
  onPick: (id: string) => void;
  label?: string;
}) {
  return (
    <button type="button" className={`nav-line${mine ? ' nav-line--mine' : ''}`} aria-current={current ? 'true' : undefined} onClick={() => onPick(line.id)}>
      <span className="nav-line__who">
        {speakerName(index, line)}
        {mine && ' · вы'}
        {favorite && <Icon name="star" label="В избранном" />}
        {current && <span className="chip">сейчас</span>}
      </span>
      {label && <span className="small muted">{label}</span>}
      <span className="nav-line__text">{preview(lineSpeech(line), 90)}</span>
    </button>
  );
}

function ScenesTab({
  index,
  roles,
  scenes,
  within,
  currentItemId,
  favorites,
  onPick,
}: {
  index: PlayIndex;
  roles: string[];
  scenes: SceneRef[];
  within: ReadonlySet<string>;
  currentItemId: string | undefined;
  favorites: ReadonlySet<string>;
  onPick: (id: string) => void;
}) {
  const currentScene = currentItemId ? index.sceneOfItem.get(currentItemId)?.scene.id : undefined;
  const [expanded, setExpanded] = useState<string | undefined>(currentScene ?? scenes[0]?.scene.id);
  return (
    <ul className="nav-scenes">
      {scenes.map((ref) => {
        const lines = ref.scene.itemIds.map((id) => index.byId.get(id)).filter((it): it is Line => it?.kind === 'line' && within.has(it.id));
        const mine = lines.filter((l) => roles.includes(l.speakerId)).length;
        const isOpen = expanded === ref.scene.id;
        return (
          <li key={ref.scene.id}>
            <button type="button" className="nav-scene" aria-expanded={isOpen} onClick={() => setExpanded(isOpen ? undefined : ref.scene.id)}>
              <span>{sceneRefLabel(ref)}</span>
              <span className="small muted">
                {mine} {plural(mine, 'ваша', 'ваши', 'ваших')} из {lines.length}
                {ref.scene.id === currentScene ? ' · вы здесь' : ''}
              </span>
            </button>
            {isOpen && (
              <div className="nav-lines">
                {lines.map((l) => (
                  <LineButton key={l.id} index={index} line={l} mine={roles.includes(l.speakerId)} current={l.id === currentItemId} favorite={favorites.has(l.id)} onPick={onPick} />
                ))}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function SearchTab({ index, roles, within, onPick }: { index: PlayIndex; roles: string[]; within: ReadonlySet<string>; onPick: (id: string) => void }) {
  const [query, setQuery] = useState('');
  const hits = useMemo(() => searchPlay(index, query, 50, within).filter((h) => h.item.kind === 'line'), [index, query, within]);
  return (
    <div role="search">
      <div className="field">
        <label className="field__label" htmlFor="nav-search">
          Найти реплику по словам
        </label>
        <input id="nav-search" className="input" type="search" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Например: Моцарт" />
      </div>
      {query.trim().length >= 2 && (
        <div aria-live="polite" className="small muted" style={{ margin: '8px 0' }}>
          Найдено: {hits.length}
          {hits.length === 50 ? '+' : ''}
        </div>
      )}
      {hits.map((h) => {
        const line = h.item as Line;
        const ref = index.sceneOfItem.get(line.id);
        return (
          <button key={line.id} type="button" className="search-hit" onClick={() => onPick(line.id)}>
            <span className="small muted">
              {speakerName(index, line)}
              {roles.includes(line.speakerId) ? ' · вы' : ''} · {ref ? sceneRefLabel(ref) : ''}
            </span>
            <br />
            {h.before}
            <mark>{h.match}</mark>
            {h.after}
          </button>
        );
      })}
    </div>
  );
}

function FavoritesTab({
  index,
  roles,
  within,
  favorites,
  onPick,
}: {
  index: PlayIndex;
  roles: string[];
  within: ReadonlySet<string>;
  favorites: ReadonlySet<string>;
  onPick: (id: string) => void;
}) {
  const lines = index.lines.filter((l) => favorites.has(l.id) && within.has(l.id));
  const outside = [...favorites].filter((id) => !within.has(id)).length;
  if (!lines.length) {
    return (
      <p className="muted">
        {outside ? `В этом диапазоне избранного нет, вне его — ${outside}.` : 'Пока пусто.'} Добавить реплику в избранное можно на экране «Текст»: нажмите на реплику и затем «В избранное».
      </p>
    );
  }
  return (
    <div className="nav-lines">
      {lines.map((l) => {
        const ref = index.sceneOfItem.get(l.id);
        return <LineButton key={l.id} index={index} line={l} mine={roles.includes(l.speakerId)} favorite={false} onPick={onPick} {...(ref ? { label: sceneRefLabel(ref) } : {})} />;
      })}
      {outside > 0 && <p className="small muted">Ещё вне диапазона: {outside}.</p>}
    </div>
  );
}
