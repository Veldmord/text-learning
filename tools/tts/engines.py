"""Движки синтеза. Интерфейс один — TtsEngine.synthesize(text, voice) -> WAV, поэтому
замена Silero на Piper (например, из-за лицензии) не затрагивает клиент."""

from __future__ import annotations

import io
import os
import urllib.request
import wave
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Voice:
    engine: str
    #: silero: "v5_ru:xenia"; piper: "ru_RU-denis-medium"
    name: str
    rate: float = 1.0


class TtsEngine(ABC):
    """Синтезирует одно предложение в WAV (моно, PCM 16 бит)."""

    #: Движок сам меняет темп (иначе темп меняет ffmpeg atempo)
    handles_rate = False

    @abstractmethod
    def synthesize(self, text: str, voice: Voice) -> bytes: ...


def wav_bytes(samples_int16: bytes, sample_rate: int) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(samples_int16)
    return buf.getvalue()


class SileroEngine(TtsEngine):
    """Silero TTS (CC BY-NC 4.0): русские голоса, сам расставляет ударения и «ё», понимает «+» перед ударной гласной."""

    SAMPLE_RATE = 48_000

    def __init__(self) -> None:
        import torch  # тяжёлый импорт — только при реальном синтезе

        self._torch = torch
        torch.set_num_threads(max(1, os.cpu_count() or 1))
        self._models: dict[str, object] = {}

    def _model(self, model_id: str):
        if model_id not in self._models:
            model, _ = self._torch.hub.load(
                repo_or_dir="snakers4/silero-models",
                model="silero_tts",
                language="ru",
                speaker=model_id,
                trust_repo=True,
            )
            model.to(self._torch.device("cpu"))
            self._models[model_id] = model
        return self._models[model_id]

    def synthesize(self, text: str, voice: Voice) -> bytes:
        model_id, _, speaker = voice.name.partition(":")
        audio = self._model(model_id).apply_tts(
            text=text,
            speaker=speaker,
            sample_rate=self.SAMPLE_RATE,
            put_accent=True,
            put_yo=True,
        )
        pcm = (audio.clamp(-1, 1) * 32767).to(self._torch.int16).numpy().tobytes()
        return wav_bytes(pcm, self.SAMPLE_RATE)


class PiperEngine(TtsEngine):
    """Piper (MIT) с голосами ru_RU; лицензию каждого голоса проверяйте по карточке модели."""

    handles_rate = True
    BASE_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/main"

    def __init__(self, voices_dir: Path | None = None) -> None:
        default_dir = Path.home() / ".cache" / "piper-voices"
        self._dir = voices_dir or Path(os.environ.get("PIPER_VOICES_DIR", default_dir))
        self._dir.mkdir(parents=True, exist_ok=True)
        self._voices: dict[str, object] = {}

    @staticmethod
    def voice_path(name: str) -> str:
        """ru_RU-denis-medium → ru/ru_RU/denis/medium/ru_RU-denis-medium"""
        lang, speaker, quality = name.split("-", 2)
        return f"{lang.split('_')[0]}/{lang}/{speaker}/{quality}/{name}"

    def _download(self, name: str) -> Path:
        for suffix in (".onnx", ".onnx.json"):
            target = self._dir / f"{name}{suffix}"
            if not target.exists():
                url = f"{self.BASE_URL}/{self.voice_path(name)}{suffix}"
                print(f"  загрузка голоса {url}")
                urllib.request.urlretrieve(url, target)  # noqa: S310 — фиксированный адрес HuggingFace
        return self._dir / f"{name}.onnx"

    def _voice(self, name: str):
        if name not in self._voices:
            from piper import PiperVoice

            self._voices[name] = PiperVoice.load(str(self._download(name)))
        return self._voices[name]

    def synthesize(self, text: str, voice: Voice) -> bytes:
        pv = self._voice(voice.name)
        length_scale = 1.0 / max(voice.rate, 0.1)
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            try:
                from piper import SynthesisConfig  # piper-tts ≥ 1.3

                pv.synthesize_wav(text, wf, syn_config=SynthesisConfig(length_scale=length_scale))
            except ImportError:
                pv.synthesize(text, wf, length_scale=length_scale)
        return buf.getvalue()


def make_engine(name: str) -> TtsEngine:
    if name == "silero":
        return SileroEngine()
    if name == "piper":
        return PiperEngine()
    raise ValueError(f"Неизвестный движок синтеза: {name}")
