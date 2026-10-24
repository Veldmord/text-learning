// Режимы тренировки — docs/ARCHITECTURE.md, раздел 5.1.

export type ModeId = 'run' | 'letters' | 'audio';

/** Ход «Прогона с буквами»: все реплики по очереди или сразу к своим */
export type RunFlow = 'all' | 'mine';

export interface ModeDef {
  id: ModeId;
  title: string;
  short: string;
  description: string;
  when: string;
  icon: string;
}

export const MODES: Record<ModeId, ModeDef> = {
  run: {
    id: 'run',
    title: 'Прогон с буквами',
    short: 'Прогон',
    description:
      'Сцена идёт сверху вниз: реплики партнёров видны и звучат целиком, ваши — первыми буквами. «Далее» открывает вашу реплику, следующее «Далее» ведёт сцену дальше.',
    when: 'Связать реплики в сцену',
    icon: '📜',
  },
  letters: {
    id: 'letters',
    title: 'Первые буквы',
    short: 'Буквы',
    description: 'Звучит подсказка партнёра, своя реплика показана первыми буквами слов с пунктуацией. Восстановите текст и откройте целиком.',
    when: 'Первые проходы по своим репликам',
    icon: 'Аб',
  },
  audio: {
    id: 'audio',
    title: 'Аудиопрогон',
    short: 'Аудио',
    description: 'Только звук: партнёры звучат, на своей реплике — тишина, затем по желанию «эхо». Управление с гарнитуры.',
    when: 'Метро, прогулка, перед репетицией',
    icon: '🎧',
  },
};

/** Порядок режимов в интерфейсе */
export const TRAIN_MODES: ModeId[] = ['run', 'letters', 'audio'];

export const isModeId = (v: string | undefined): v is ModeId => !!v && Object.hasOwn(MODES, v);

export const RUN_FLOWS: Record<RunFlow, { label: string; hint: string }> = {
  all: {
    label: 'Все реплики по очереди',
    hint: 'Партнёры звучат по одной реплике, текст появляется по ходу сцены. На вашей реплике прогон останавливается: скажите её и нажмите «Далее».',
  },
  mine: {
    label: 'Сразу к моим репликам',
    hint: 'Сцена до вашей реплики видна сразу, всё сказанное после вашей прошлой реплики звучит подряд.',
  },
};
