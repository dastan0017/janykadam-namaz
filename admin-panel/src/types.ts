/**
 * Доменная модель панели. Одна на все марафоны — бот тоже один.
 */

export type Role = 'admin' | 'curator';

export type Screen =
  | 'marathons'
  | 'overview'
  | 'topics'
  | 'topicEditor'
  | 'questionEditor'
  | 'participants'
  | 'broadcasts'
  | 'analytics'
  | 'settings'
  | 'namaz'
  | 'texts'
  | 'bot'
  | 'users'
  | 'journal';

export type MarathonStatus = 'draft' | 'recruiting' | 'running' | 'finished' | 'archive';
export type ParticipantStatus = 'active' | 'paused' | 'left' | 'finished';
export type Lang = 'kg' | 'ru';
/** Пояс — зона IANA, как её хранит бот: `Asia/Bishkek`. Любая, не только пресет. */
export type TzKey = string;
export type QuestionType = 'single' | 'multi' | 'text' | 'number' | 'scale' | 'yesno';
export type Frequency = 'daily' | 'weekly';

/** Якорь окна намаза: имя времени намаза + смещение в минутах. */
export type PrayerAnchor = 'fajr' | 'sunrise' | 'dhuhr' | 'asr' | 'maghrib' | 'isha' | 'nextFajr' | 'midnight' | 'fixed';
export type AnchorSpec = readonly [PrayerAnchor, number];

export interface AnswerOption {
  id: string;
  kg: string;
  ru: string;
  pts: number;
  /** Надписи заданы типом вопроса (шкала, да/нет) — меняются только баллы. */
  locked?: boolean;
}

export interface Question {
  id: string;
  textKg: string;
  textRu: string;
  type: QuestionType;
  required: boolean;
  options: AnswerOption[];
}

/** Своя тема марафона — окно фиксированное, редактируется целиком. */
export interface Topic {
  id: string;
  emoji: string;
  nameKg: string;
  nameRu: string;
  active: boolean;
  mode: 'fixed';
  start: string;
  end: string;
  /** Пустая строка — поле очищено в редакторе, это ошибка валидации. */
  points: number | '';
  freq: Frequency;
  mandatory: boolean;
  /** 0 — при открытии окна, 30 — через 30 мин, -30 — за 30 мин до закрытия. */
  remind: number;
  questions: Question[];
}

/** Фиксированная тема-намаз из общей библиотеки: в марафоне её только включают. */
export interface NamazDef {
  id: string;
  emoji: string;
  nameKg: string;
  nameRu: string;
  s: AnchorSpec;
  e: AnchorSpec;
  rule: string;
  points: number;
  mandatory: boolean;
  questions?: Question[];
}

/** Тема-намаз, приведённая к форме темы для общих расчётов. */
export interface NamazTopic {
  id: string;
  sys: true;
  emoji: string;
  nameKg: string;
  nameRu: string;
  points: number;
  mandatory: boolean;
  active: true;
  freq: Frequency;
  remind: number;
  questions: Question[];
}

/** Любая тема в списке бота: своя или намаз. */
export type AnyTopic = (Topic & { sys?: false }) | NamazTopic;

export interface Participant {
  id: string;
  name: string;
  user: string;
  tz: TzKey;
  /** Название места из бота: зоны мало, Бишкек и Ош расходятся на 5–15 минут. */
  place: string;
  status: ParticipantStatus;
  points: number;
  streak: number;
  /** Дней без отчёта: 0 — сдала сегодня, 99 — не сдавала ни разу. */
  last: number;
  /** Id тем, сданных сегодня по её местной дате. */
  today: string[];
  lang: Lang;
  blocked: boolean;
  /** Местная дата входа в марафон, `YYYY-MM-DD`. */
  joined: string;
  /** Дошла до седьмого дня — для воронки. */
  d7: boolean;
  /** Зачем пришла в марафон — её слова из бота. Пусто, если не ответила. */
  goal: string;
}

export interface LedgerEntry {
  /** Дата начисления, `YYYY-MM-DD`. */
  d: string;
  delta: number;
  reason: string;
}

export interface Broadcast {
  id: string;
  at: string;
  text: string;
  seg: string;
  count: number;
  delivered: number;
  blocked: number;
}

export interface Marathon {
  id: string;
  code: string;
  name: string;
  status: MarathonStatus;
  start: string;
  end: string;
  lang: Lang;
  regOpen: boolean;
  pointsDefault: number;
  streakBonus: number;
  streakEvery: number;
  latePasses: number;
  excused: number;
  pauseAllowed: boolean;
  remindMorning: string;
  remindEvening: string;
  skipSubmitted: boolean;
  /** Итоговое число участниц завершённого марафона. */
  reported?: number;
  /**
   * Сводка из списка марафонов. Нужна экрану «Все марафоны»: данные загружаются
   * по одному марафону, а карточки показывают все сразу.
   */
  stats?: { total: number; active: number; submittedToday: number; pct: number };
  namazCount?: number;
  topicsCount?: number;
}

export interface MarathonData {
  topics: Topic[];
  /** Id включённых в марафон намазов. */
  namaz: string[];
  participants: Participant[];
  /** Доля сдавших по дням, в процентах. */
  trend: number[];
  ledger: Record<string, LedgerEntry[]>;
  /** Отчёты участницы за последнюю неделю: ключ дня → сколько сдано. */
  recent: Record<string, Record<string, number>>;
  broadcasts: Broadcast[];
}

