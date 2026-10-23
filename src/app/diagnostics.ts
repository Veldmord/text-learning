// «Сообщить о проблеме» без бэкенда (раздел 13): ссылка на новую задачу GitHub Issues
// с подставленными версией сборки, user agent и последними ошибками. Пользователь видит текст и отправляет сам.
import type { ErrorRow } from '../engine/model';

export const REPO_URL = 'https://github.com/Veldmord/text-learning';
export const BUILD = { version: __APP_VERSION__, sha: __BUILD_SHA__, date: __BUILD_DATE__ };

export function buildLabel(): string {
  return `${BUILD.version} (${BUILD.sha}, ${BUILD.date})`;
}

export function reportBody(errors: ErrorRow[], userAgent: string, extra = ''): string {
  const lines = [
    '### Что случилось',
    extra || '<!-- Опишите, что вы делали и что пошло не так -->',
    '',
    '### Окружение',
    `- Версия: ${buildLabel()}`,
    `- Браузер: ${userAgent}`,
    `- Установлено как приложение: ${typeof matchMedia !== 'undefined' && matchMedia('(display-mode: standalone)').matches ? 'да' : 'нет'}`,
    '',
    '### Последние ошибки',
  ];
  if (!errors.length) lines.push('нет');
  for (const e of errors.slice(0, 10)) {
    lines.push(`- ${new Date(e.ts).toISOString()} [${e.source}] ${e.message}`);
  }
  return lines.join('\n');
}

/** GitHub ограничивает длину URL — обрезаем тело задачи. */
export function issueUrl(title: string, body: string): string {
  const params = new URLSearchParams({ title, body: body.slice(0, 6000), labels: 'bug' });
  return `${REPO_URL}/issues/new?${params.toString()}`;
}

export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
