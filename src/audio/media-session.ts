// MediaSession: кнопки гарнитуры и экрана блокировки управляют тренировкой (раздел 10).
// play/pause → «Показать» (в аудиопрогоне — пауза), nexttrack → «Далее», previoustrack → «Назад».

export interface MediaHandlers {
  play?: () => void;
  pause?: () => void;
  next?: () => void;
  previous?: () => void;
}

export interface MediaMeta {
  title: string;
  artist: string;
  album: string;
}

const supported = () => typeof navigator !== 'undefined' && 'mediaSession' in navigator;

export function updateMediaSession(meta: MediaMeta | null, handlers: MediaHandlers, artworkBase: string): void {
  if (!supported()) return;
  const ms = navigator.mediaSession;
  try {
    ms.metadata = meta
      ? new MediaMetadata({
          ...meta,
          artwork: [
            { src: `${artworkBase}icons/icon-192.png`, sizes: '192x192', type: 'image/png' },
            { src: `${artworkBase}icons/icon-512.png`, sizes: '512x512', type: 'image/png' },
          ],
        })
      : null;
  } catch {
    // MediaMetadata может отсутствовать в старых браузерах
  }
  const set = (action: MediaSessionAction, fn?: () => void) => {
    try {
      ms.setActionHandler(action, fn ? () => fn() : null);
    } catch {
      // Действие не поддерживается браузером
    }
  };
  set('play', handlers.play);
  set('pause', handlers.pause);
  set('nexttrack', handlers.next);
  set('previoustrack', handlers.previous);
}

export function setPlaybackState(state: MediaSessionPlaybackState): void {
  if (supported()) navigator.mediaSession.playbackState = state;
}

export function clearMediaSession(): void {
  updateMediaSession(null, {}, '');
  setPlaybackState('none');
}
