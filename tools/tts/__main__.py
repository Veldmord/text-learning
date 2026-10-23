"""python -m tools.tts --cache .tts-cache

Синтезирует клипы из <cache>/jobs.json (их составляет tools/tts/plan.ts) в <cache>/<key>.mp3
и пишет рядом <key>.json с длительностью. Клипы, которые уже есть, не трогаются.
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .audio import require_ffmpeg, to_mp3
from .engines import Voice, make_engine


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        # консоль Windows по умолчанию не в UTF-8; построчный вывод — чтобы прогресс сразу виден в логе CI
        stream.reconfigure(encoding="utf-8", line_buffering=True)
    parser = argparse.ArgumentParser(prog="python -m tools.tts", description=__doc__)
    parser.add_argument("--cache", default=".tts-cache", help="каталог кэша клипов")
    parser.add_argument("--jobs", help="файл заданий (по умолчанию <cache>/jobs.json)")
    parser.add_argument("--limit", type=int, default=0, help="синтезировать не больше N клипов (для проверки на слух)")
    parser.add_argument("--dry-run", action="store_true", help="проверить задания без синтеза")
    args = parser.parse_args(argv)

    cache = Path(args.cache)
    jobs_file = Path(args.jobs) if args.jobs else cache / "jobs.json"
    if not jobs_file.exists():
        print(f"Нет {jobs_file} — сначала: npx tsx tools/tts/plan.ts --cache {cache}", file=sys.stderr)
        return 1
    jobs = [j for j in json.loads(jobs_file.read_text(encoding="utf-8")) if not (cache / f"{j['key']}.mp3").exists()]
    if args.limit:
        jobs = jobs[: args.limit]
    by_engine: dict[str, list[dict]] = defaultdict(list)
    for j in jobs:
        by_engine[j["engine"]].append(j)
    summary = ", ".join(f"{name}: {len(items)}" for name, items in by_engine.items()) or "нет"
    print(f"Клипов к синтезу: {len(jobs)} ({summary})")
    if args.dry_run or not jobs:
        return 0

    require_ffmpeg()
    started = time.monotonic()
    done = 0
    with tempfile.TemporaryDirectory() as tmp, ThreadPoolExecutor(max_workers=4) as pool:
        futures = []
        for engine_name, engine_jobs in by_engine.items():
            engine = make_engine(engine_name)
            for j in engine_jobs:
                voice = Voice(engine=engine_name, name=j["voice"], rate=float(j["rate"]))
                wav = Path(tmp) / f"{j['key']}.wav"
                wav.write_bytes(engine.synthesize(j["text"], voice))
                tempo = 1.0 if engine.handles_rate else voice.rate
                # ffmpeg работает параллельно с синтезом следующих фраз
                futures.append(pool.submit(finish, wav, cache, j["key"], tempo, float(j.get("pitch", 0))))
                done += 1
                if done % 50 == 0:
                    print(f"  синтезировано {done}/{len(jobs)} за {time.monotonic() - started:.0f} с")
        for f in futures:
            f.result()
    print(f"Готово: {done} клипов за {time.monotonic() - started:.0f} с")
    return 0


def finish(wav: Path, cache: Path, key: str, tempo: float, pitch: float) -> None:
    ms = to_mp3(wav, cache / f"{key}.mp3", tempo=tempo, pitch_semitones=pitch)
    (cache / f"{key}.json").write_text(json.dumps({"ms": ms}), encoding="utf-8")
    wav.unlink(missing_ok=True)


if __name__ == "__main__":
    sys.exit(main())
