// FR-17. «О проекте»: версия сборки, лицензии и атрибуция голосовых моделей, «Сообщить о проблеме».
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ErrorRow } from '../../engine/model';
import { buildLabel, issueUrl, REPO_URL, reportBody } from '../../app/diagnostics';
import { useLiveQuery } from '../../app/hooks';
import { repo } from '../../app/services';
import { useApp } from '../../app/store';
import { TopBar } from '../../app/ui';

const LIBRARIES: [string, string][] = [
  ['React, React Router', 'MIT'],
  ['Zustand', 'MIT'],
  ['Dexie', 'Apache-2.0'],
  ['Vite, vite-plugin-pwa, Workbox', 'MIT'],
];

export default function About() {
  const index = useApp((s) => s.index)!;
  const manifest = useApp((s) => s.manifest);
  const navigate = useNavigate();
  const errors = useLiveQuery(() => repo.recentErrors(10), [], [] as ErrorRow[]);
  const [what, setWhat] = useState('');
  const body = reportBody(errors, navigator.userAgent, what.trim());

  return (
    <>
      <TopBar title="О проекте" back={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))} />
      <main className="page">
        <section className="card">
          <h2>Учить текст</h2>
          <p>
            Тренажёр роли для труппы: пьеса {index.play.author}, «{index.play.title}». Текст с подсвеченной ролью, прогон сцены с первыми буквами своих реплик и аудиопрогон
            в наушниках — по практике того, как актёры учат текст.
          </p>
          <p className="small muted">
            Версия {buildLabel()}. Исходный код: <a href={REPO_URL}>{REPO_URL.replace('https://', '')}</a>.
          </p>
        </section>

        <section className="card">
          <h2>Приватность</h2>
          <p className="small">
            Нет аккаунтов, аналитики и cookies. Прогресс и заметки хранятся только на вашем устройстве и не покидают его, кроме файла резервной копии, который вы сохраняете сами.
          </p>
        </section>

        <section className="card">
          <h2>Голоса</h2>
          <p className="small">
            {manifest
              ? `Реплики озвучены заранее сгенерированными нейроголосами: ${Object.keys(manifest.clips).length} клипов, версия пайплайна ${manifest.pipelineVersion}.`
              : 'В этой сборке нейроголоса не сгенерированы — партнёров читает голос браузера.'}
          </p>
          <ul className="small">
            <li>
              <strong>Silero TTS v5 (ru)</strong> — © Silero Team, лицензия CC BY-NC 4.0, некоммерческое использование труппой.{' '}
              <a href="https://github.com/snakers4/silero-models">github.com/snakers4/silero-models</a>
            </li>
            <li>
              <strong>Piper</strong> (MIT) и голоса ru_RU — denis, dmitri, ruslan, irina; лицензия каждого голоса — по карточке модели.{' '}
              <a href="https://huggingface.co/rhasspy/piper-voices/tree/main/ru/ru_RU">huggingface.co/rhasspy/piper-voices</a>
            </li>
          </ul>
        </section>

        <section className="card">
          <h2>Библиотеки</h2>
          <ul className="small">
            {LIBRARIES.map(([name, license]) => (
              <li key={name}>
                {name} — {license}
              </li>
            ))}
          </ul>
        </section>

        <section className="card" aria-labelledby="report-title">
          <h2 id="report-title">Сообщить о проблеме</h2>
          <p className="small muted">Откроется новая задача на GitHub с текстом ниже. Вы увидите его целиком и отправите сами.</p>
          <label className="field__label" htmlFor="what">
            Что случилось
          </label>
          <textarea id="what" className="input" value={what} onChange={(e) => setWhat(e.target.value)} />
          <pre className="report" aria-label="Текст сообщения">
            {body}
          </pre>
          <a className="btn btn--primary" href={issueUrl('Проблема в «Учить текст»', body)} target="_blank" rel="noreferrer">
            Открыть GitHub Issues
          </a>
        </section>
      </main>
    </>
  );
}