export interface PanelUser {
  id: string;
  name: string;
  tg: string;
  role: Role;
  last: string;
  invited?: boolean;
}

export interface AuditEntry {
  at: string;
  who: string;
  what: string;
}

/** Состояние входа: пока идёт проверка сессии, панель не рендерится. */
export type AuthState = 'checking' | 'anonymous' | 'ready';

export interface Me {
  id: string;
  name: string;
  tg: string;
  role: Role;
}

export interface BotText {
  key: string;
  ru: string;
  kg: string;
  ph: string;
}

export interface BotSettings {
  username: string;
  name: string;
  desc: string;
  shortDesc: string;
  commands: string;
  menu: string[];
  quietFrom: string;
  quietTo: string;
  capPerDay: number;
}

export interface ParticipantFilter {
  q: string;
  status: ParticipantStatus | 'all';
  tz: TzKey | 'all';
  act: 'all' | 'today' | 'nottoday' | 'stopped' | 'new';
  sort: 'name' | 'points' | 'last' | 'tz';
  dir: 1 | -1;
  sel: string[];
}

export interface ConfirmState {
  title: string;
  body: string;
  ok: string;
  danger: boolean;
  onOk: () => void;
}

export interface PointsModalState {
  pid: string;
  delta: string;
  reason: string;
  err: string;
}

export interface NewMarathonState {
  name: string;
  start: string;
  end: string;
  err: string;
}

export interface InviteState {
  name: string;
  tg: string;
  role: Role;
  err: string;
}

export interface BroadcastResult {
  count: number;
  delivered: number;
  blocked: number;
  blockedNames: string;
}

export interface BroadcastState {
  text: string;
  seg: string;
  when: 'now' | 'later';
  stage: 'compose' | 'confirm' | 'sending' | 'done';
  sent: number;
  total?: number;
  result: BroadcastResult | null;
  /** Участницы, выбранные галочками в таблице. */
  selIds?: string[];
}

/** Что правится в форме: марафон, тема, вопрос, настройки бота, текст бота. */
export type EditKind = 'marathon' | 'topic' | 'question' | 'bot' | 'text';

/** Плоский снимок значений формы: поле → значение. */
export type Snapshot = Record<string, string | number | boolean>;

/** Несохранённая правка формы — одна на панель: форма открыта всегда одна. */
export interface EditState {
  kind: EditKind;
  /** Что правится: id марафона, темы, вопроса, ключ текста; у настроек бота — 'bot'. */
  id: string;
  /** Значения до правки: по ним считается тело запроса и работает «Отменить». */
  base: Snapshot;
  /** Запрос уже ушёл — кнопки заблокированы. */
  saving: boolean;
}

export interface AppState {
  auth: AuthState;
  me: Me | null;
  /** Ошибка входа или загрузки — показывается на экране входа. */
  authError: string | null;
  /** Идёт загрузка данных марафона: таблицы показывают заглушку. */
  loading: boolean;
  /** Марафоны, данные которых уже загружены. */
  loaded: string[];
  role: Role;
  screen: Screen;
  mid: string | null;
  navOpen: boolean;
  marathons: Marathon[];
  data: Record<string, MarathonData>;
  users: PanelUser[];
  audit: AuditEntry[];
  texts: BotText[];
  bot: BotSettings;
  /** Черновик имени бота: null — поле не в режиме правки. */
  botDraft: string | null;
  /** Несохранённые правки формы: null — сохранять нечего. */
  edit: EditState | null;
  topicId: string | null;
  topicTab: 'settings' | 'questions';
  qId: string | null;
  pvLang: Lang;
  /** Превью темы: показать подтверждение приёма вместо напоминания. */
  pvDone: boolean;
  tzView: TzKey;
  pf: ParticipantFilter;
  drawerId: string | null;
  pointsModal: PointsModalState | null;
  confirm: ConfirmState | null;
  toast: string | null;
  textQ: string;
  textUntr: boolean;
  textKey: string;
  bc: BroadcastState;
  newM: NewMarathonState | null;
  filterTab: MarathonStatus | 'all';
  invite: InviteState | null;
  userQ: string;
}

export interface ValidationIssue {
  level: 'error' | 'warn';
  text: string;
  screen: Screen;
  extra?: Partial<AppState>;
}

export interface Segment {
  id: string;
  name: string;
  list: Participant[];
}

/** Элемент сценария в превью: шаг, кнопка или подсказка. */
export interface PreviewStep {
  k: 'step' | 'btn' | 'hint';
  text: string;
  pts?: number;
  hot?: boolean;
}

export interface PreviewButton {
  text?: string;
  pts?: number;
  cb?: string;
  hint?: string;
}

export interface Preview {
  title: string;
  text: string;
  len: number;
  lenLabel: string;
  over: boolean;
  buttons: PreviewButton[];
  steps: PreviewStep[];
  when: string;
  warns: string[];
  twoPrefix: string;
  /** Больше восьми кнопок — клавиатура становится стеной, превью мельчает нарочно. */
  ugly: boolean;
}
