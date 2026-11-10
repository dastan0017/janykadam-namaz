# Janykadam — марафоны

Телеграм-марафоны сообщества Janykadam: 30-дневные программы духовной
дисциплины, где участницы каждый день отчитываются видеокружком.

Один бот обслуживает все марафоны — это определяет устройство обеих частей.

## Структура репозитория

| Папка | Что это |
| --- | --- |
| [`admin-panel/`](admin-panel/) | Админ-панель: React + TypeScript + Vite. |
| [`telegram-bot/`](telegram-bot/) | Бот и бэкенд панели: NestJS, PostgreSQL, Drizzle, pg-boss. |
| [`deploy/`](deploy/) | Прод-стенд: Caddy, панель и API на одном домене. |

Панель спроектирована раньше бота намеренно: всё, что в ней настраивается, —
это и есть спецификация бота.

## С чего начать

Бэкенд и бот: [`telegram-bot/README.md`](telegram-bot/README.md) — там же
настройка BotFather, импорт справочника городов и деплой.

Панель:

```bash
cd admin-panel && npm install && npm run dev
```

## Документы

- [`ADMIN_PANEL_PROMPT.md`](ADMIN_PANEL_PROMPT.md) — задание на панель
- [`DESIGN_PROMPT.md`](DESIGN_PROMPT.md), [`CLAUDE_DESIGN_PROMPT.md`](CLAUDE_DESIGN_PROMPT.md) — задания на дизайн бота
- [`telegram-bot/DECISIONS.md`](telegram-bot/DECISIONS.md) — принятые решения и найденные в спецификации расхождения
- Прототип панели: https://claude.ai/artifact/371yjFJmFtLZvAkxr7MPuR
