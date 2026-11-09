# Prompt for Claude Design — working prototype of the «Үммөттүн кызы» bot

> **How to use:** open Claude Design and paste everything below the line.
> Attach the three screenshots of the current "JD" bot if you have them.
> Optional first line to add: *"An earlier design canvas exists at
> https://claude.ai/artifact/3w18iYGCmYtv76iCf2ecNJ — read it first and reuse its
> Kyrgyz/Russian copy, its report types and its design decisions."*

---

## WHAT I WANT

A **working Telegram bot prototype** on a design canvas — not a gallery of screens.
My client must be able to open the link alone, with nobody explaining anything,
press buttons, send a video, change the time of day, switch to the admin panel,
break things, press reset, and come back and tell me what's wrong.

If a screen only *looks* like it works, it has failed. The bot must hold real state
and compute its answers from that state.

## WHO IT'S FOR

**Janykadam** ([@jk_janykadam](https://www.instagram.com/jk_janykadam/)) — a Kyrgyz
Muslim women's community running a 30-day spiritual-discipline marathon called
**«Үммөттүн кызы»** ("Daughter of the Ummah"). ~184 women per cohort, Kyrgyzstan,
mid-range Android phones, Telegram is the only channel. Kyrgyz is the primary
language; Russian is secondary.

The bot is the accountability engine: it reminds, collects a short daily video per
task, scores, ranks teams, and is fully administered from inside Telegram — the
client explicitly does not want a web admin.

## THE PRODUCT, IN FACTS

**Twelve report types.** Each can only be submitted while its window is open.

| Report (KG) | Window today | Mode |
|---|---|---|
| Тахажуд | 02:00 – 05:25 | prayer-anchored (02:00 → fajr) |
| Багымдат | 05:25 – 07:05 | prayer-anchored (fajr → +100 min) |
| Пешим | 12:48 – 16:37 | prayer-anchored (zuhr → asr) |
| Аср | 16:37 – 18:27 | prayer-anchored (asr → maghrib) |
| Шам | 18:27 – 19:43 | prayer-anchored (maghrib → isha) |
| Куптан | 19:43 – 22:00 | prayer-anchored (isha → +137 min) |
| Зикир | 05:00 – 22:00 | fixed |
| Кунду пландоо | 05:00 – 22:00 | fixed |
| Спорт | 05:00 – 22:00 | fixed, 3 points |
| Китеп окуу | 05:00 – 22:00 | fixed, 3 points |
| Каза намаз | 05:00 – 22:00 | fixed |
| Кунду анализдөө | 18:00 – 22:00 | fixed |

**Prayer windows move every day** with the real timetable for the participant's
city — in the client's own screenshots Багымдат is `05:40–07:10` on one day and
`05:25–07:05` on another. The prototype must show this (see "Day 2" below).

**The core loop.** She records a short video note and sends it. The bot asks which
report it belongs to, she taps one, and gets points. Base 5 points, Спорт and
Китеп окуу 3. Streak bonus +2 every full 7 days.

**Menu** (reply keyboard): 🤲 Максаттарым · 😎 Өзүм жөнүндө · 🏁 Командам ·
✅ Отчётторум · 🚀 Рейтинг · 👣 Кадамдарым

## STRUCTURE OF THE DELIVERABLE

### `Main.dc.html` — THE SIMULATOR (this is 80% of the work)

One artboard, because the whole prototype shares one state object and on this canvas
**each artboard keeps its own state** — splitting the simulator across artboards
breaks it. Lay it out as:

**Left rail — the test console** (this is the client's cockpit, label everything in Russian):

- **Время** — a clock readout plus jump buttons: `04:00` · `05:25 Багымдат открылся` ·
  `09:00` · `13:00 Пешим` · `16:30 Пешим закрывается` · `21:00 Итог дня` ·
  `23:30 всё закрыто` · `+15 мин` · `Следующий день`
- **Кто я** — Участница / Куратор / Суперадмин. Switching re-renders the same chat as
  that role.
- **Язык** — КГ / РУ, switches every bot string live.
- **Состояние** — a live readout of what the bot believes: день 10/30, баллы 247,
  серия 5, сдано сегодня 4/8, опозданий осталось 2, уважительный день: нет, пауза: нет
- **Действия** — 🎥 Отправить видео · 📷 Отправить фото · ✍️ Отправить текст ·
  🎥 Отправить длинное видео (2:40) · 🤍 Отметить уважительный день · ⏸ Взять паузу
- **Сброс** — back to day 1, pre-registration.

**Right — a Telegram chat at real size (390 × 844)** that behaves like Telegram:
dark theme matching the screenshots, bubbles, timestamps, ✓✓, round video notes,
inline keyboards attached under the bot's message, a persistent reply keyboard,
an input bar. New messages append and the view scrolls to them.

**Under the chat — a thin "почему так" strip** that updates with each bot reply:
one sentence explaining the design decision behind what just happened. My client
reads this without me in the room.

### The state the simulator must actually hold and compute from

```
clock (minute of day) · marathon day · language · role
participant: name, city, team, points, streak, best streak,
             submissions[] per day, excusedDays[], pauseUntil, latePassesLeft,
             pendingVideo {at, expiresAt}, lastSubmission {at, reportId}
reportTypes[]: all twelve, each with mode, window, points, active, proofType
```

Everything the bot says must be **derived** from this. No hardcoded "у вас 5 баллов".

### Scenarios that must genuinely work — not be a picture of working

Each of these must be reachable by the client pressing things, in any order:

1. **Registration** — `/start`, язык, имя (typed), город, телефон (request_contact
   reply button), правила + согласие, цели (typed, stored verbatim and shown later in
   «Кадамдарым»), команда, первое расписание. Menu appears only at the end.
2. **Submit on time** — send video → picker shows **only windows open at the current
   clock**, the likely one first → tap → points added, totals and streak update,
   today's list in «Отчётторум» changes.
3. **Show all 12** — expander reveals the full list with three real states:
   ✅ open now · ☑️ already submitted today · 🔒 closed, and closed buttons are
   genuinely `disabled`.
4. **Re-tag within 10 minutes** — the offer appears, a real countdown, it expires and
   the button disappears. Points don't change on re-tag.
5. **Duplicate** — second video for a report already submitted → offer to replace,
   no second award.
6. **Wrong media** — photo, text, voice → refusal naming what's wrong, why it's a
   rule, and how long the window is still open.
7. **Too long** — the 2:40 video → refusal explaining the 60-second limit.
8. **Late** — move the clock past a window's close, then send video within 60 min →
   offer +3 instead of 5, decrement latePassesLeft, and refuse once it hits 0.
9. **Nothing open** — send video at 23:30 → bot stores it, says 12 hours, and next
   morning the stored video is actually still there and can be assigned.
10. **Уважительный день (узур)** — one button, no reason asked, prayer reports vanish
    from today's list, streak survives, day counts neutral in «Отчётторум».
11. **Пауза** — 1/3/7 days, reminders stop firing when the clock advances, streak
    freezes, she's still in the team list.
12. **Missed day** — advance a whole day with no submission → next morning the warm
    recovery message, streak reset to 0, one easy report offered.
13. **Leaving** — the two alternatives before the exit, and what happens to data.
14. **Reminders fire from the clock** — crossing 05:25 posts the window-open message;
    crossing 16:07 posts the 30-min warning **only if that report isn't submitted**;
    21:00 posts the evening summary listing what's still reachable.
15. **All six menu sections** — computed live: Отчётторум (today's checklist + last
    7 days), Өзүм жөнүндө, Командам, Рейтинг (always showing her own row and how many
    are behind her), Максаттарым (her typed goals), Кадамдарым (progress bars).
16. **Day 2** — "Следующий день" shifts the prayer windows by a few minutes and the
    morning schedule shows the new times. This is the point the client must see.

### Admin mode — and the one thing that proves it's real

Switching to **Суперадмин** shows `/admin` in the same chat: the ten sections
(Марафон · Отчёттор · Эскертүүлөр · Командалар · Катышуучулар · Модерация ·
Жарыялоо · Статистика · Тексттер · Жөндөөлөр), two buttons per row, ⬅️ Назад
everywhere, each screen opening with state rather than a menu.

**These admin changes must immediately change what the participant sees** — switch
back to Участница and the effect is there:

- turn a report type **off** → it disappears from her picker and from her schedule
- change a report's **points** from 5 to 7 → the next acceptance says +7
- edit a **message text** in «Тексттер» → the bot uses the new wording
- change the **late rule** or turn off уважительные дни → her buttons change
- adjust her **points** with a reason → her total changes and she gets a notification

Also working: the moderation queue (accept / reject with a reason from a list, and the
rejection then arrives in her chat), and the broadcast composer (write → pick a segment
with a live recipient count computed from state → preview with her name substituted →
confirm → progress → delivered/blocked). The broadcast must actually appear in her chat.

**Куратор** opens the same `/admin` with only her team, no broadcast, no settings —
so the client can see the access difference for themselves.

### Supporting artboards (short, after the simulator works)

- `Scenarios.dc.html` — a numbered test script: *"1. Press Сброс. 2. Go through
  registration. 3. Set the clock to 05:25…"* — 15 short tasks so the client knows
  what to try. Include "things that should annoy you — tell us".
- `CopyDeck.dc.html` — every bot message, KG and RU side by side, with its key and
  placeholders. The client marks up wording here.
- `Questions.dc.html` — the decisions the client must make, each with our proposal.

## TELEGRAM FIDELITY — the details that make it feel real

- Dark theme from the screenshots: near-black chat, `#26262F` incoming bubbles,
  `#2B5278` outgoing, `#32323D` inline buttons, `#A8B0BA` timestamps.
- Chat header: back chevron, avatar, bot name, "бот" underneath.
- Bot bubbles left with a square bottom-left corner, hers right with a square
  bottom-right, time inside the bubble, ✓✓ on hers.
- **Video note = a circle**, not a rectangle, with duration under it.
- Inline keyboards are attached under the message and span its width; the reply
  keyboard is a separate persistent grid above the input bar — these are two
  different things in Telegram and the prototype must not blur them.
- Typing indicator ("печатает…") for ~400ms before each bot reply. Multi-message
  replies arrive one after another, not all at once.
- Messages append and the chat scrolls to the newest.

## TELEGRAM BOT API CONSTRAINTS — do not design past these

- Only text, inline keyboards, reply keyboards, message editing, and media. No custom
  colours, no free layout inside a message.
- `callback_data` is 64 bytes max.
- Contact sharing needs a reply-keyboard `request_contact` button, not an inline one.
- A video note is round and ≤ 60 seconds.
- A bot cannot message someone who never started it — registration must begin from a
  deep link `t.me/bot?start=ummot5`.
- Broadcasting is rate-limited (~30 msg/s), so the send progress must take visible time.
- Inline keyboards longer than ~8 rows become a wall — that's the main flaw of the
  current bot and the prototype must demonstrate the fix.

## TONE

Warm, sisterly, respectful. This is worship, not a sales funnel. A missed day gets
encouragement, never "вы провалили". Correct Kyrgyz prayer names (Багымдат, Пешим,
Аср, Шам, Куптан, Тахажуд). Emoji only inside the chat, where Telegram copy really
uses them — never as UI icons in the console or the artboard chrome.

## TECHNICAL NOTES FOR THIS CANVAS FORMAT

These will save you an hour of silent failures:

- Keep `<script src="./support.js"></script>` in `<head>` exactly as-is.
- All logic in one `class Component extends DCLogic` with `renderVals()`; classic JS,
  no imports, no TypeScript.
- **Do not nest `<sc-for>` inside `<sc-for>`.** Flatten the chat into one array of
  rows where each row carries flags (`isBot`, `isUser`, `isVideo`, `isBtn`, `isPair`)
  and branch with `<sc-if>` inside a single loop.
- Always set `hint-placeholder-val` / `hint-placeholder-count`.
- `{{hole}}` is a dotted lookup only — never an expression. Compute in `renderVals()`.
- Every clickable thing is a real `<button>`; never `onClick` on a `<div>`.
  Closed window buttons get a real `disabled`.
- Style holes are fine for state-driven values (selected states, computed button
  colours); static theme values stay inline.
- `white-space: pre-wrap` on bubbles, or `\n` in the copy collapses.
- Mark the simulator artboard `"is_interactive": true` in `canvas.json`.
- No network except a Google Fonts `css2` link (use a family with full Cyrillic —
  Inter works).

## WHEN YOU'RE DONE

Tell me, in your reply and not inside an artboard:
what you decided on your own, what you could not make work and why, and the three
places where you think my client will disagree with us.
