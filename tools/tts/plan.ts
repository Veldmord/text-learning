// npx tsx tools/tts/plan.ts --cache .tts-cache
// Какие клипы нужны и каких нет в кэше. Пишет <cache>/plan.json (предложение → клип) и <cache>/jobs.json
// (только недостающие), в stdout — `missing=N` для $GITHUB_OUTPUT. Python ставится, только если N > 0.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { argValue, buildJobs, loadInputs, PIPELINE_VERSION, ROOT } from './voices';

const cache = resolve(ROOT, argValue('--cache', '.tts-cache'));
mkdirSync(cache, { recursive: true });

const { play, voices, dict } = loadInputs();
const jobs = buildJobs(play, voices, dict);
const unique = new Map(jobs.map((j) => [j.key, j]));
const missing = [...unique.values()].filter((j) => !existsSync(resolve(cache, `${j.key}.mp3`)));

writeFileSync(
  resolve(cache, 'plan.json'),
  JSON.stringify({ pipelineVersion: PIPELINE_VERSION, sourceHash: play.sourceHash, clips: Object.fromEntries(jobs.map((j) => [j.sentenceId, j.key])) }),
);
writeFileSync(resolve(cache, 'jobs.json'), JSON.stringify(missing, null, 1));

const chars = missing.reduce((n, j) => n + j.text.length, 0);
console.error(
  `TTS: предложений ${jobs.length}, уникальных клипов ${unique.size}, в кэше ${unique.size - missing.length}, ` +
    `сгенерировать ${missing.length} (~${Math.round(chars / 14 / 60)} мин речи)`,
);
console.log(`missing=${missing.length}`);
