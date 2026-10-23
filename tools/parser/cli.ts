// npm run parse [-- --validate] [-- --update-snapshot]
// content/raiskie-vrata.txt + content/*.yaml → src/data/play.json
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { gzipSync } from 'node:zlib';
import { compactPlay, hydratePlay, type Cast } from '../../src/engine/play-format';
import { buildPlay, ROOT, SNAPSHOT_FILE } from './build';
import { computeCounts, diffCounts, type Counts } from './validate';

const args = new Set(process.argv.slice(2));
const updateSnapshot = args.has('--update-snapshot');
const outFile = resolve(ROOT, 'src/data/play.json');

const { play, errors } = buildPlay();
const counts = computeCounts(play.items);

if (updateSnapshot || !existsSync(SNAPSHOT_FILE)) {
  mkdirSync(dirname(SNAPSHOT_FILE), { recursive: true });
  writeFileSync(SNAPSHOT_FILE, `${JSON.stringify(counts, null, 2)}\n`);
  console.log(`Снапшот численности записан: ${SNAPSHOT_FILE}`);
} else {
  const expected = JSON.parse(readFileSync(SNAPSHOT_FILE, 'utf8')) as Counts;
  errors.push(...diffCounts(expected, counts).map((d) => `Снапшот: ${d}`));
}

if (errors.length) {
  console.error('Разбор пьесы не прошёл валидацию:');
  for (const e of errors) console.error(`  • ${e}`);
  console.error('Исправьте текст, content/overrides.yaml или content/scenes.yaml. Снапшот обновляется флагом --update-snapshot.');
  process.exit(1);
}

const stored = compactPlay(play);
const roundTrip = hydratePlay(JSON.parse(JSON.stringify(stored)) as typeof stored);
if (!isDeepStrictEqual(roundTrip.items, play.items)) {
  console.error('Компактный play.json не восстанавливается в исходную модель');
  process.exit(1);
}
const json = JSON.stringify(stored);
mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, json);

// Состав для стартового экрана: выбор роли рисуется сразу, не дожидаясь play.json (LCP, NFR-01)
const cast: Cast = {
  title: play.title,
  author: play.author,
  subtitle: play.subtitle,
  characters: play.characters.map((c) => ({
    id: c.id,
    name: c.name,
    ...(c.group ? { group: c.group } : {}),
    speaking: c.speaking,
    lines: counts.lines[c.id] ?? 0,
    words: counts.words[c.id] ?? 0,
  })),
};
writeFileSync(resolve(dirname(outFile), 'cast.json'), JSON.stringify(cast));
const gz = gzipSync(json).length;
const scenes = play.acts.reduce((n, a) => n + a.scenes.length, 0);
console.log(
  `play.json: реплик ${counts.totalLines} (+${counts.continuations} продолжений), ремарок ${counts.directions}, ` +
    `сцен ${scenes}; ${(Buffer.byteLength(json) / 1024).toFixed(0)} КБ, gzip ${(gz / 1024).toFixed(1)} КБ`,
);
if (gz > 80 * 1024) {
  console.error('play.json превышает бюджет 80 КБ gzip (NFR-01)');
  process.exit(1);
}
