/// <reference types="vitest/config" />
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

function gitSha(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'local';
  }
}

/** Тема до первого рендера: встроенный скрипт без лишнего блокирующего запроса (LCP, NFR-01). */
const THEME_INIT = readFileSync(new URL('./src/app/theme-init.js', import.meta.url), 'utf8')
  .split(/\r?\n/)
  .filter((l) => !l.trim().startsWith('//'))
  .join(' ')
  .replace(/\s+/g, ' ')
  .trim();
const THEME_INIT_HASH = createHash('sha256').update(THEME_INIT).digest('base64');

function themeInitPlugin(): Plugin {
  return {
    name: 'text-learning-theme-init',
    transformIndexHtml: (html) => html.replace('<!--theme-init-->', `<script>${THEME_INIT}</script>`),
  };
}

/** CSP задаётся через <meta>: GitHub Pages не позволяет задавать заголовки (раздел 13). Только в сборке —
 * в dev-режиме React Refresh вставляет inline-скрипт. Единственный inline-скрипт разрешён по хэшу. */
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'sha256-${THEME_INIT_HASH}'`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

function cspPlugin(): Plugin {
  return {
    name: 'text-learning-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replace('<!--csp-->', `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
    },
  };
}

const base = process.env.VITE_BASE ?? '/text-learning/';

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_SHA__: JSON.stringify(gitSha()),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  plugins: [
    react(),
    themeInitPlugin(),
    cspPlugin(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        id: base,
        name: 'Учить текст — «Райские врата»',
        short_name: 'Учить текст',
        description: 'Тренажёр роли: подсказки партнёров нейроголосами, интервальное повторение, офлайн.',
        lang: 'ru',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#16141f',
        theme_color: '#16141f',
        categories: ['education', 'entertainment'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,json,mp3}'],
        // Клипы озвучки не входят в precache: они кэшируются по запросу и через «Скачать роль»
        globIgnores: ['audio/*.mp3'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        // Первый визит сразу под контролем SW (офлайн с первого раза); обновления ждут подтверждения — skipWaiting выключен
        clientsClaim: true,
        navigateFallback: null,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/audio/') && url.pathname.endsWith('.mp3'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'audio-v1',
              cacheableResponse: { statuses: [200] },
              rangeRequests: true,
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    target: ['es2022', 'safari16'],
    sourcemap: true,
    chunkSizeWarningLimit: 600,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'tests/unit/**/*.test.{ts,tsx}', 'tools/**/*.test.ts'],
    setupFiles: ['tests/unit/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/engine/**/*.ts'],
      exclude: ['src/engine/types.ts'],
      thresholds: { lines: 90 },
      reporter: ['text-summary', 'html'],
    },
  },
});
