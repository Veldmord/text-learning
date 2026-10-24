// FR-07. Настройки озвучки (раздел 6.2) — общие для экрана настроек и листа настроек сессии.
import type { CueLength, DirectionsMode } from '../../engine/audio-plan';
import { NARRATOR } from '../../engine/audio-plan';
import { useApp, useSettings } from '../../app/store';
import { RangeField, Segmented, Switch } from '../../app/ui';

export const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];
export const formatSpeed = (v: number) => `${v.toLocaleString('ru-RU')}×`;

export function DirectionsSetting() {
  const directions = useSettings((s) => s.directions);
  const update = useSettings((s) => s.update);
  return (
    <Segmented<DirectionsMode>
      label="Ремарки"
      value={directions}
      onChange={(v) => update({ directions: v })}
      options={[
        { value: 'skip', label: 'Пропускать' },
        { value: 'text', label: 'Текстом' },
        { value: 'voice', label: 'Голосом рассказчика' },
      ]}
    />
  );
}

export function VoiceSettings({ compact = false }: { compact?: boolean }) {
  const s = useSettings();
  const index = useApp((x) => x.index);
  const speaking = index?.play.characters.filter((c) => c.speaking) ?? [];
  return (
    <div>
      <RangeField label="Скорость" min={0.75} max={2} step={0.25} value={s.speed} format={formatSpeed} onChange={(v) => s.update({ speed: v })} hint="Высота голоса при ускорении сохраняется" />
      <Segmented<CueLength>
        label="Длина подсказки"
        value={s.cueLength}
        onChange={(v) => s.update({ cueLength: v })}
        options={[
          { value: 'full', label: 'Вся реплика' },
          { value: 'lastSentence', label: 'Последнее предложение' },
          { value: 'lastWords', label: `Последние ${s.cueWords} слов` },
          { value: 'textOnly', label: 'Только текст' },
        ]}
        hint="В «Первых буквах» и аудиопрогоне. В «Прогоне с буквами» реплики звучат целиком, «Только текст» выключает звук."
      />
      {s.cueLength === 'lastWords' && <RangeField label="Слов в подсказке" min={5} max={20} step={1} value={s.cueWords} onChange={(v) => s.update({ cueWords: v })} />}
      <DirectionsSetting />
      <RangeField
        label="Контекст: начинать за N реплик до моей"
        min={0}
        max={5}
        step={1}
        value={s.context}
        onChange={(v) => s.update({ context: v })}
        hint={s.context === 0 ? 'Без звука: подсказка только текстом' : s.context === 1 ? 'Звучит только реплика-подсказка' : undefined}
      />
      <Switch label="Автопереход" hint="После конца подсказки сразу перейти к своей реплике" checked={s.autoAdvance} onChange={(v) => s.update({ autoAdvance: v })} />
      <RangeField label="Пауза между репликами" min={0} max={1000} step={100} value={s.pauseMs} format={(v) => `${(v / 1000).toLocaleString('ru-RU')} с`} onChange={(v) => s.update({ pauseMs: v })} />
      <Switch label="«Эхо»" hint="После «Открыть» озвучить свою реплику" checked={s.echo} onChange={(v) => s.update({ echo: v })} />
      <Switch label="Пропускать сцены без моей роли" hint="В прогонах такие сцены не звучат, в тексте свёрнуты" checked={s.skipScenesWithoutRole} onChange={(v) => s.update({ skipScenesWithoutRole: v })} />
      <RangeField
        label="Пауза в аудиопрогоне"
        min={0.8}
        max={2}
        step={0.1}
        value={s.audioRunK}
        format={(v) => `× ${v.toLocaleString('ru-RU')}`}
        onChange={(v) => s.update({ audioRunK: v })}
        hint="Тишина на своей реплике = длительность реплики × k"
      />
      {!compact && (
        <details>
          <summary className="field__label" style={{ minHeight: 44, display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            Скорость по персонажам
          </summary>
          {[...speaking.map((c) => ({ id: c.id, name: c.name })), { id: NARRATOR, name: 'Рассказчик (ремарки)' }].map((c) => (
            <RangeField
              key={c.id}
              label={c.name}
              min={0.5}
              max={1.5}
              step={0.05}
              value={s.characterRate[c.id] ?? 1}
              format={(v) => `× ${v.toLocaleString('ru-RU', { maximumFractionDigits: 2 })}`}
              onChange={(v) => s.update({ characterRate: { ...s.characterRate, [c.id]: v } })}
            />
          ))}
        </details>
      )}
    </div>
  );
}
