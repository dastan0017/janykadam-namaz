# Design prompt — "Үммөттүн кызы" marathon Telegram bot (Janykadam)

> **How to use:** open a fresh Claude conversation and paste everything below the line.
> Attach the three reference screenshots (existing bot "JD") if you have them.
> The output is an interactive prototype you can click through live with the client.

---

## ROLE

You are a senior product designer + conversational-UX designer who has shipped several
large Telegram bots (10k+ users, gamified challenges, accountability marathons).
You know the Telegram Bot API intimately and never design something the API can't do.

## THE CLIENT

**Janykadam** (Instagram: [@jk_janykadam](https://www.instagram.com/jk_janykadam/)) — a Kyrgyz
Muslim women's community running a paid spiritual-discipline marathon called
**«Үммөттүн кызы»** ("Daughter of the Ummah"). ~100–1000 women per cohort,
mostly in Kyrgyzstan, phones are mid-range Android, Telegram is the main channel.

What the marathon promises participants (from their own launch post, in Kyrgyz):

- 🕌 Намазга бекем болуу — consistency in the five daily prayers
- 🌙 Тахаджуд намазга ойгонуу — waking for the night prayer
- 📖 Куран окуу жана зикир — Quran reading and dhikr
- ⏰ Убакытты туура пландоо — planning the day
- 📝 Күнүмдүк отчет — a daily report
- 🤍 Дисциплина жана руханий өнүгүү — discipline and spiritual growth

**The product job:** the bot is the accountability engine of the marathon.
It reminds, it collects daily video proof, it scores, it ranks teams, and it
lets the organisers run the whole thing from inside Telegram — no web admin.

## WHAT THE CURRENT (REFERENCE) BOT DOES

This already exists in a rough form and is the baseline to beat. Reproduce the
mechanics faithfully, then improve the UX.

**1. Report types with time windows.** A participant can only submit a given report
while its window is open. The reference list (keep these, exact names):

| Report | Window | Type |
|---|---|---|
| ⏰ Тахажуд | 02:00 – 05:40 | prayer-anchored (before fajr) |
| ⏰ Багымдат (Fajr) | 05:40 – 07:10 | prayer-anchored |
| ⏰ Пешим (Zuhr) | 12:48 – 16:37 | prayer-anchored |
| ⏰ Аср | 16:37 – 18:27 | prayer-anchored |
| ⏰ Шам (Maghrib) | 18:27 – 19:43 | prayer-anchored |
| ⏰ Куптан (Isha) | 19:43 – 22:00 | prayer-anchored |
| ⏰ Зикир | 05:00 – 22:00 | fixed |
| ⏰ Кунду пландоо (planning the day) | 05:00 – 22:00 | fixed |
| ⏰ Кунду анализдоо (reviewing the day) | 18:00 – 22:00 | fixed |
| ⏰ Спорт | 05:00 – 22:00 | fixed |
| ⏰ Китеп окуу (reading) | 05:00 – 22:00 | fixed |
| ⏰ Каза намаз (missed-prayer make-up) | 05:00 – 22:00 | fixed |

**Critical insight:** in the two reference screenshots the Fajr window is
`05:40–07:10` on one day and `05:25–07:05` on another. Prayer windows **shift daily
with the real prayer timetable** for the participant's city. The design must handle
this: prayer-anchored windows are computed every day from a prayer-time source
(city / coordinates + calculation method), with an admin-set offset before and after;
fixed windows are literal clock times. Make this visible and configurable in admin.

**2. Submitting.** The participant records a short video (Telegram video note /
"circle", ~0:02–1:00) and sends it to the bot. The bot replies:

> Выберите к какому отчёту относится высланное видео.

…followed by an inline keyboard, one button per report, each labelled
`⏰ 05:40 - 07:10 ✅ Багымдат`. She taps one and gets:

> Ваш отчет ⏰ 05:25 - 07:05 ✅ Багымдат принят! Вам начислено 5 баллов. Итого у вас 5 баллов.

**3. Reminders.** The bot pushes nudges like
`Напоминаем о сдаче отчёта «Пешим»!` when a window opens / is about to close.

**4. Main menu** (reply keyboard, from the reference):
🤲 Мои цели · 😎 О себе · 🏁 Моя команда · ✅ Мои отчёты ·
🚀 Рейтинг команд и участников · 👣 Мои шаги к цели

## WHAT TO DELIVER

One **interactive HTML artifact** the client can click through on a laptop or phone.
It is a prototype + spec in one document, with a left-hand (or top) navigator:

### Tab 1 — Participant flows (clickable Telegram mock)
A realistic iPhone-sized Telegram chat rendered in the **dark theme from the
screenshots**: patterned wallpaper, rounded bubbles, timestamps, ✓✓ read marks,
inline-keyboard buttons as full-width dark pills, reply keyboard at the bottom.
Tapping a button actually advances the mock conversation. Cover:

1. **First contact & registration** — `/start`, language choice (Кыргызча / Русский),
   name, city (needed for prayer times), age bracket, phone/contact share,
   the marathon rules, the ethics/consent notice for video ("your video is seen only
   by your curator"), then "you're in" + the daily schedule card.
2. **Goal setting** — "Мои цели": she writes 1–3 goals for the marathon; these feed
   "Мои шаги к цели" progress later.
3. **Team assignment** — auto-placed into a team, or joins by invite code; team card
   with captain/curator and teammates.
4. **The daily loop** — window-open reminder → she sends a video note → report-type
   picker → acceptance + points + running total. Show the picker's three button
   states: ✅ open now, 🔒 window closed (shown greyed / explains why), ☑️ already
   submitted today.
5. **Edge cases, each as its own screen** — sent a video outside every window;
   sent a photo/text instead of video; submitting the same report twice; sending
   a video with no open windows left; late submission with a "grace period" offer;
   changing a mis-tagged report within N minutes; a skipped day.
6. **Menu sections** — Мои отчёты (today's checklist + a 7-day grid of ✅/⬜),
   О себе (profile, streak, total points, rank), Моя команда (team points, member
   list, who's lagging), Рейтинг (team leaderboard + personal leaderboard, top-10 +
   "you are #34"), Мои шаги к цели (progress toward her own goals).
7. **Rhythm messages** — a morning schedule card, an evening "2 reports left" nudge,
   a Sunday weekly summary, a streak-broken recovery message (warm, never shaming),
   marathon midpoint, and the final day with a results card + certificate.

### Tab 2 — Admin flows (also inside Telegram)
Everything the organiser needs, as in-chat admin screens reached via `/admin`.
Design a stable panel pattern: a header line of context + inline keyboard sections +
a ⬅️ Назад button on every screen. Sections:

- **🏁 Марафон** — create a cohort, start/end dates, registration open/closed,
  pause, archive, clone last cohort's settings.
- **📋 Отчёты (report types)** — full CRUD. Per report: name (RU/KG), emoji,
  window mode (fixed / prayer-anchored with `-X min` … `+Y min` around a chosen
  prayer), points, required proof (video note / video / photo / text / none),
  max duration, frequency (daily / weekdays / once per week), is it mandatory,
  active on/off, sort order. Show the editor as a step-by-step inline flow and
  a live preview of the resulting button label.
- **⏰ Напоминания** — per-report reminder schedule (on open, N min before close,
  a final nudge), editable text, quiet hours, "don't remind people who already
  submitted" toggle.
- **👥 Команды** — create teams, rename, set captain and curator, auto-balance
  participants, move a participant, team invite codes.
- **🙋 Участники** — search by name/username/phone, participant card with points,
  streak, submissions, last activity, and actions: adjust points (with a reason),
  move team, message her directly, warn, freeze, remove, block.
- **🎬 Модерация** — the queue of submitted videos: play, approve, reject with a
  reason from a preset list, "auto-accept" toggle per report, spot-check mode
  (moderate a random X%), and the appeal a rejected participant sees.
- **📣 Рассылка** — broadcast composer: write → choose a segment (all / one team /
  those who haven't reported today / inactive 3+ days / top-10 / drop-outs) →
  preview → confirm with recipient count → delivery progress + delivered/blocked stats.
- **📊 Статистика** — today's submission rate, per-report completion, per-team
  table, the registration→day-1→day-7 funnel, drop-off list, and an export
  (CSV / Google Sheets) button.
- **✍️ Тексты** — every bot message editable in-chat, both languages, with
  placeholders (`{name}`, `{points}`, `{report}`, `{window}`) and a preview.
- **⚙️ Настройки** — timezone, default city and prayer-calculation method,
  default language, points rules (base points, streak bonus, late-submission
  multiplier, penalty for a missed mandatory report), grace period, and
  **roles**: superadmin / admin / moderator / curator (sees only her own team) /
  team captain (read-only team view). Show how a role is granted and what a
  curator's `/admin` looks like compared to a superadmin's.

### Tab 3 — Flow map
One diagram of the whole system: participant states (new → registered → active →
lagging → dropped → graduated), the daily submission state machine, and where the
admin intervenes. Keep it readable, not a spaghetti chart.

### Tab 4 — Copy deck
A table of **every single message the bot sends**, with: key, Russian text, Kyrgyz
text, when it fires, and which placeholders it uses. This is what the client will
actually mark up, so make it skimmable and complete — including all errors and
reminders. Kyrgyz is the primary language for this audience; Russian is secondary.

### Tab 5 — Data model & rules
Entities and fields (Cohort, Participant, Team, ReportType, Window, Submission,
PointsLedger, Reminder, AdminUser, AuditLog, MessageTemplate), plus the scoring
rules written out unambiguously: base points per report, streak bonus, how team
score is computed (sum vs. average — argue for one; average is fairer to small
teams), tie-breaks, what a missed day costs, and how the final ranking is decided.

### Tab 6 — Open questions for the client
8–15 decisions you could not make for them, each phrased so the client can answer
in one line. Examples: is the marathon paid and how is payment verified; is a
missed day penalised or merely not rewarded; can a curator see another team's
videos; how long are videos retained; what happens to a participant who travels
to another timezone.

Also include a small **Assumptions** panel listing what you decided on your own,
so nothing is silently invented.

## DESIGN DIRECTION

- **Tone:** warm, respectful, sisterly, motivating — never guilt-tripping.
  This is worship, not a sales funnel. No aggressive gamification language,
  no "you failed". A missed day gets encouragement, not a red X.
- **Islamic etiquette:** correct Kyrgyz prayer names (Багымдат, Пешим, Аср, Шам,
  Куптан, Тахажуд), appropriate greetings (Ассаламу алейкум), no imagery that
  conflicts with the community's norms, modest emoji use consistent with the
  reference (⏰ ✅ 🤲 🌙 📖 🏁 🚀 👣).
- **Visual:** match the reference screenshots' dark Telegram theme so the client
  immediately recognises it. Mobile-first — it must look right at 390px wide.
- **Legibility:** the audience includes women who are not power users. Short
  messages, one decision per screen, no nested menus deeper than two levels,
  always a way back.

## HARD TECHNICAL CONSTRAINTS (do not design around these)

- Telegram Bot API only. Available UI: text, inline keyboards (buttons in rows),
  reply keyboards, message editing, media (video note, video, photo, document).
  No custom colours, no custom fonts, no free-form layout inside a message.
- `callback_data` is max 64 bytes — don't design buttons that need to carry an essay.
- Inline keyboards should stay ≤ 8–10 rows to avoid a wall of buttons; the reference
  picker already has 12 rows — propose a better pattern (e.g. only show the windows
  that are open right now, with a "показать все" expander).
- A video note is round, ≤ 60s, ≤ 1 minute of recording; a regular video can be longer.
  Decide and state which you require, and what the bot says when the wrong one arrives.
- Bots can't initiate a chat with a user who never started them — registration must
  flow from a deep link (`t.me/bot?start=cohort5`) shared on Instagram.
- Broadcasting to hundreds of users is rate-limited (~30 msg/s); the admin broadcast
  UI must show progress rather than pretend it's instant.
- Prayer times need a source (city → timetable). Treat it as a dependency and show
  what happens when it fails.
- Optionally, mark ONE section (statistics / leaderboard) as "could later become a
  Telegram Mini App" — but everything in this design must work as a plain bot first.

## OUTPUT RULES

- Build it as a single self-contained interactive HTML artifact. Make the prototype
  genuinely clickable, not a static gallery of pictures.
- Include a **RU / KG toggle** that actually switches the mock conversation texts.
- Bot copy in the mocks must be real Russian and Kyrgyz — not lorem ipsum, not English.
- Every screen gets a one-line designer's note explaining *why* it is the way it is;
  the client reads this document without me in the room.
- Where you improve on the reference bot, say so explicitly in a "What we changed
  and why" list — the client knows the old bot and will notice.
