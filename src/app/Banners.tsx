// Баннеры: новая версия, подсказка установки на iOS, напоминание о резервной копии (разделы 11.2, 11.4).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { isIos, isStandalone } from './diagnostics';
import { useLiveQuery } from './hooks';
import { repo } from './services';
import { useApp, useSettings } from './store';

const WEEK = 7 * 24 * 60 * 60 * 1000;
const INSTALL_DISMISS_KEY = 'tl.installHintDismissed';
const BACKUP_SNOOZE_KEY = 'tl.backupSnoozeUntil';

const readLocal = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const writeLocal = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // недоступно — баннер вернётся после перезагрузки
  }
};

export function Banners() {
  const updateReady = useApp((s) => s.updateReady);
  const applyUpdate = useApp((s) => s.applyUpdate);
  const sessionActive = useApp((s) => s.sessionActive);
  const lastBackupAt = useSettings((s) => s.lastBackupAt);
  const [installDismissed, setInstallDismissed] = useState(() => readLocal(INSTALL_DISMISS_KEY) === '1');
  const [snoozeUntil, setSnoozeUntil] = useState(() => Number(readLocal(BACKUP_SNOOZE_KEY) ?? 0));
  const newReviews = useLiveQuery(() => repo.countReviewsSince(lastBackupAt ?? 0), [lastBackupAt], 0);

  if (sessionActive) return null;
  const now = Date.now();
  const backupDue = newReviews > 0 && now - (lastBackupAt ?? 0) > WEEK && now > snoozeUntil;
  const showInstall = isIos() && !isStandalone() && !installDismissed;

  return (
    <div className="page" style={{ paddingBottom: 0 }}>
      {updateReady && applyUpdate && (
        <div className="banner" role="status">
          <p>Доступна новая версия приложения.</p>
          <div className="banner__actions">
            <button className="btn btn--primary btn--small" type="button" onClick={applyUpdate}>
              Обновить
            </button>
          </div>
        </div>
      )}
      {showInstall && (
        <div className="banner" role="note">
          <p>
            Установите приложение на экран «Домой»: <strong>Поделиться → На экран «Домой»</strong>. Safari стирает данные сайтов, которые не открывали 7 дней, а
            установленное приложение это правило не затрагивает.
          </p>
          <div className="banner__actions">
            <button
              className="btn btn--small"
              type="button"
              onClick={() => {
                writeLocal(INSTALL_DISMISS_KEY, '1');
                setInstallDismissed(true);
              }}
            >
              Понятно
            </button>
          </div>
        </div>
      )}
      {backupDue && (
        <div className="banner" role="note">
          <p>С последней резервной копии появилось {newReviews} новых оценок. Сохраните копию прогресса в файл.</p>
          <div className="banner__actions">
            <Link className="btn btn--primary btn--small" to="/settings#backup">
              Сохранить
            </Link>
            <button
              className="btn btn--small"
              type="button"
              onClick={() => {
                const until = Date.now() + WEEK;
                writeLocal(BACKUP_SNOOZE_KEY, String(until));
                setSnoozeUntil(until);
              }}
            >
              Позже
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
