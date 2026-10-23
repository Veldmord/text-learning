// FR-03. Диапазон: вся роль / действие / сцены / от реплики до реплики / только слабые.
import { useId } from 'react';
import { lineSpeech, myLinesInScope, type PlayIndex, type Scope, ALL_SCOPE } from '../../engine/queries';
import type { LineId } from '../../engine/types';
import { Segmented, Switch } from '../../app/ui';

export type ScopeKind = 'all' | 'act' | 'scenes' | 'range';

export function scopeKind(scope: Scope): ScopeKind {
  const p = scope.parts[0];
  if (!p) return 'all';
  if (p.kind === 'act') return 'act';
  if (p.kind === 'scene') return 'scenes';
  return 'range';
}

const preview = (text: string) => (text.length > 48 ? `${text.slice(0, 48)}…` : text);

export function ScopePicker({ index, roles, scope, onChange }: { index: PlayIndex; roles: string[]; scope: Scope; onChange: (s: Scope) => void }) {
  const kind = scopeKind(scope);
  const myLines = myLinesInScope(index, roles, ALL_SCOPE);
  const fromId = useId();
  const toId = useId();
  const range = scope.parts[0]?.kind === 'range' ? scope.parts[0] : null;
  const act = scope.parts[0]?.kind === 'act' ? scope.parts[0].n : null;

  const setKind = (k: ScopeKind) => {
    const weak = scope.weak;
    if (k === 'all') onChange({ parts: [], weak });
    else if (k === 'act') onChange({ parts: [{ kind: 'act', n: 1 }], weak });
    else if (k === 'scenes') {
      const first = index.scenes.find((s) => s.scene.characterIds.some((c) => roles.includes(c)));
      onChange({ parts: first ? [{ kind: 'scene', id: first.scene.id }] : [], weak });
    } else {
      const a = myLines[0]?.id;
      const b = myLines[Math.min(myLines.length - 1, 9)]?.id;
      onChange({ parts: a && b ? [{ kind: 'range', from: a, to: b }] : [], weak });
    }
  };

  return (
    <section className="card" aria-label="Диапазон тренировки">
      <Segmented<ScopeKind>
        label="Что учим"
        value={kind}
        onChange={setKind}
        options={[
          { value: 'all', label: 'Вся роль' },
          { value: 'act', label: 'Действие' },
          { value: 'scenes', label: 'Сцены' },
          { value: 'range', label: 'Реплики' },
        ]}
      />
      {kind === 'act' && (
        <Segmented<number>
          label="Действие"
          value={act ?? 1}
          onChange={(n) => onChange({ parts: [{ kind: 'act', n }], weak: scope.weak })}
          options={index.play.acts.map((a) => ({ value: a.n, label: a.title }))}
        />
      )}
      {kind === 'scenes' && <p className="small muted">Отметьте сцены в карте ниже.</p>}
      {kind === 'range' && range && (
        <div className="stack">
          <div className="field">
            <label className="field__label" htmlFor={fromId}>
              От реплики
            </label>
            <select
              id={fromId}
              className="input"
              value={range.from}
              onChange={(e) => onChange({ parts: [{ kind: 'range', from: e.target.value as LineId, to: range.to }], weak: scope.weak })}
            >
              {myLines.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.id} · {preview(lineSpeech(l))}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field__label" htmlFor={toId}>
              До реплики
            </label>
            <select
              id={toId}
              className="input"
              value={range.to}
              onChange={(e) => onChange({ parts: [{ kind: 'range', from: range.from, to: e.target.value as LineId }], weak: scope.weak })}
            >
              {myLines.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.id} · {preview(lineSpeech(l))}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
      <Switch label="Только слабые" hint="Реплики, у которых подошёл срок повторения или прогноз ниже 90 %" checked={scope.weak} onChange={(weak) => onChange({ ...scope, weak })} />
    </section>
  );
}
