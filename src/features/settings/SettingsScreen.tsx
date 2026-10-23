// Настройки: отображение (FR-15), озвучка (FR-07), дата премьеры (FR-09), данные и кэш аудио.
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { cachedAudioCount, pruneAudioCache } from '../../audio/prefetch';
import { BackupPanel } from '../backup/BackupPanel';
import { repo, requestPersist } from '../../app/services';
import { BASE_URL, useSettings } from '../../app/store';
import { Segmented, TopBar } from '../../app/ui';
import type { Theme } from '../../storage/settings';
import { DirectionsSetting, VoiceSettings } from './VoiceSettings';

function StorageStatus() {
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<string | null>(null);
  useEffect(() => {
    void navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
    void navigator.storage
      ?.estimate?.()
      .then((e) => setUsage(e.usage !== undefined ? `${((e.usage ?? 0) / 1024 / 1024).toFixed(1)} МБ` : null))
      .catch(() => undefined);
  }, []);
  return (
    <p className="small muted">
      Занято на устройстве: {usage ?? 'неизвестно'}.{' '}
      {persisted === true
        ? 'Хранилище защищено от автоматической очистки.'
        : persisted === false
          ? 'Браузер может очистить данные при нехватке места.'
          : ''}
      {persisted === false && (
        <>
          {' '}
          <button className="btn btn--ghost btn--small" type="button" onClick={() => void requestPersist().then(setPersisted)}>
            Защитить
          </button>
        </>
      )}
    </p>
  );
}

export default function SettingsScreen() {
  const s = useSettings();
  const navigate = useNavigate();
  const location = useLocation();
  const [audioCount, setAudioCount] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void cachedAudioCount().then(setAudioCount);
  }, []);
  useEffect(() => {
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }, [location.hash]);

  const back = () => (window.history.length > 1 ? navigate(-1) : navigate('/'));

  return (
    <>
      <TopBar title="Настройки" back={back} />
      <main className="page">
        <section className="card" aria-labelledby="display-title">
          <h2 id="display-title">Отображение</h2>
          <Segmented<Theme>
            label="Тема"
            value={s.theme}
            onChange={(theme) => s.update({ theme })}
            options={[
              { value: 'system', label: 'Как в системе' },
              { value: 'light', label: 'Светлая' },
              { value: 'dark', label: 'Тёмная' },
            ]}
          />
          <Segmented<number>
            label="Размер шрифта"
            value={s.fontSize}
            onChange={(fontSize) => s.update({ fontSize })}
            options={[
              { value: 0, label: 'Мелкий' },
              { value: 1, label: 'Обычный' },
              { value: 2, label: 'Крупный' },
              { value: 3, label: 'Очень крупный' },
            ]}
          />
          <DirectionsSetting />
        </section>

        <section className="card" aria-labelledby="voice-title">
          <h2 id="voice-title">Озвучка</h2>
          <VoiceSettings />
        </section>

        <section className="card" aria-labelledby="srs-title">
          <h2 id="srs-title">Интервальное повторение</h2>
          <div className="field">
            <label className="field__label" htmlFor="premiere">
              Дата премьеры
            </label>
            <div className="row">
              <input id="premiere" className="input" type="date" value={s.premiere ?? ''} onChange={(e) => s.update({ premiere: e.target.value || null })} style={{ maxWidth: 220 }} />
              {s.premiere && (
                <button className="btn btn--ghost btn--small" type="button" onClick={() => s.update({ premiere: null })}>
                  Очистить
                </button>
              )}
            </div>
            <span className="field__hint">Если указать, интервалы повторения не выйдут за премьеру — к ней роль будет свежей в памяти.</span>
          </div>
        </section>

        <BackupPanel />

        <section className="card" aria-labelledby="data-title">
          <h2 id="data-title">Данные на устройстве</h2>
          <StorageStatus />
          <p className="small muted">Аудио в офлайн-кэше: {audioCount ?? '…'} клипов.</p>
          <div className="row">
            <button
              className="btn btn--small"
              type="button"
              onClick={() =>
                void pruneAudioCache(BASE_URL, []).then((n) => {
                  setAudioCount(0);
                  setMessage(`Удалено клипов: ${n}.`);
                })
              }
            >
              Очистить кэш аудио
            </button>
            <button
              className="btn btn--small btn--ghost"
              type="button"
              onClick={() => {
                if (window.confirm('Удалить все оценки, расписание повторений и позиции? Заметки останутся. Сначала лучше сохранить резервную копию.')) {
                  void repo.resetProgress().then(() => setMessage('Прогресс сброшен.'));
                }
              }}
            >
              Сбросить прогресс
            </button>
          </div>
          {message && (
            <p className="small" role="status">
              {message}
            </p>
          )}
        </section>

        <p>
          <Link to="/about">О проекте, лицензии и «Сообщить о проблеме»</Link>
        </p>
      </main>
    </>
  );
}
