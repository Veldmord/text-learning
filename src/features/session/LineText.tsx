// Отрисовка реплик: фрагменты своей реплики (скрытые слова, буквы, подсказки суфлёра) и элементы контекста.
import type { Piece } from '../../engine/modes/render';
import type { PlayIndex } from '../../engine/queries';
import type { Item } from '../../engine/types';
import { Icon } from '../../app/ui';

export function Pieces({ pieces }: { pieces: Piece[] }) {
  return (
    <>
      {pieces.map((p, i) => {
        switch (p.kind) {
          case 'text':
          case 'sep':
            return <span key={i}>{p.text}</span>;
          case 'aside':
            return (
              <span key={i} className="aside">
                ({p.text})
              </span>
            );
          case 'blank':
            return <span key={i} className="blank" style={{ width: `${Math.min(p.length, 14) * 0.55}em` }} aria-hidden="true" />;
          case 'letters':
            return (
              <span key={i} className="letters" aria-hidden="true">
                {p.text}
              </span>
            );
          case 'hint':
            return (
              <span key={i} className="hint-word">
                {p.text}
              </span>
            );
        }
      })}
    </>
  );
}

/** Текст элемента пьесы с inline-ремарками курсивом. */
export function ItemBody({ item, showAsides }: { item: Item; showAsides: boolean }) {
  if (item.kind === 'direction') return <>{item.text}</>;
  return (
    <>
      {item.segments
        .filter((s) => s.kind === 'speech' || showAsides)
        .map((s, i) =>
          s.kind === 'aside' ? (
            <span key={i} className="aside">
              {i > 0 ? ' ' : ''}({s.text}){' '}
            </span>
          ) : (
            <span key={i}>{s.text}</span>
          ),
        )}
    </>
  );
}

export function ContextItem({
  item,
  index,
  isCue,
  isMine,
  speaking,
  showAsides,
  onReplay,
}: {
  item: Item;
  index: PlayIndex;
  isCue: boolean;
  isMine: boolean;
  speaking: boolean;
  showAsides: boolean;
  onReplay?: () => void;
}) {
  if (item.kind === 'direction') {
    return (
      <div className={`item item--direction${speaking ? ' item--speaking' : ''}`} data-item={item.id}>
        <ItemBody item={item} showAsides />
      </div>
    );
  }
  const name = index.characters.get(item.speakerId)?.name ?? item.speakerId;
  const cls = ['item', isMine ? 'item--mine' : isCue ? 'item--cue' : '', speaking ? 'item--speaking' : ''].filter(Boolean).join(' ');
  return (
    <div className={cls} data-item={item.id}>
      <div className="item__head">
        <span>
          {name}
          {isMine && ' · вы'}
          {isCue && <span className="sr-only"> — подсказка</span>}
        </span>
        {onReplay && (
          <button className="btn btn--icon" type="button" onClick={onReplay} aria-label="Повторить подсказку (R)" title="Повторить подсказку (R)">
            <Icon name="speaker" />
          </button>
        )}
      </div>
      <div className="play-text">
        <ItemBody item={item} showAsides={showAsides} />
      </div>
    </div>
  );
}
