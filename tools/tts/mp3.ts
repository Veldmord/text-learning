// Длительность MP3 без ffprobe: считаем кадры MPEG Audio (подходит для CBR и VBR без Xing-заголовка).
const BITRATES: Record<string, number[]> = {
  // [версия][слой] → кбит/с по индексу
  'v1l3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  'v2l3': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const SAMPLE_RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

export function mp3DurationMs(buf: Buffer): number {
  let i = 0;
  // Пропускаем ID3v2
  if (buf.length > 10 && buf.toString('latin1', 0, 3) === 'ID3') {
    const size = ((buf[6]! & 0x7f) << 21) | ((buf[7]! & 0x7f) << 14) | ((buf[8]! & 0x7f) << 7) | (buf[9]! & 0x7f);
    i = 10 + size;
  }
  let samples = 0;
  let rate = 0;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff || (buf[i + 1]! & 0xe0) !== 0xe0) {
      i++;
      continue;
    }
    const version = (buf[i + 1]! >> 3) & 0x03; // 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5
    const layer = (buf[i + 1]! >> 1) & 0x03; // 1 = Layer III
    const bitrateIdx = buf[i + 2]! >> 4;
    const rateIdx = (buf[i + 2]! >> 2) & 0x03;
    const padding = (buf[i + 2]! >> 1) & 0x01;
    const sr = SAMPLE_RATES[version]?.[rateIdx];
    const table = version === 3 ? BITRATES.v1l3 : BITRATES.v2l3;
    const kbps = table?.[bitrateIdx];
    if (layer !== 1 || !sr || !kbps) {
      i++;
      continue;
    }
    const perFrame = version === 3 ? 1152 : 576;
    const frameLen = Math.floor(((version === 3 ? 144 : 72) * kbps * 1000) / sr) + padding;
    samples += perFrame;
    rate = sr;
    i += frameLen;
  }
  return rate ? (samples / rate) * 1000 : 0;
}
