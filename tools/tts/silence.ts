// npm run silence — public/silence-1000.mp3: секунда тишины без ffmpeg.
// Кадры MPEG-1 Layer III, 48 кГц, 32 кбит/с, моно: нулевая side info и пустые main data — валидная тишина.
// Клип заполняет паузы в аудиопрогоне, чтобы iOS не усыплял аудиосессию (раздел 10).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function silenceMp3(ms = 1000): Buffer {
  const SAMPLES_PER_FRAME = 1152;
  const SAMPLE_RATE = 48_000;
  const FRAME_BYTES = 96; // 144 * 32000 / 48000
  const frames = Math.ceil((ms / 1000) * (SAMPLE_RATE / SAMPLES_PER_FRAME));
  const frame = Buffer.alloc(FRAME_BYTES);
  // sync 0xFFF, MPEG-1, Layer III, без CRC | 32 кбит/с, 48 кГц | моно
  frame.set([0xff, 0xfb, 0x14, 0xc4]);
  return Buffer.concat(Array.from({ length: frames }, () => frame));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const out = resolve(process.argv[2] ?? 'public/silence-1000.mp3');
  mkdirSync(dirname(out), { recursive: true });
  const data = silenceMp3(1000);
  writeFileSync(out, data);
  console.log(`${out}: ${data.length} байт`);
}
