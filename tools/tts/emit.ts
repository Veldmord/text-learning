// npx tsx tools/tts/emit.ts --cache .tts-cache --out public/audio
// Копирует готовые клипы из кэша в public/audio/<хэш>.mp3 и пишет audio-manifest.json (раздел 9.3).
// Клипов, которых нет в кэше, нет и в манифесте — их озвучит голос браузера.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AudioManifest } from '../../src/engine/types';
import { mp3DurationMs } from './mp3';
import { argValue, ROOT } from './voices';

const cache = resolve(ROOT, argValue('--cache', '.tts-cache'));
const out = resolve(ROOT, argValue('--out', 'public/audio'));
const planFile = resolve(cache, 'plan.json');
if (!existsSync(planFile)) {
  console.error(`Нет ${planFile} — сначала tools/tts/plan.ts`);
  process.exit(1);
}
const plan = JSON.parse(readFileSync(planFile, 'utf8')) as { pipelineVersion: number; clips: Record<string, string> };
mkdirSync(out, { recursive: true });

const manifest: AudioManifest = { pipelineVersion: plan.pipelineVersion, clips: {}, silence: 'silence-1000.mp3' };
const used = new Set<string>();
let missing = 0;
let bytes = 0;
for (const [sentenceId, key] of Object.entries(plan.clips)) {
  const src = resolve(cache, `${key}.mp3`);
  if (!existsSync(src)) {
    missing++;
    continue;
  }
  const file = `${key}.mp3`;
  if (!used.has(file)) {
    const dst = resolve(out, file);
    if (!existsSync(dst) || statSync(dst).size !== statSync(src).size) copyFileSync(src, dst);
    bytes += statSync(src).size;
    used.add(file);
  }
  const sidecar = resolve(cache, `${key}.json`);
  const ms = existsSync(sidecar) ? (JSON.parse(readFileSync(sidecar, 'utf8')) as { ms: number }).ms : mp3DurationMs(readFileSync(src));
  manifest.clips[sentenceId] = { f: file, ms: Math.round(ms) };
}

// Удаляем клипы прошлых сборок, которых нет в плане
for (const f of readdirSync(out)) {
  if (f.endsWith('.mp3') && !used.has(f)) rmSync(resolve(out, f));
}
writeFileSync(resolve(out, 'audio-manifest.json'), JSON.stringify(manifest));
console.log(
  `audio: ${used.size} клипов, ${(bytes / 1024 / 1024).toFixed(1)} МБ; в манифесте ${Object.keys(manifest.clips).length} предложений` +
    (missing ? `, без клипа ${missing} (озвучит голос браузера)` : ''),
);
