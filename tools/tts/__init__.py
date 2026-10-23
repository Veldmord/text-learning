"""Синтез голосов для «Учить текст» (docs/ARCHITECTURE.md, раздел 9.3).

План клипов строит tools/tts/plan.ts (без Python) и пишет <cache>/jobs.json.
Этот пакет синтезирует недостающие клипы: TtsEngine (Silero или Piper) → ffmpeg → <cache>/<key>.mp3.
"""
