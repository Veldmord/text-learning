import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { chooseRole, stubSpeech, waitForServiceWorker } from './helpers';

test.beforeEach(async ({ page }) => stubSpeech(page));

test('офлайн: после первого визита приложение и тренировка работают без сети', async ({ page, context }) => {
  await page.goto('./');
  await waitForServiceWorker(page);
  await context.setOffline(true);
  await page.reload();
  await chooseRole(page, 'Дама');
  await page.getByRole('link', { name: /Первые буквы/ }).click();
  await page.getByRole('button', { name: 'Начать' }).click();
  await page.getByRole('button', { name: /^Открыть/ }).click();
  await page.getByRole('button', { name: /Далее/ }).click();
  await expect(page.getByText(/^2 \/ \d+$/)).toBeVisible();
  await context.setOffline(false);
});

test('экспорт и импорт прогресса JSON-файлом', async ({ page, browser }, testInfo) => {
  await chooseRole(page, 'Женщина');
  await page.getByRole('link', { name: /Первые буквы/ }).click();
  await page.getByRole('button', { name: 'Начать' }).click();
  await page.getByRole('button', { name: /^Открыть/ }).click();
  await page.getByRole('button', { name: /Далее/ }).click();
  await expect(page.getByText(/^2 \/ \d+$/)).toBeVisible();
  await page.getByRole('button', { name: /^Открыть/ }).click();

  // Своя реплика в избранное — из текста; уход с экрана записывает и вторую реплику
  await page.goto('./#/r/zhenshchina/read');
  const first = page.locator('.item--mine').first();
  await first.locator('.text-line').click();
  await first.getByRole('button', { name: 'В избранное' }).click();
  await expect(first.getByRole('img', { name: 'В избранном' })).toBeVisible();

  await page.goto('./#/settings');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Сохранить в файл' }).click();
  const file = testInfo.outputPath('backup.json');
  await (await download).saveAs(file);
  const backup = JSON.parse(readFileSync(file, 'utf8'));
  expect(backup).toMatchObject({ format: 'text-learning-backup', version: 2, playId: 'raiskie-vrata' });
  expect(backup.sessions).toHaveLength(1);
  expect(backup.favorites).toHaveLength(1);

  // Другое «устройство»: чистый контекст
  const other = await browser.newContext();
  const page2 = await other.newPage();
  await stubSpeech(page2);
  await page2.goto('./#/settings');
  await page2.getByLabel('Загрузить из файла').setInputFiles(file);
  await expect(page2.getByText(/Импортировано: тренировок 1, избранного 1/)).toBeVisible();
  await page2.goto('./#/r/zhenshchina/stats');
  await expect(page2.locator('.kpi').filter({ hasText: 'своих реплик сказано' })).toContainText('2');
  await page2.goto('./#/r/zhenshchina');
  await expect(page2.getByRole('link', { name: /Избранное · 1/ })).toBeVisible();
  await other.close();
});
