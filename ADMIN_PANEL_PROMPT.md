# Prompt for Claude Design — working prototype of the admin panel (React) for the Janykadam marathon bot

> **How to use:** open Claude Design, start a **new canvas**, and paste everything
> below the line.
> Optional first line: *"A design canvas for the Telegram bot itself already exists at
> https://claude.ai/artifact/3w18iYGCmYtv76iCf2ecNJ — read it for the Kyrgyz/Russian
> copy, the twelve topics and the decisions already made."*

---

## ROLE

You are a senior product designer who builds admin panels that non-technical people
operate every morning — not CRUD forms generated from a schema.

## WHAT I WANT

A **working prototype of the admin panel**. Not a gallery of screens: a clickable app
with real state, that my client can open alone and drive — switch marathon, add a
question, change a window, filter participants, approve a video, send a broadcast —
and see the consequences update everywhere.

If a screen only *looks* like it works, it has failed.

We are designing the panel **before** finalising the bot, deliberately. Whatever the
admin can configure here is exactly what the bot can do, so this prototype is the
specification for the bot.

## THE CLIENT AND THE PRODUCT

**Janykadam** ([@jk_janykadam](https://www.instagram.com/jk_janykadam/)) — a Kyrgyz
Muslim women's community. They run **marathons**: 30-day programmes of spiritual
discipline where participants report daily on prayers, Quran reading, planning, sport
and similar. 180–500 women per marathon, Kyrgyzstan, phones. Kyrgyz is the primary
language of the *participants*, Russian second. The current marathon is «Үммөттүн кызы».

Who uses this panel: the founder (superadmin), two or three organisers, and about
fifteen **curators**, each responsible for one team of ~12 women. Curators are not
office workers — they check in from phones, between other things.

**The panel's own interface is in Russian.** Only the content it manages is bilingual.

## THE ONE FACT THAT SHAPES EVERYTHING

**There is one Telegram bot, serving every marathon.** Not one bot per marathon.

Problems the prototype must solve visibly, not ignore:

- Entry is a **deep link carrying the marathon code** (`t.me/janykadam_bot?start=m5`).
  The panel generates and shows it per marathon, with a QR — it goes in an Instagram bio.
- A woman can be enrolled in **two marathons at once**. Decide what the bot does — ask
  each time, keep a switchable context, prefix every message — and show your answer.
- **Reminders from two marathons land in the same chat**, so quiet hours and any
  per-participant message cap are global, not per-marathon.
- **Bot name, description, commands and avatar are global** and cannot differ per
  marathon. Put them outside any marathon and say so on the screen, so nobody promises
  a client per-marathon branding.
- Roles are **scoped per marathon**: a curator of marathon 5 must not see marathon 6.

## THE CONTENT MODEL

```
Marathon  (Марафон)
  ├─ settings: dates, registration window, deep link, timezone,
  │            prayer method, default city and language, scoring rules
  ├─ Teams (Команды) ─ curator, captain, members, invite code
  └─ Topics (Темы)              ← one per thing she reports on
       ├─ names KG/RU, emoji, order, active
       ├─ window: fixed (05:00–22:00) OR prayer-anchored (fajr +0 … +100 min)
       ├─ points, frequency, mandatory, moderation mode
       ├─ proof: video note / video / photo / none
       └─ Questions (Вопросы) ─ 0 to many, asked in order
            ├─ text KG/RU
            ├─ type: single choice · multi choice · text · number ·
            │        scale 1–5 · yes/no · video · photo
            ├─ required
            └─ Answer options (Варианты ответов)
                 ├─ label KG/RU
                 └─ points for this option  ← different answers worth different amounts
```

Three shapes result, and all three must be reachable in the prototype:

1. **Topic, no questions, video required** — today's behaviour: she sends a video, the
   bot asks which topic, done.
2. **Topic with questions and video** — video, then the questions in order.
3. **Topic with questions, no proof** — a pure questionnaire. «Канча бет окудуңуз?»
   with options 1 / 2–5 / 5+ worth 3 / 4 / 5 points.

## STRUCTURE OF THE DELIVERABLE

### `Main.dc.html` — the working app (this is 80% of the work)

**One artboard**, because the whole app shares one state object and on this canvas
each artboard keeps its own state — splitting the app across artboards breaks the
marathon switcher, the live preview and every cross-screen effect.

Inside it: a sidebar, a marathon switcher in the header, and the screens swapped by
internal routing. Make it a PAGE (`"expand": "fill"`, fluid root, no fixed px width)
so it fills the window like a real app, and `"is_interactive": true`.

**Screens that must genuinely work** — state-driven, editable, effects visible:

1. **Марафоны** — three seeded marathons (one finished, one running, one draft) with
   status, dates, participants, today's completion. Create, and **duplicate from a
   previous marathon** — the most-used button on the screen. Duplicating must really
   produce a new row carrying the topics across.
2. **Переключатель марафона** — switching it really changes the data on every screen.
3. **Обзор марафона** — the morning dashboard: today's submission rate, moderation
   backlog, participants who stopped, teams without a curator, 30-day trend. Every
   number links to the filtered list behind it, and the links really navigate.
4. **Темы** — list with reorder and an active toggle that really toggles. Prayer-anchored
   and fixed topics visually distinct, because they behave differently.
5. **Редактор темы** — window mode, prayer anchor and offsets, points, proof, frequency,
   mandatory, moderation. Changing the offsets must **recompute the window live** and
   show it for today, tomorrow and a month out: "fajr + 0 мин" is meaningless until
   05:25–07:05 appears beside it. Turning a topic off must remove it from the
   participant-facing preview and from the dashboard counts.
6. **Редактор вопроса** — type picker, texts in both languages, answer options with
   per-option points, add/remove/reorder options, required toggle. Every edit updates
   the preview immediately.
7. **Участницы** — a real table over ~12 seeded women: search, filter by status / team /
   activity, sort, select rows, bulk action. Row click opens a **drawer** with profile,
   submission timeline, points ledger with reasons, and actions. Adjusting points must
   require a reason and really change her total in the table behind the drawer.
8. **Модерация** — a queue of ~6 pending items with the participant's history visible.
   Approve and reject really remove the item and decrement the badge in the sidebar.
   Reject asks for a reason from a list. Design and build **the phone layout of this
   screen too** — curators will use it on a phone.
9. **Рассылки** — composer with placeholders, segment picker whose **recipient count is
   computed from the participant data**, preview as a named participant will see it,
   confirmation stating the count and estimated send time, then a delivery result
   including how many blocked the bot.
10. **Проверка конфигурации** — a validator that recomputes from the current config and
    catches a broken marathon before it starts: a topic with neither questions nor
    proof (nothing to submit), a choice question with one option, overlapping mandatory
    windows, untranslated texts, a team without a curator, dates in the past. Break
    something in an editor and the checklist must really go red.

**Screens that may be realistic but static**, reachable from the nav: Аналитика,
Тексты бота, Команды, Бот (global settings), Доступы и журнал.

**Also build:** a **curator's view** of the same app — one marathon, moderation and her
team only, no settings, no broadcasts. A role switch in the header is enough to show it.

**And:** empty states (no marathons yet, moderation queue clear), one destructive
confirm, one inline validation error, and a no-permission state. A panel designed only
in its happy state is not designed.

### `Foundations.dc.html`
Colour tokens, type scale, spacing, and the component inventory you reused: button
variants, input, select, table row, drawer, tag, status pill, empty state, toast,
confirm dialog, the preview card.

### `Questions.dc.html`
The decisions you could not make for us, each with your proposal — including how you
resolved a participant being in two marathons at once.

## THE PREVIEW — in the panel's own language, not Telegram's

Every screen that configures bot behaviour carries a preview card answering *«Что
получит участница»*. **Do not draw a phone and do not use Telegram's colours or
bubbles.** This is a component of the admin design system, styled like everything else
in the panel.

It shows:

- **Текст сообщения** — the composed message as it will be sent, in the panel's own
  typography, with a character counter against Telegram's 4096 limit.
- **Кнопки** — the answer options rendered as a vertical stack of button-shaped rows in
  the panel's button style, so their number and length are obvious at a glance.
- **Когда и кому** — one line of plain Russian: when this fires and who receives it.
- **Язык** — a КГ / РУ toggle, since the content is bilingual.
- **Предупреждения** inline: more than eight buttons, text over the limit, missing
  translation.

The point is that the admin sees **structure and limits**, not a simulated device. A
fake phone invites arguments about pixel details that do not exist; a composition card
keeps the conversation on content.

## TELEGRAM CONSTRAINTS THAT SHAPE THIS UI

Design these in as guard-rails, visibly:

- **4096 characters per message.** A topic with many long questions overflows. Counter
  plus a stated rule for what the bot does.
- **`callback_data` is 64 bytes.** Answer buttons encode marathon + topic + question +
  option inside that. It works with short ids, but the panel must not promise that
  options can carry arbitrary payloads.
- **Inline keyboards beyond ~8 rows become a wall.** The current bot's twelve-row picker
  is the client's own worst screen. Warn past eight options and let the preview get
  visibly ugly, so the admin sees it rather than being told.
- **Video note: round, ≤60 seconds.** Regular video can be longer, but the Bot API only
  downloads files up to 20 MB — which matters because this panel plays those videos in
  a browser through a proxy, and Telegram's file links expire in about an hour.
- **~30 messages per second** when broadcasting, so sending to 500 people visibly takes
  time. Never show an instant «Отправлено».
- **A bot cannot message someone who never started it** — hence the deep link and QR.
- **Bot name changes are rate-limited** — a confirmed action, not a live field.

## SEED DATA

Make it real, not lorem: three marathons; twelve topics with the real names (Тахажуд,
Багымдат, Пешим, Аср, Шам, Куптан, Зикир, Кунду пландоо, Спорт, Китеп окуу, Каза намаз,
Кунду анализдөө); two or three topics carrying real Kyrgyz questions with options; about
twelve participants with plausible Kyrgyz names, varied status and points; four teams,
one deliberately without a curator; six items in the moderation queue. Numbers must be
consistent across screens — if the dashboard says 71%, the table must agree.

## DESIGN DIRECTION

Calm, dense, fast. A tool used every morning, not a landing page. Desktop-first at 1440;
moderation and participants must also work at phone width. Russian interface in the
client's own vocabulary: марафон, тема, вопрос, отчёт, куратор, команда, баллы.

Respect the subject. This is worship, not a fitness challenge — no leaderboard confetti,
no aggressive gamification in the admin vocabulary either.

## TECHNICAL NOTES FOR THIS CANVAS FORMAT

These save an hour of silent failures:

- Keep `<script src="./support.js"></script>` in `<head>` exactly as written.
- All logic in one `class Component extends DCLogic` with `renderVals()`; classic JS,
  no imports, no TypeScript.
- Keep the whole app state in one object in `this.state` and route screens with
  `<sc-if>`. Shared state across artboards is impossible here.
- **Do not nest `<sc-for>` inside `<sc-for>`.** Flatten lists into one array whose rows
  carry flags, and branch with `<sc-if>` inside a single loop. This bites hardest on
  tables and on question-with-options lists — plan for it.
- Always set `hint-placeholder-val` / `hint-placeholder-count`.
- `{{hole}}` is a dotted lookup only, never an expression — compute in `renderVals()`.
- Every control is a real `<button>` / `<input>` + `<label>`; never `onClick` on a div.
  Disabled things get a real `disabled`.
- Style holes are fine for state-driven values (selected rows, computed status colours);
  static theme values stay inline.
- Text inputs: bind `value` and `onChange` and keep the value in state, or typing will
  not work.
- Google Fonts only for network; pick a family with full Cyrillic (Inter works).

## WHEN YOU ARE DONE

In your reply, not inside an artboard: a short numbered path through the prototype so
my client knows what to click; what you decided on your own; how you resolved the
woman-in-two-marathons problem and why; which parts of the content model you think are
over-engineered for a community of this size; and the three things you expect the client
to push back on.
