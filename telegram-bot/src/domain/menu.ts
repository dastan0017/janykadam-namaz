/**
 * Главное меню бота — кнопки под полем ввода.
 *
 * Здесь только порядок и ключи: надписи лежат в `bot_texts`, как и всё
 * остальное, что видит участница, и правятся из панели. Нажатие приходит
 * обычным текстом, поэтому по надписи и определяется действие — на обоих
 * языках сразу: участница могла сменить язык, а клавиатура осталась прежней.
 */

export type MenuAction = 'report' | 'reports' | 'goals' | 'about' | 'zone' | 'help';

export const MENU: { action: MenuAction; textKey: string }[] = [
  { action: 'report', textKey: 'btn_menu_report' },
  { action: 'reports', textKey: 'btn_menu_reports' },
  { action: 'goals', textKey: 'btn_menu_goals' },
  { action: 'about', textKey: 'btn_menu_about' },
  { action: 'zone', textKey: 'btn_menu_zone' },
  { action: 'help', textKey: 'btn_menu_help' },
];

/**
 * Клавиатура прошлой версии. Telegram держит её в чате, пока бот не пришлёт
 * новую, поэтому участница, зарегистрированная до обновления меню, продолжает
 * жать старые кнопки. Узнаём их, отвечаем по делу и заодно шлём новую.
 */
const LEGACY: Record<string, MenuAction> = {
  '🎥 Отчёт тапшыруу': 'report',
  '⭐ Баллдарым': 'reports',
  '🕐 Убакыт алкагы': 'zone',
  '❓ Жардам': 'help',
};

export function matchLegacyMenu(text: string): MenuAction | null {
  return LEGACY[text.trim()] ?? null;
}

/** Надпись нажатой кнопки → действие. Сравнение без учёта регистра и пробелов по краям. */
export function matchMenu(text: string, labels: { action: MenuAction; labels: string[] }[]): MenuAction | null {
  const needle = text.trim().toLowerCase();
  for (const item of labels) {
    if (item.labels.some((l) => l.trim().toLowerCase() === needle && l.trim() !== '')) return item.action;
  }
  return null;
}
