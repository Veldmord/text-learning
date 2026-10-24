import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { chooseRole, stubSpeech } from './helpers';

test.beforeEach(async ({ page }) => stubSpeech(page));

async function expectNoSeriousA11yIssues(page: Page) {
  // Контраст меряется по итоговым цветам: ждём конца переходов (кнопка «Далее» становится главной после «Открыть»)
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity));
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  const serious = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')}`)).toEqual([]);
}

test('доступность основных экранов (axe, WCAG 2.2 AA)', async ({ page }) => {
  await page.goto('./');
  await expectNoSeriousA11yIssues(page);
  await chooseRole(page, 'Мужчина');
  await expectNoSeriousA11yIssues(page);
  await page.getByRole('link', { name: /Прогон с буквами/ }).first().click();
  await expect(page.getByRole('button', { name: 'Начать' })).toBeVisible();
  await expectNoSeriousA11yIssues(page);
  // «Сразу к моим репликам»: без ожидания реплик партнёров перед первой своей
  await page.getByRole('button', { name: 'Сразу к моим репликам' }).click();
  await page.getByRole('button', { name: 'Начать' }).click();
  await expect(page.locator('.mine-line')).toBeVisible();
  await expectNoSeriousA11yIssues(page);
  await page.getByRole('button', { name: /^Открыть/ }).click();
  await expectNoSeriousA11yIssues(page);
  await page.getByRole('button', { name: 'Навигация по сценам и репликам' }).click();
  await expect(page.getByRole('dialog', { name: 'Навигация' })).toBeVisible();
  await expectNoSeriousA11yIssues(page);
  await page.goto('./#/r/muzhchina/read');
  await expect(page.getByRole('heading', { name: 'Действие первое' })).toBeVisible();
  await expectNoSeriousA11yIssues(page);
  await page.goto('./#/settings');
  await expectNoSeriousA11yIssues(page);
});

test('реплика первыми буквами не читается скринридером до «Открыть», открытая — объявляется', async ({ page }) => {
  await chooseRole(page, 'Девушка');
  await page.getByRole('link', { name: /Первые буквы/ }).click();
  await page.getByRole('button', { name: 'Начать' }).click();
  const live = page.locator('[aria-live="polite"]').filter({ hasText: 'Девушка:' });
  await expect(page.getByText(/Реплика первыми буквами: \d+ слов/)).toBeAttached();
  await expect(live).toHaveCount(0);
  await page.getByRole('button', { name: /^Открыть/ }).click();
  await expect(live).toContainText('Розы! Какая прелесть! Спасибо!');
});

test('приватность и CSP: только свой origin, без cookies и нарушений политики', async ({ page, context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const foreign: string[] = [];
  const cspErrors: string[] = [];
  page.on('request', (r) => {
    const url = r.url();
    if (!url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:')) foreign.push(url);
  });
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) cspErrors.push(m.text());
  });
  await chooseRole(page, 'Старик');
  await page.getByRole('link', { name: /Первые буквы/ }).click();
  await page.getByRole('button', { name: 'Начать' }).click();
  await page.getByRole('button', { name: /^Открыть/ }).click();
  await page.getByRole('button', { name: /Далее/ }).click();
  await page.goto('./#/about');
  await expect(page.getByRole('heading', { name: 'Сообщить о проблеме' })).toBeVisible();
  expect(foreign).toEqual([]);
  expect(cspErrors).toEqual([]);
  expect(await context.cookies()).toEqual([]);
});

test('текст: поиск, избранное и «Прогон отсюда»', async ({ page }) => {
  await chooseRole(page, 'Девушка');
  await page.getByRole('link', { name: /Открыть текст/ }).click();
  await page.getByRole('button', { name: 'Поиск по тексту' }).click();
  await page.getByLabel('Поиск по тексту пьесы').fill('моцарт');
  await page.getByRole('search').getByRole('button', { name: /Выключи своего Моцарта/ }).click();
  await expect(page).toHaveURL(/at=L0007/);
  const item = page.locator('#L0007');
  await expect(item).toBeInViewport();
  await expect(item).toHaveClass(/item--mine/);
  await item.getByRole('button', { name: 'В избранное' }).click();
  await expect(item.getByRole('button', { name: 'Убрать из избранного' })).toHaveAttribute('aria-pressed', 'true');

  await page.reload();
  await expect(page.locator('#L0007').getByRole('img', { name: 'В избранном' })).toBeVisible();
  await page.getByRole('button', { name: 'Только избранное' }).click();
  await expect(page.getByRole('heading', { name: 'Избранное · 1' })).toBeVisible();
  await page.getByRole('button', { name: 'Прогон отсюда' }).click();

  await expect(page).toHaveURL(/train\/run\?at=L0007/);
  await expect(page.getByText(/Начнём с места:.*Выключи своего Моцарта/)).toBeVisible();
  await page.getByRole('button', { name: 'Начать' }).click();
  await expect(page.locator('.mine-line')).toContainText('В с М.');
  await expect(page).not.toHaveURL(/at=/);
});
