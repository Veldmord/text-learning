// FR-13 / раздел 11.1: «Скачать роль для офлайна» с объёмом, прогрессом, отменой и датой загрузки.
import { useEffect, useMemo, useRef, useState } from 'react';
import { clipsForRoles, downloadFiles, missingFiles, pruneAudioCache, type DownloadProgress } from '../../audio/prefetch';
import { rolesKey } from '../../engine/queries';
import { requestPersist, reportError } from '../../app/services';
import { BASE_URL, useApp } from '../../app/store';
import { formatMb, Icon, Progress } from '../../app/ui';

const dateKey = (roles: string[]) => `tl.offline:${rolesKey(roles)}`;

function readDate(roles: string[]): number | null {
  try {
    const v = localStorage.getItem(dateKey(roles));
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}

export function OfflinePanel({ roles }: { roles: string[] }) {
  const index = useApp((s) => s.index)!;
  const manifest = useApp((s) => s.manifest);
  const set = useMemo(() => (manifest ? clipsForRoles(index, manifest, roles) : null), [index, manifest, roles]);
  const [missing, setMissing] = useState<number | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [downloadedAt, setDownloadedAt] = useState<number | null>(() => readDate(roles));
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!set) return;
    let cancelled = false;
    missingFiles(BASE_URL, set.files)
      .then((m) => !cancelled && setMissing(m.length))
      .catch(() => !cancelled && setMissing(set.files.length));
    return () => {
      cancelled = true;
    };
  }, [set, progress?.done]);

  useEffect(() => () => abort.current?.abort(), []);

  if (!set) {
    return (
      <section className="card" aria-labelledby="offline-title">
        <h2 id="offline-title">Офлайн</h2>
        <p className="muted small">
          Текст пьесы уже работает без сети. Озвучка нейроголосами в этой сборке не сгенерирована, поэтому партнёров читает голос браузера.
        </p>
      </section>
    );
  }

  const start = async () => {
    const files = await missingFiles(BASE_URL, set.files);
    if (!files.length) {
      setMessage('Все клипы роли уже на устройстве.');
      return;
    }
    void requestPersist();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setMessage(null);
    setProgress({ done: 0, total: files.length, failed: 0 });
    try {
      const result = await downloadFiles(BASE_URL, files, setProgress, ctrl.signal);
      if (ctrl.signal.aborted) setMessage('Загрузка отменена. Уже скачанные клипы сохранены.');
      else if (result.failed) setMessage(`Не скачалось ${result.failed} клипов — проверьте сеть и повторите.`);
      else {
        const now = Date.now();
        try {
          localStorage.setItem(dateKey(roles), String(now));
        } catch {
          // без даты — не критично
        }
        setDownloadedAt(now);
        setMessage('Роль доступна без сети.');
      }
    } catch (e) {
      reportError(e, 'offline');
      setMessage(e instanceof Error ? e.message : 'Ошибка загрузки');
    } finally {
      abort.current = null;
      setProgress(null);
    }
  };

  const prune = async () => {
    const removed = await pruneAudioCache(BASE_URL, set.files);
    setMessage(removed ? `Удалено ${removed} клипов других ролей.` : 'Лишних клипов нет.');
  };

  const downloading = progress !== null;
  return (
    <section className="card" aria-labelledby="offline-title">
      <h2 id="offline-title">Офлайн</h2>
      <p className="muted small">
        Клипы всех сцен с вашей ролью: свои реплики, подсказки партнёров и ремарки — {set.files.length} файлов, около {formatMb(set.bytes)}.
        {missing !== null && missing > 0 && ` Не скачано: ${missing}.`}
        {missing === 0 && ' Всё уже на устройстве.'}
        {downloadedAt && ` Последняя загрузка: ${new Date(downloadedAt).toLocaleDateString('ru-RU')}.`}
      </p>
      {downloading && (
        <div className="stack" aria-live="polite">
          <Progress value={progress.total ? progress.done / progress.total : 0} label="Загрузка аудио роли" accent />
          <span className="small muted">
            {progress.done} из {progress.total}
          </span>
        </div>
      )}
      <div className="row" style={{ marginTop: 8 }}>
        {downloading ? (
          <button className="btn" type="button" onClick={() => abort.current?.abort()}>
            Отменить
          </button>
        ) : (
          <button className="btn btn--primary" type="button" onClick={() => void start()} disabled={missing === 0}>
            <Icon name="download" /> Скачать роль для офлайна
          </button>
        )}
        <button className="btn btn--ghost btn--small" type="button" onClick={() => void prune()} disabled={downloading}>
          Удалить аудио других ролей
        </button>
      </div>
      {message && (
        <p className="small" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
