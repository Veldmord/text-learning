// FR-14. Экспорт и импорт прогресса JSON-файлом (раздел 11.3).
import { useRef, useState } from 'react';
import { BackupError, backupFileName, exportBackup, importBackup, parseBackup } from '../../storage/backup';
import { getDb } from '../../storage/db';
import { reconcileWithPlay } from '../../storage/reconcile';
import { reportError } from '../../app/services';
import { getSettings, useApp, useSettings } from '../../app/store';

export function BackupPanel() {
  const index = useApp((s) => s.index)!;
  const lastBackupAt = useSettings((s) => s.lastBackupAt);
  const update = useSettings((s) => s.update);
  const replace = useSettings((s) => s.replace);
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const doExport = async () => {
    try {
      const backup = await exportBackup(getDb(), { playId: index.play.id, playSourceHash: index.play.sourceHash, settings: getSettings() });
      const blob = new Blob([JSON.stringify(backup, null, 1)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = backupFileName();
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      update({ lastBackupAt: Date.now() });
      setMessage(`Сохранено: ${backup.cards.length} карточек, ${backup.reviews.length} оценок, ${backup.notes.length} заметок.`);
    } catch (e) {
      reportError(e, 'backup');
      setMessage('Не удалось сохранить файл.');
    }
  };

  const doImport = async (file: File) => {
    try {
      const backup = parseBackup(await file.text(), index.play.id);
      const r = await importBackup(getDb(), backup, getSettings());
      if (r.settings) replace({ ...r.settings, lastRoles: r.settings.lastRoles ?? getSettings().lastRoles });
      await reconcileWithPlay(getDb(), index.play, { force: true });
      setMessage(
        `Импортировано: карточек ${r.cards}, оценок ${r.reviews}, заметок ${r.notes}, позиций ${r.cursors}.` + (r.settings ? ' Настройки взяты из файла — они новее.' : ''),
      );
    } catch (e) {
      if (!(e instanceof BackupError)) reportError(e, 'backup');
      setMessage(e instanceof Error ? e.message : 'Не удалось прочитать файл.');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <section className="card" id="backup" aria-labelledby="backup-title">
      <h2 id="backup-title">Резервная копия</h2>
      <p className="small muted">
        Прогресс хранится только на этом устройстве. Сохраните файл, чтобы не потерять его или перенести на другой телефон или ноутбук. При импорте данные сливаются: по каждой
        записи побеждает последнее изменение.
        {lastBackupAt ? ` Последняя копия: ${new Date(lastBackupAt).toLocaleString('ru-RU')}.` : ' Копий ещё не было.'}
      </p>
      <div className="row">
        <button className="btn btn--primary" type="button" onClick={() => void doExport()}>
          Сохранить в файл
        </button>
        <label className="btn">
          Загрузить из файла
          <input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" onChange={(e) => e.target.files?.[0] && void doImport(e.target.files[0])} />
        </label>
      </div>
      {message && (
        <p className="small" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
