"""Постобработка ffmpeg (раздел 9.3): обрезка тишины по краям, темп, сдвиг высоты,
выравнивание громкости loudnorm до −16 LUFS, MP3 48 кбит/с моно 24 кГц."""

from __future__ import annotations

import json
import shutil
import subprocess
from functools import lru_cache
from pathlib import Path

TRIM = "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05"
LOUDNORM = "loudnorm=I=-16:TP=-1.5:LRA=11"
# loudnorm (ffmpeg 6.1) навсегда встаёт в конце потока, если после первых 3 с и целых 100-мс блоков остаётся
# хвост в несколько сэмплов — так выходит у клипов длиной ровно кратной 100 мс. Перед ним дополняем поток
# тишиной до кратного 25 мс на 192 кГц (частота loudnorm): хвост тогда 0, 25, 50 или 75 мс.
PAD = "aformat=sample_fmts=dbl:sample_rates=192000,asetnsamples=n=4800"
#: Клип — одна фраза, ffmpeg обычно укладывается в доли секунды; зависший процесс — ошибка с командой в тексте
TIMEOUT = 120


def require_ffmpeg() -> None:
    for tool in ("ffmpeg", "ffprobe"):
        if not shutil.which(tool):
            raise SystemExit(f"Не найден {tool}: установите ffmpeg (apt install ffmpeg / winget install ffmpeg)")


@lru_cache(maxsize=1)
def has_rubberband() -> bool:
    result = subprocess.run(
        ["ffmpeg", "-nostdin", "-hide_banner", "-filters"], capture_output=True, text=True, check=False, timeout=TIMEOUT
    )
    return " rubberband " in result.stdout


def filter_chain(tempo: float, pitch_semitones: float, rubberband: bool | None = None) -> str:
    filters = [TRIM, "areverse", TRIM, "areverse"]
    if abs(tempo - 1) > 1e-3:
        filters.append(f"atempo={tempo:.4f}")
    if pitch_semitones:
        ratio = 2 ** (pitch_semitones / 12)
        if has_rubberband() if rubberband is None else rubberband:
            filters.append(f"rubberband=pitch={ratio:.5f}")
        else:
            # Без librubberband: меняем частоту дискретизации и возвращаем темп
            filters.append(f"asetrate=48000*{ratio:.5f},aresample=48000,atempo={1 / ratio:.5f}")
    filters += [PAD, LOUDNORM]
    return ",".join(filters)


def to_mp3(wav: Path, mp3: Path, tempo: float = 1.0, pitch_semitones: float = 0) -> int:
    """Кодирует клип и возвращает его длительность в миллисекундах."""
    tmp = mp3.with_suffix(".tmp.mp3")
    subprocess.run(
        [
            # -nostdin: параллельные ffmpeg не читают общий stdin в ожидании клавиш
            "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(wav),
            "-af", filter_chain(tempo, pitch_semitones),
            "-ac", "1", "-ar", "24000",
            "-c:a", "libmp3lame", "-b:a", "48k",
            "-map_metadata", "-1", "-id3v2_version", "0", "-write_xing", "0",
            str(tmp),
        ],
        check=True,
        timeout=TIMEOUT,
    )
    tmp.replace(mp3)
    return duration_ms(mp3)


def duration_ms(path: Path) -> int:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(path)],
        capture_output=True,
        text=True,
        check=True,
        timeout=TIMEOUT,
    )
    return round(float(json.loads(result.stdout)["format"]["duration"]) * 1000)
