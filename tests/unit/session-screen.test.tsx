// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useApp } from '../../src/app/store';
import { getDb } from '../../src/storage/db';
import { SessionScreen } from '../../src/features/session/SessionScreen';
import { miniPlay } from './fixtures';

beforeAll(() => {
  // jsdom не воспроизводит медиа: play() — пустой промис
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  // jsdom не реализует PointerEvent — хватает MouseEvent с pointerType
  if (!('PointerEvent' in window)) {
    class PointerEventPolyfill extends MouseEvent {
      pointerType: string;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerType = init.pointerType ?? 'mouse';
      }
    }
    vi.stubGlobal('PointerEvent', PointerEventPolyfill);
  }
  useApp.setState({ status: 'ready', index: miniPlay().index, manifest: null });
});

afterEach(cleanup);

// Курсоры и оценки не должны переходить из теста в тест
beforeEach(async () => {
  await new Promise((r) => setTimeout(r, 20));
  await Promise.all(getDb().tables.map((t) => t.clear()));
});

function renderSession(path = '/r/a/train/cue') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/r/:roles/train/:mode" element={<SessionScreen />} />
        <Route path="/r/:roles" element={<p>обзор</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function start() {
  fireEvent.click(await screen.findByRole('button', { name: 'Начать' }));
  await screen.findByText('1 / 4');
}

describe('экран сессии', () => {
  it('кнопки: скрытая реплика → «Показать» → aria-live → оценка', async () => {
    renderSession();
    await start();
    expect(screen.getByText(/Реплика скрыта: 4 слова/)).toBeTruthy();
    expect(screen.queryByText(/Анна: Ты пришёл/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Показать (пробел)' }));
    expect(await screen.findByText('Анна: Ты пришёл? Я ждала.')).toBeTruthy();
    const grades = screen.getByRole('group', { name: 'Оценка' });
    fireEvent.click(within(grades).getByRole('button', { name: 'Знал (3)' }));
    expect(await screen.findByText('2 / 4')).toBeTruthy();
  });

  it('клавиши: пробел, 1/2/3, стрелки, H', async () => {
    renderSession();
    await start();
    fireEvent.keyDown(window, { key: 'h' });
    await waitFor(() => expect(document.querySelector('.hint-word')?.textContent).toBe('Ты'));
    fireEvent.keyDown(window, { key: ' ' });
    await screen.findByRole('group', { name: 'Оценка' });
    fireEvent.keyDown(window, { key: '2' });
    await screen.findByText('2 / 4');
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await screen.findByText('3 / 4');
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    await screen.findByText('2 / 4');
  });

  it('свайп влево — «Далее», вправо — «Назад»', async () => {
    const { container } = renderSession();
    await start();
    const main = container.querySelector('main')!;
    const swipe = (dx: number) => {
      fireEvent.pointerDown(main, { pointerType: 'touch', clientX: 300, clientY: 300 });
      fireEvent.pointerUp(main, { pointerType: 'touch', clientX: 300 + dx, clientY: 305 });
    };
    act(() => swipe(-150));
    act(() => swipe(-150));
    await screen.findByText('2 / 4');
    act(() => swipe(150));
    await screen.findByText('1 / 4');
  });

  it('пустой диапазон — понятное сообщение вместо тренировки', async () => {
    renderSession('/r/a/train/chunks');
    expect(await screen.findByText('В этом диапазоне нет реплик длиннее 40 слов.')).toBeTruthy();
  });
});
