import { expect, test } from '@playwright/test';
import { chooseRole, readCursor, stubSpeech } from './helpers';

test.beforeEach(async ({ page }) => stubSpeech(page));

test('выбор роли → тренировка → оценка → перезагрузка → продолжение', async ({ page }) => {
  await chooseRole(page, 'Девушка');
  await expect(page.getByRole('heading', { name: 'Карта сцен' })).toBeVisible();

  await page.getByRole('link', { name: /По репликам/ }).first().click();
  await expect(page.getByText(/реплик/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Начать' }).click();

  // Первая реплика Девушки: подсказка — Молодой человек «Это тебе.»
  const mine = page.locator('.mine-line');
  await expect(page.locator('.item--cue')).toContainText('Это тебе.');
  await expect(mine).not.toContainText('Розы');
  await expect(page.getByText(/^1 \/ \d+$/)).toBeVisible();

  await page.getByRole('button', { name: /Суфлёр/ }).click();
  await expect(mine).toContainText('Розы');
  await page.getByRole('button', { name: /Показать/ }).click();
  await expect(mine).toContainText('Розы! Какая прелесть! Спасибо!');
  // «Суфлёр» снижает оценку, но кнопка «Знал» доступна
  await page.getByRole('button', { name: /^Знал/ }).click();
  await expect(page.getByText(/^2 \/ \d+$/)).toBeVisible();

  // Вторая реплика — с клавиатуры: пробел — показать, 3 — «Знал»
  await page.keyboard.press('Space');
  await expect(page.getByRole('group', { name: 'Оценка' })).toBeVisible();
  await page.keyboard.press('3');
  await expect(page.getByText(/^3 \/ \d+$/)).toBeVisible();

  // Перезагрузка — продолжение с места (сначала дожидаемся записи курсора в IndexedDB)
  await expect.poll(() => readCursor(page, 'devushka:cue:all')).toBe('L0006');
  await page.reload();
  await page.getByRole('button', { name: 'Начать' }).click();
  await expect(page.getByText(/^3 \/ \d+$/)).toBeVisible();

  // «Назад» возвращает к предыдущей реплике
  await page.getByRole('button', { name: /Назад \(←\)/ }).click();
  await expect(page.getByText(/^2 \/ \d+$/)).toBeVisible();

  // Прогресс виден в статистике
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await page.getByRole('link', { name: 'Статистика' }).click();
  await expect(page.getByText('оценок всего')).toBeVisible();
  await expect(page.locator('.kpi').filter({ hasText: 'оценок всего' })).toContainText('2');
});

test('режимы: первые буквы, письменный ввод и смена режима на лету', async ({ page }) => {
  await chooseRole(page, 'Старик');
  await page.getByRole('link', { name: /Первые буквы/ }).click();
  await page.getByRole('button', { name: 'Начать' }).click();
  const mine = page.locator('.mine-line');
  await expect(mine.locator('.letters').first()).toBeVisible();
  const before = await page.getByText(/^1 \/ \d+$/).textContent();

  await page.getByRole('button', { name: 'Настройки сессии' }).click();
  await page.getByRole('button', { name: /Режим: Первые буквы/ }).click();
  await page.getByRole('button', { name: /Письменный ввод/ }).click();
  await expect(page).toHaveURL(/train\/type/);
  await expect(page.getByText(before!)).toBeVisible();

  await page.getByLabel('Наберите реплику по памяти').fill('Постойте, куда же вы?');
  await page.getByRole('button', { name: /Проверить/ }).click();
  await expect(page.getByText(/Совпадение \d+ %/)).toBeVisible();
  await expect(page.locator('.btn--suggested')).toHaveCount(1);
});

test('аудиопрогон: подсказка, тишина и переход к следующей реплике', async ({ page }) => {
  await chooseRole(page, 'Администратор');
  await page.getByRole('link', { name: /Аудиопрогон/ }).click();
  await page.getByRole('button', { name: 'Начать' }).click();
  await expect(page.getByText('Аудиопрогон', { exact: true })).toBeVisible();
  await expect(page.getByText('Ваша реплика — говорите')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Пауза' }).click();
  await expect(page.getByText('Пауза', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await page.getByRole('button', { name: /Далее/ }).click();
  await expect(page.getByText(/^2 \/ \d+$/)).toBeVisible();
});
