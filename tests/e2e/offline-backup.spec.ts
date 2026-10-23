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
  await page.getByRole('link', { name: /По репликам/ }).first().click();
  await page.getByRole('button', { name: 'Начать' }).click();
  await page.getByRole('button', { name: /Показать/ }).click();
  await page.getByRole('button', { name: /^Знал/ }).click();
  await expect(page.getByText(/^2 \/ \d+$/)).toBeVisible();
  await context.setOffline(false);
});

test('экспорт и импорт прогресса JSON-файлом', async ({ page, browser }, testInfo) => {
  await chooseRole(page, 'Женщина');
  await page.getByRole('link', { name: /По репликам/ }).first().click();
  await page.getByRole('button', { name: 'Начать' }).click();
  await page.getByRole('button', { name: /Показать/ }).click();
  await page.getByRole('button', { name: /^Не знал/ }).click();
  await expect(page.getByText(/^2 \/ \d+$/)).toBeVisible();

  await page.goto('./#/settings');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Сохранить в файл' }).click();
  const file = testInfo.outputPath('backup.json');
  await (await download).saveAs(file);
  const backup = JSON.parse(readFileSync(file, 'utf8'));
  expect(backup).toMatchObject({ format: 'text-learning-backup', version: 1, playId: 'raiskie-vrata' });
  expect(backup.reviews).toHaveLength(1);

  // Другое «устройство»: чистый контекст
  const other = await browser.newContext();
  const page2 = await other.newPage();
  await stubSpeech(page2);
  await page2.goto('./#/settings');
  await page2.getByLabel('Загрузить из файла').setInputFiles(file);
  await expect(page2.getByText(/Импортировано: карточек 1, оценок 1/)).toBeVisible();
  await page2.goto('./#/r/zhenshchina/stats');
  await expect(page2.locator('.kpi').filter({ hasText: 'оценок всего' })).toContainText('1');
  await expect(page2.getByText('Проблемные реплики')).toBeVisible();
  await other.close();
});
