import { expect, test } from '@playwright/test';
import { chooseRole, readCursor, stubSpeech } from './helpers';

test.beforeEach(async ({ page }) => stubSpeech(page));

test('прогон по очереди: партнёры звучат сами, своя реплика — буквами → перезагрузка → продолжение', async ({ page }) => {
  await chooseRole(page, 'Девушка');
  await expect(page.getByRole('heading', { name: 'Карта сцен' })).toBeVisible();

  await page.getByRole('link', { name: /Прогон с буквами/ }).first().click();
  await expect(page.getByRole('button', { name: 'Все реплики по очереди' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Начать' }).click();

  // Первая реплика — Молодой человек «Это тебе.»: звучит и сама ведёт к реплике Девушки
  const mine = page.locator('.mine-line');
  await expect(page.getByText(/^2 \/ \d+$/)).toBeVisible();
  await expect(page.locator('.item--cue')).toContainText('Это тебе.');
  await expect(mine).not.toContainText('Розы');
  await expect(mine).toContainText('Р! К п! С!');

  await page.getByRole('button', { name: /Суфлёр/ }).click();
  await expect(mine).toContainText('Розы');
  await page.getByRole('button', { name: /^Открыть/ }).click();
  await expect(mine).toContainText('Розы! Какая прелесть! Спасибо!');
  await page.getByRole('button', { name: /Далее/ }).click();
  await expect(page.getByText(/^4 \/ \d+$/)).toBeVisible();

  // С клавиатуры: пробел — открыть, ещё пробел — дальше
  await page.keyboard.press('Space');
  await expect(mine).toContainText('Очень! А ты?');
  await page.keyboard.press('Space');
  await expect(page.getByText(/^6 \/ \d+$/)).toBeVisible();

  // Перезагрузка — продолжение с места (сначала дожидаемся записи курсора в IndexedDB)
  await expect.poll(() => readCursor(page, 'devushka:run:all')).toBe('L0006');
  await page.reload();
  await expect(page.getByText(/Начнём с места:.*Не глупее/)).toBeVisible();
  await page.getByRole('button', { name: 'Начать' }).click();
  await expect(page.getByText(/^6 \/ \d+$/)).toBeVisible();

  // Сказанные реплики видны в статистике: две до перезагрузки и та, на которой ушли с экрана
  await page.getByRole('button', { name: 'Назад', exact: true }).click();
  await page.getByRole('link', { name: 'Статистика' }).click();
  await expect(page.locator('.kpi').filter({ hasText: 'своих реплик сказано' })).toContainText('3');
});

test('навигация: поиск по словам в листе и переход к реплике', async ({ page }) => {
  await chooseRole(page, 'Девушка');
  await page.getByRole('link', { name: /Прогон с буквами/ }).first().click();
  await page.getByRole('button', { name: 'Начать' }).click();
  await expect(page.locator('.mine-line')).toBeVisible();

  await page.getByRole('button', { name: 'Навигация по сценам и репликам' }).click();
  const sheet = page.getByRole('dialog', { name: 'Навигация' });
  await sheet.getByRole('button', { name: 'Поиск' }).click();
  await sheet.getByLabel('Найти реплику по словам').fill('моцарт');
  await sheet.getByRole('button', { name: /Выключи своего Моцарта/ }).click();
  await expect(sheet).toBeHidden();
  await expect(page.locator('.mine-line')).toContainText('В с М.');

  // Сцены: выбрать другую реплику списком
  await page.getByRole('button', { name: 'Навигация по сценам и репликам' }).click();
  await sheet.getByRole('button', { name: 'Сцены' }).click();
  await sheet.getByRole('button', { name: /Это тебе/ }).first().click();
  await expect(page.getByText(/^2 \/ \d+$/)).toBeVisible();
});

test('первые буквы и смена режима на лету без потери места', async ({ page }) => {
  await chooseRole(page, 'Старик');
  await page.getByRole('link', { name: /Первые буквы/ }).click();
  await page.getByRole('button', { name: 'Начать' }).click();
  const mine = page.locator('.mine-line');
  await expect(mine.locator('.letters').first()).toBeVisible();
  const letters = await mine.textContent();

  await page.getByRole('button', { name: 'Настройки сессии' }).click();
  await page.getByRole('button', { name: /Режим: Первые буквы/ }).click();
  await page.getByRole('button', { name: /Прогон с буквами/ }).click();
  await expect(page).toHaveURL(/train\/run/);
  await expect(mine).toHaveText(letters!);
});

test('аудиопрогон: подсказка, тишина и переход к следующей реплике', async ({ page }) => {
  await chooseRole(page, 'Администратор');
  await page.getByRole('link', { name: /Аудиопрогон/ }).click();
  await page.getByRole('button', { name: 'Начать' }).click();
  await expect(page.getByText('Аудиопрогон', { exact: true })).toBeVisible();
  await expect(page.getByText('Ваша реплика — говорите')).toBeVisible({ timeout: 15_000 });
  // «Далее» на паузе: тишина своей реплики не успеет сама перевести прогон дальше
  await page.getByRole('button', { name: 'Пауза' }).click();
  await expect(page.getByText('Пауза', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Далее/ }).click();
  await expect(page.getByText(/^2 \/ \d+$/)).toBeVisible();
  await page.getByRole('button', { name: 'Пауза' }).click();
  await expect(page.getByText('Пауза', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await expect(page.getByText('Пауза', { exact: true })).toBeHidden();
});
