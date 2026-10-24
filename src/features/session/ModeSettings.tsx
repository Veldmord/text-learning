// Настройки, которые меняют ход самого режима: вариант прогона с буквами и вариант аудиопрогона.
import type { AudioRunSpan } from '../../engine/audio-plan';
import { RUN_FLOWS, type ModeId, type RunFlow } from '../../engine/modes';
import { useSettings } from '../../app/store';
import { Segmented, Switch } from '../../app/ui';

export function RunFlowSetting() {
  const value = useSettings((s) => s.runFlow);
  const update = useSettings((s) => s.update);
  return (
    <Segmented<RunFlow>
      label="Ход прогона"
      value={value}
      onChange={(runFlow) => update({ runFlow })}
      options={(Object.keys(RUN_FLOWS) as RunFlow[]).map((v) => ({ value: v, label: RUN_FLOWS[v].label }))}
      hint={RUN_FLOWS[value].hint}
    />
  );
}

export function AudioRunSetting({ onChange }: { onChange: (v: AudioRunSpan) => void }) {
  const value = useSettings((s) => s.audioRun);
  const skipScenes = useSettings((s) => s.skipScenesWithoutRole);
  const update = useSettings((s) => s.update);
  return (
    <>
      <Segmented<AudioRunSpan>
        label="Что звучит"
        value={value}
        onChange={onChange}
        options={[
          { value: 'cue', label: 'Подсказка → моя реплика' },
          { value: 'play', label: 'Вся пьеса' },
        ]}
        hint={
          value === 'cue'
            ? 'Звучит подсказка партнёра, на вашей реплике — пауза, затем прогон идёт дальше сам.'
            : 'Звучат все реплики подряд. На вашей реплике звук останавливается: скажите её и нажмите «Продолжить».'
        }
      />
      {value === 'play' && <SkipScenesSetting checked={skipScenes} onChange={(v) => update({ skipScenesWithoutRole: v })} />}
    </>
  );
}

function SkipScenesSetting({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <Switch
      label="Пропускать сцены без моей роли"
      hint={checked ? 'Звучат только сцены, где вы заняты' : 'Звучит вся пьеса с начала диапазона'}
      checked={checked}
      onChange={onChange}
    />
  );
}

/** Настройки хода режима: в «Прогоне с буквами» — по очереди или сразу к своим, в аудиопрогоне — что звучит. */
export function ModeSettings({ mode, onAudioRun }: { mode: ModeId; onAudioRun: (v: AudioRunSpan) => void }) {
  const runFlow = useSettings((s) => s.runFlow);
  const skipScenes = useSettings((s) => s.skipScenesWithoutRole);
  const update = useSettings((s) => s.update);
  if (mode === 'audio') return <AudioRunSetting onChange={onAudioRun} />;
  if (mode !== 'run') return null;
  return (
    <>
      <RunFlowSetting />
      {runFlow === 'all' && <SkipScenesSetting checked={skipScenes} onChange={(v) => update({ skipScenesWithoutRole: v })} />}
    </>
  );
}
