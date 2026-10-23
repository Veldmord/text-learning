// npm run check:size — размер опубликованного сайта (NFR-10): dist/ ≤ лимита в МБ. Лимит Pages — 1 ГБ.
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dir = resolve(process.argv[2] ?? 'dist');
const limitMb = Number(process.argv[3] ?? 100);

function walk(path) {
  return readdirSync(path).reduce((sum, name) => {
    const p = join(path, name);
    const st = statSync(p);
    return sum + (st.isDirectory() ? walk(p) : st.size);
  }, 0);
}

const bytes = walk(dir);
const mb = bytes / 1024 / 1024;
const audio = (() => {
  try {
    return walk(join(dir, 'audio')) / 1024 / 1024;
  } catch {
    return 0;
  }
})();
console.log(`${dir}: ${mb.toFixed(1)} МБ (аудио ${audio.toFixed(1)} МБ), лимит ${limitMb} МБ`);
if (mb > limitMb) {
  console.error(`Сайт больше ${limitMb} МБ — проверьте аудио и ассеты`);
  process.exit(1);
}
