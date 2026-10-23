// Фолбэк озвучки голосом браузера (раздел 10): по одному предложению — Chrome обрывает длинные фразы.
// Голос выбирается по lang = ru-RU и полу персонажа; персонажам с общим голосом даём разную высоту.
import type { Gender } from '../engine/types';
import { hash32 } from '../engine/text-transforms';

const FEMALE = /(milena|irina|svetlana|katya|ekaterina|alena|alyona|anna|tatyana|daria|dariya|elena|female|женск|google русский)/i;
const MALE = /(yuri|pavel|maxim|dmitr|denis|artem|alexander|male|мужск)/i;

export interface VoiceSpec {
  gender: Gender;
  /** Ключ для вариации высоты: id персонажа */
  key: string;
}

export function synthesisAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

function russianVoices(): SpeechSynthesisVoice[] {
  if (!synthesisAvailable()) return [];
  return window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith('ru'));
}

export function pickVoice(spec: VoiceSpec, voices = russianVoices()): { voice: SpeechSynthesisVoice | null; pitch: number } {
  const byGender = voices.filter((v) => (spec.gender === 'f' ? FEMALE.test(v.name) : MALE.test(v.name) && !FEMALE.test(v.name)));
  const pool = byGender.length ? byGender : voices;
  const h = hash32(spec.key);
  const voice = pool.length ? pool[h % pool.length]! : null;
  // Если голоса нужного пола нет, смещаем высоту; плюс небольшая вариация по персонажу
  const base = byGender.length ? 1 : spec.gender === 'm' ? 0.8 : 1.2;
  const pitch = Math.min(2, Math.max(0.1, base + (((h >>> 8) % 21) - 10) / 100));
  return { voice, pitch };
}

/** Speech Synthesis иногда не присылает onend — страхуемся таймером по оценке длительности. */
const watchdogMs = (text: string, rate: number) => ((text.length / 10) * 1000) / Math.max(rate, 0.5) + 4000;

interface Current {
  finish: (ok: boolean) => void;
  arm: () => void;
  disarm: () => void;
}

export class TtsFallback {
  private current: Current | null = null;

  speak(text: string, spec: VoiceSpec, rate: number): Promise<boolean> {
    if (!synthesisAvailable() || !text.trim()) return Promise.resolve(true);
    const synth = window.speechSynthesis;
    return new Promise<boolean>((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      const { voice, pitch } = pickVoice(spec);
      u.lang = voice?.lang ?? 'ru-RU';
      if (voice) u.voice = voice;
      u.pitch = pitch;
      u.rate = Math.min(4, Math.max(0.5, rate));
      let done = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const current: Current = {
        finish: (ok) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          if (this.current === current) this.current = null;
          resolve(ok);
        },
        arm: () => {
          clearTimeout(timer);
          timer = setTimeout(() => current.finish(true), watchdogMs(text, rate));
        },
        disarm: () => clearTimeout(timer),
      };
      this.current = current;
      current.arm();
      u.onend = () => current.finish(true);
      u.onerror = (e) => current.finish(e.error !== 'interrupted' && e.error !== 'canceled');
      synth.speak(u);
    });
  }

  cancel(): void {
    this.current?.finish(false);
    if (synthesisAvailable()) window.speechSynthesis.cancel();
  }

  pause(): void {
    this.current?.disarm();
    if (synthesisAvailable()) window.speechSynthesis.pause();
  }

  /** false — нечего продолжать */
  resume(): boolean {
    if (!synthesisAvailable() || !this.current) return false;
    this.current.arm();
    window.speechSynthesis.resume();
    return true;
  }
}
