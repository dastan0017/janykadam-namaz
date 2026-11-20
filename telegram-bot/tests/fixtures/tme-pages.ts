/**
 * Урезанные страницы предпросмотра t.me — в той разметке, что Telegram отдаёт
 * на самом деле (снято с t.me 14 ноября 2026).
 */
export const TME_CHANNEL = `<meta property="og:title" content="Үммөттүн кызы — отчеты">
<div class="tgme_page_title" dir="auto"><span dir="auto">Үммөттүн кызы — отчеты</span></div>
<div class="tgme_page_extra">2 subscribers</div>
<a class="tgme_action_button_new shine" href="tg://join?invite=ChannelInviteDemo1">Join Channel</a>`;

export const TME_GROUP = `<meta property="og:title" content="Отчёты &amp; разговоры">
<div class="tgme_page_title" dir="auto"><span dir="auto">Отчёты &amp; разговоры</span></div>
<div class="tgme_page_extra">3 members, 1 online</div>
<a class="tgme_action_button_new shine" href="tg://join?invite=GroupInviteDemo01">Join Group</a>`;

/** Ссылку отозвали или группу удалили: заглушка без названия. */
export const TME_MISSING = `<meta property="og:title" content="Join group chat on Telegram">
<div class="tgme_page_description"></div>`;
