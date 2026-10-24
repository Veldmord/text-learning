// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useApp, useSettings } from '../../src/app/store';
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
  // Без пауз между репликами прогон в тестах идёт быстрее
  useSettings.getState().update({ pauseMs: 0 });
});

afterEach(cleanup);

// Курсоры и журнал сессий не должны переходить из теста в тест
beforeEach(async () => {
  await new Promise((r) => setTimeout(r, 20));
  await Promise.all(getDb().tables.map((t) => t.clear()));
});

function renderSession(path = '/r/a/train/letters') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/r/:roles/train/:mode" element={<SessionScreen />} />
        <Route path="/r/:roles" element={<p>обзор</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function start(total = 4) {
  fireEvent.click(await screen.findByRole('button', { name: 'Начать' }));
  await screen.findByText(`1 / ${total}`);
}

describe('экран сессии', () => {
  it('первые буквы: «Открыть» → aria-live → «Далее»', async () => {
    const { container } = renderSession();
    await start();
    expect(screen.getByText(/Реплика первыми буквами: 4 слова/)).toBeTruthy();
    expect(container.querySelector('.mine-line .letters')).toBeTruthy();
    expect(screen.queryByText(/Анна: Ты пришёл/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Открыть (пробел)' }));
    expect(await screen.findByText('Анна: Ты пришёл? Я ждала.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Открыть (пробел)' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Далее (→)' }));
    expect(await screen.findByText('2 / 4')).toBeTruthy();
  });

  it('клавиши: H, пробел открывает и ведёт дальше, стрелки', async () => {
    renderSession();
    await start();
    fireEvent.keyDown(window, { key: 'h' });
    await waitFor(() => expect(document.querySelector('.hint-word')?.textContent).toBe('Ты'));
    fireEvent.keyDown(window, { key: ' ' });
    await screen.findByText('Анна: Ты пришёл? Я ждала.');
    fireEvent.keyDown(window, { key: ' ' });
    await screen.findByText('2 / 4');
    fireEvent.keyDown(window, { key: 'ArrowRight' });
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
    act(() => swipe(-150));
    await screen.findByText('2 / 4');
    act(() => swipe(150));
    await screen.findByText('1 / 4');
  });

  it('прогон по очереди: партнёры звучат по одной реплике и сами ведут к своей', async () => {
    const { container } = renderSession('/r/a/train/run');
    await start(8);
    const mine = () => container.querySelector('.mine-line')!;
    expect(screen.getByText('Комната. Анна у окна.')).toBeTruthy();
    expect(mine().querySelector('.letters')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Далее (→)' }));
    await waitFor(() => expect(mine().textContent).toContain('Ты пришёл? Я ждала.'));
    fireEvent.click(screen.getByRole('button', { name: 'Далее (→)' }));
    // Реплики Бориса проходят сами, прогон останавливается на следующей реплике Анны
    await screen.findByText('4 / 8', undefined, { timeout: 3000 });
    expect(screen.getByText('Ты пришёл? Я ждала.')).toBeTruthy();
    expect(screen.getByText('Очень устал.')).toBeTruthy();
    expect(mine().querySelector('.letters')).toBeTruthy();
    expect(mine().textContent).not.toContain('Отдохни');
    expect(container.querySelector('.item--cue')?.textContent).toContain('Очень устал.');
  });

  it('прогон по очереди: на реплике партнёра — пауза', async () => {
    renderSession('/r/a/train/run');
    fireEvent.click(await screen.findByRole('button', { name: 'Выбрать место' }));
    const dialog = screen.getByRole('dialog', { name: 'Навигация' });
    fireEvent.click(within(dialog).getByRole('button', { name: /Борис.*Пришёл/ }));
    await screen.findByText('2 / 8');
    fireEvent.click(screen.getByRole('button', { name: 'Пауза (пробел)' }));
    expect(await screen.findByRole('button', { name: 'Продолжить (пробел)' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Открыть (пробел)' })).toBeNull();
  });

  it('навигация: поиск по словам и переход к реплике', async () => {
    renderSession();
    await start();
    fireEvent.click(screen.getByRole('button', { name: 'Навигация по сценам и репликам' }));
    const dialog = screen.getByRole('dialog', { name: 'Навигация' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Поиск' }));
    fireEvent.change(within(dialog).getByLabelText('Найти реплику по словам'), { target: { value: 'здравств' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Анна · вы.*Да\. Здравств/ }));
    expect(await screen.findByText('4 / 4')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('пустой диапазон — понятное сообщение вместо тренировки', async () => {
    renderSession('/r/c/train/run?scope=a1s01');
    expect(await screen.findByText('В этом диапазоне нет ваших реплик.')).toBeTruthy();
  });

  it('режимы прежних версий ведут в прогон с тем же диапазоном', async () => {
    renderSession('/r/a/train/cue?scope=a2');
    expect(await screen.findByRole('heading', { name: /Прогон с буквами/, level: 1 })).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Начать' }));
    await screen.findByText('1 / 4');
  });
});
