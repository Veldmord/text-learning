// Общие компоненты интерфейса: иконки, верхняя панель, переключатели, ползунки, лист настроек.
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

const ICONS = {
  back: 'M15.4 5.4 14 4l-8 8 8 8 1.4-1.4L8.8 12z',
  gear: 'M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.4-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3h-4l-.4 2.6a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.4L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.4 2.5-1c.5.4 1.1.7 1.7 1L11 21h4l.4-2.6c.6-.3 1.2-.6 1.7-1l2.5 1 2-3.4zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z',
  speaker: 'M3 9v6h4l5 5V4L7 9zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z',
  play: 'M8 5v14l11-7z',
  pause: 'M6 5h4v14H6zm8 0h4v14h-4z',
  search: 'M15.5 14h-.8l-.3-.3A6.5 6.5 0 1 0 14 15.5l.3.3v.8l5 5 1.5-1.5zm-6 0a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9z',
  close: 'M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z',
  chart: 'M5 9h3v10H5zm5.5-5h3v15h-3zM16 13h3v6h-3z',
  book: 'M18 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12V2zM6 4h5v8l-2.5-1.5L6 12z',
  download: 'M5 20h14v-2H5zm7-3 6-6-1.4-1.4-3.6 3.6V3h-2v10.2L7.4 9.6 6 11z',
  next: 'M8.6 18.6 10 20l8-8-8-8-1.4 1.4 6.6 6.6z',
  check: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z',
  user: 'M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-2.7 0-8 1.3-8 4v2h16v-2c0-2.7-5.3-4-8-4z',
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, label }: { name: IconName; label?: string }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden={label ? undefined : true} role={label ? 'img' : undefined} aria-label={label}>
      <path d={ICONS[name]} />
    </svg>
  );
}

export function TopBar({ title, subtitle, back, actions }: { title: ReactNode; subtitle?: ReactNode; back?: string | (() => void); actions?: ReactNode }) {
  const navigate = useNavigate();
  return (
    <header className="topbar">
      {back !== undefined && (
        <button className="btn btn--icon" type="button" aria-label="Назад" onClick={() => (typeof back === 'string' ? navigate(back) : back())}>
          <Icon name="back" />
        </button>
      )}
      <h1 className="topbar__title">
        {title}
        {subtitle && <small>{subtitle}</small>}
      </h1>
      {actions}
    </header>
  );
}

export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="field" role="group" aria-labelledby={id}>
      <span className="field__label" id={id}>
        {label}
      </span>
      <div className="segmented">
        {options.map((o) => (
          <button key={String(o.value)} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
      {hint && <span className="field__hint">{hint}</span>}
    </div>
  );
}

export function RangeField({
  label,
  value,
  min,
  max,
  step,
  format = (v) => String(v),
  onChange,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <div className="field__row">
        <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-valuetext={format(value)} />
        <output htmlFor={id}>{format(value)}</output>
      </div>
      {hint && <span className="field__hint">{hint}</span>}
    </div>
  );
}

export function Switch({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <div className="field">
      <label className="switch">
        <span>
          <span className="field__label">{label}</span>
          {hint && (
            <>
              <br />
              <span className="field__hint">{hint}</span>
            </>
          )}
        </span>
        <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      </label>
    </div>
  );
}

export function Progress({ value, label, accent }: { value: number; label: string; accent?: boolean }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className={`progress${accent ? ' progress--accent' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Sheet({ title, open, onClose, children }: { title: string; open: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref} onClick={(e) => e.stopPropagation()}>
        <div className="sheet__head">
          <h2>{title}</h2>
          <button className="btn btn--icon" type="button" aria-label="Закрыть" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export const percent = (v: number) => `${Math.round(v * 100)} %`;

export function formatDuration(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} мин`;
  return `${Math.floor(min / 60)} ч ${min % 60} мин`;
}

export function plural(n: number, one: string, few: string, many: string): string {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
  return many;
}

export const formatMb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(bytes > 10 * 1024 * 1024 ? 0 : 1)} МБ`;
