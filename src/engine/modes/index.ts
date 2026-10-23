// Режимы тренировки — docs/ARCHITECTURE.md, раздел 5.1.

export type ModeId = 'read' | 'letters' | 'run' | 'vanish' | 'chunks' | 'cue' | 'audio' | 'weak' | 'order' | 'type';

export interface ModeDef {
  id: ModeId;
  title: string;
  short: string;
  description: string;
  /** Научная или практическая основа */
  basis: string;
  when: string;
  /** Оценка обновляет расписание FSRS (только режимы со свободным вспоминанием) */
  affectsFsrs: boolean;
  /** Перед своей репликой звучат контекст и подсказка партнёра */
  playsCue: boolean;
  /** Есть оценка «Знал / С ошибкой / Не знал» */
  graded: boolean;
  /** «Не знал» повторяет тот же шаг */
  repeatOnAgain: boolean;
  icon: string;
}

export const MODES: Record<ModeId, ModeDef> = {
  read: {
    id: 'read',
    title: 'Знакомство',
    short: 'Читка',
    description: 'Вся пьеса с подсвеченной ролью. Слушайте все голоса и записывайте, зачем персонаж говорит каждую реплику.',
    basis: 'Active experiencing',
    when: 'Первая встреча со сценой',
    affectsFsrs: false,
    playsCue: false,
    graded: false,
    repeatOnAgain: false,
    icon: '📖',
  },
  letters: {
    id: 'letters',
    title: 'Первые буквы',
    short: 'Буквы',
    description: 'Своя реплика показана первыми буквами слов с пунктуацией. Восстановите текст и откройте целиком.',
    basis: 'Практика актёров',
    when: 'Первые 2–3 прохода',
    affectsFsrs: false,
    playsCue: true,
    graded: true,
    repeatOnAgain: false,
    icon: 'Аб',
  },
  run: {
    id: 'run',
    title: 'Прогон с буквами',
    short: 'Прогон',
    description:
      'Сцена идёт сверху вниз: реплики партнёров видны и звучат целиком, ваши — первыми буквами. «Далее» открывает вашу реплику, следующее «Далее» ведёт сцену дальше.',
    basis: 'Практика актёров + контекст сцены',
    when: 'Связать реплики в сцену',
    affectsFsrs: false,
    playsCue: true,
    graded: true,
    repeatOnAgain: false,
    icon: '📜',
  },
  vanish: {
    id: 'vanish',
    title: 'Исчезающий текст',
    short: 'Исчезание',
    description: 'Скрыто 25, 50, 75 или 100 % слов. Уровень растёт после двух «Знал» подряд и падает после «Не знал».',
    basis: 'Vanishing cues',
    when: 'Закрепление',
    affectsFsrs: false,
    playsCue: true,
    graded: true,
    repeatOnAgain: false,
    icon: '◐',
  },
  chunks: {
    id: 'chunks',
    title: 'Монолог по частям',
    short: 'По частям',
    description: 'Длинная реплика учится наращиванием: 1 → 1+2 → 1+2+3. На каждом шаге — вспомнить, показать, оценить.',
    basis: 'Chunking',
    when: 'Реплики длиннее 40 слов',
    affectsFsrs: false,
    playsCue: true,
    graded: true,
    repeatOnAgain: true,
    icon: '☰',
  },
  cue: {
    id: 'cue',
    title: 'По репликам',
    short: 'По репликам',
    description: 'Звучит подсказка партнёра, своя реплика скрыта. Вспомните, откройте и честно оцените.',
    basis: 'Retrieval practice',
    when: 'Основной режим',
    affectsFsrs: true,
    playsCue: true,
    graded: true,
    repeatOnAgain: false,
    icon: '🎭',
  },
  audio: {
    id: 'audio',
    title: 'Аудиопрогон',
    short: 'Аудио',
    description: 'Только звук: партнёры звучат, на своей реплике — тишина, затем по желанию «эхо». Управление с гарнитуры.',
    basis: 'Retrieval + движение',
    when: 'Метро, прогулка, перед репетицией',
    affectsFsrs: false,
    playsCue: true,
    graded: false,
    repeatOnAgain: false,
    icon: '🎧',
  },
  weak: {
    id: 'weak',
    title: 'Слабые места',
    short: 'Слабые',
    description: 'Реплики, у которых по FSRS подошёл срок или прогноз вспоминания ниже 90 %. Каждая — с подсказкой партнёра.',
    basis: 'Spacing + FSRS',
    when: 'Ежедневно, 5–10 минут',
    affectsFsrs: true,
    playsCue: true,
    graded: true,
    repeatOnAgain: false,
    icon: '🔁',
  },
  order: {
    id: 'order',
    title: 'Порядок',
    short: 'Порядок',
    description: 'Восстановите порядок своих реплик в сцене или предложений монолога.',
    basis: 'Память на последовательность',
    when: 'Путаю, что за чем',
    affectsFsrs: false,
    playsCue: false,
    graded: true,
    repeatOnAgain: false,
    icon: '⇅',
  },
  type: {
    id: 'type',
    title: 'Письменный ввод',
    short: 'Ввод',
    description: 'Наберите реплику по памяти. Сервис покажет пословные расхождения и предложит оценку.',
    basis: 'Генерация, дословность',
    when: 'Перед прогоном, для дословности',
    affectsFsrs: true,
    playsCue: true,
    graded: true,
    repeatOnAgain: false,
    icon: '⌨',
  },
};

/** Порядок режимов в интерфейсе — по «Пути роли» */
export const TRAIN_MODES: ModeId[] = ['letters', 'run', 'vanish', 'chunks', 'cue', 'audio', 'weak', 'order', 'type'];

export const isModeId = (v: string | undefined): v is ModeId => !!v && v in MODES;

/** Реплики длиннее этого порога учатся в режиме «Монолог по частям» */
export const LONG_LINE_WORDS = 40;
