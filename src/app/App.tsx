// Маршруты (раздел 7.5): hash-роутинг — GitHub Pages не умеет SPA-фолбэк, а hash стабильно работает офлайн.
// Стартовый экран (выбор роли) рисуется из cast.json сразу; экраны, которым нужен текст пьесы, ждут play.json.
import { Component, lazy, Suspense, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import cast from '../data/cast.json';
import { RoleSelect } from '../features/role-select/RoleSelect';
import { issueUrl, reportBody } from './diagnostics';
import { reportError } from './errors';
import { useApp, useSettings } from './store';

const Banners = lazy(() => import('./Banners').then((m) => ({ default: m.Banners })));
const RoleOverview = lazy(() => import('../features/role-overview/RoleOverview').then((m) => ({ default: m.RoleOverview })));
const SessionScreen = lazy(() => import('../features/session/SessionScreen').then((m) => ({ default: m.SessionScreen })));
const ReadThrough = lazy(() => import('../features/read-through/ReadThrough'));
const Stats = lazy(() => import('../features/stats/Stats'));
const SettingsScreen = lazy(() => import('../features/settings/SettingsScreen'));
const About = lazy(() => import('../features/about/About'));

const SPEAKING = new Set(cast.characters.filter((c) => c.speaking).map((c) => c.id));

function Loader({ text = 'Загрузка…' }: { text?: string }) {
  return (
    <div className="loader" role="status" aria-live="polite">
      {text}
    </div>
  );
}

/** Экраны, которым нужен полный текст пьесы. */
function RequirePlay({ children }: { children: ReactNode }) {
  const status = useApp((s) => s.status);
  const error = useApp((s) => s.error);
  if (status === 'error') {
    return (
      <main className="page">
        <div className="error-box" role="alert">
          <h1>Не удалось открыть пьесу</h1>
          <p>{error}</p>
          <button className="btn btn--primary" type="button" onClick={() => location.reload()}>
            Перезагрузить
          </button>
        </div>
      </main>
    );
  }
  if (status !== 'ready') return <Loader text="Открываем пьесу…" />;
  return <>{children}</>;
}

function Home() {
  const lastRoles = useSettings((s) => s.lastRoles);
  const roles = (lastRoles ?? '').split(',').filter((id) => SPEAKING.has(id));
  if (roles.length) return <Navigate to={`/r/${roles.join(',')}`} replace />;
  return <RoleSelect />;
}

class ErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: unknown }> {
  override state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  override componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    reportError(error instanceof Error ? error : new Error(`${String(error)}\n${info.componentStack ?? ''}`), 'render');
  }

  override render() {
    if (!this.state.error) return this.props.children;
    const message = this.state.error instanceof Error ? this.state.error.message : String(this.state.error);
    return (
      <main className="page">
        <div className="error-box" role="alert">
          <h1>Что-то пошло не так</h1>
          <p>{message}</p>
          <div className="row">
            <a className="btn btn--primary" href="#/">
              На главную
            </a>
            <a className="btn" href={issueUrl('Ошибка в приложении', reportBody([], navigator.userAgent, message))} target="_blank" rel="noreferrer">
              Сообщить о проблеме
            </a>
          </div>
        </div>
      </main>
    );
  }
}

/** Граница ошибок сбрасывается при переходе на другой экран (без перемонтирования — смена режима идёт на лету). */
function AppRoutes() {
  const location = useLocation();
  // Баннеры не срочные: подгружаем их (и IndexedDB) после первой отрисовки
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setIdle(true), 1000);
    return () => clearTimeout(t);
  }, []);
  return (
    <ErrorBoundary resetKey={location.pathname}>
      {idle && (
        <Suspense fallback={null}>
          <Banners />
        </Suspense>
      )}
      <Suspense fallback={<Loader />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/roles" element={<RoleSelect />} />
          <Route path="/r/:roles" element={<RequirePlay><RoleOverview /></RequirePlay>} />
          <Route path="/r/:roles/train/:mode" element={<RequirePlay><SessionScreen /></RequirePlay>} />
          <Route path="/r/:roles/read" element={<RequirePlay><ReadThrough /></RequirePlay>} />
          <Route path="/r/:roles/stats" element={<RequirePlay><Stats /></RequirePlay>} />
          <Route path="/settings" element={<RequirePlay><SettingsScreen /></RequirePlay>} />
          <Route path="/about" element={<RequirePlay><About /></RequirePlay>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}

export function App() {
  return (
    <HashRouter>
      <AppRoutes />
    </HashRouter>
  );
}
