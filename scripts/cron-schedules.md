# Расписание кронов (источник правды)

> **При переходе на локальный сервер (Mac mini)** — выставить **все** интервалы как в таблице ниже (колонка «Задумано / local»).  
> На Vercel Hobby часть заданий урезана (лимит cron); это **временный** компромисс, не целевая схема.

Часовой пояс crontab на Mac mini = **МСК**. В `vercel.json` расписание в **UTC**.

| Job | Эндпоинт | Задумано (local / crontab МСК) | Сейчас на Vercel (UTC) | Примечание |
|-----|----------|--------------------------------|------------------------|------------|
| dismiss-notifications | `/api/cron/dismiss-notifications` | `1 0 * * *` (00:01) | `1 21 * * *` | как задумано |
| avito-sync | `/api/cron/avito-sync` | `15 8 * * *` (08:15) | `15 5 * * *` | как задумано |
| demand-radar | `/api/cron/demand-radar` | `0 9 * * *` (09:00) | `0 6 * * *` | как задумано |
| callout-winners | `/api/cron/callout-winners` | `30 9`, `0 14`, `0 18` | `30 6`, `0 11`, `0 15` | 3×/сутки |
| competitor-prices | `/api/cron/competitor-prices` | `0 10 * * *` (10:00) | `0 7 * * *` | как задумано |
| planner-learn | `/api/cron/planner-learn` | `20 23 * * *` (23:20) | `20 20 * * *` | как задумано |
| scout-sensors-daily | `/api/cron/scout-sensors-daily` | `50 23 * * *` (23:50) | `50 20 * * *` | суточные датчики СКАУТ → БД |
| **scout-sync (GPS)** | `/api/cron/scout-sync` | **`*/2 * * * *` (каждые 2 мин)** | **нет в vercel.json** | Hobby не даёт чаще 1×/сутки; до cutover — `lib/localCrons.ts` / Mac crontab |

План cutover: [`.cursor/plans/переход_на_mac_mini.plan.md`](../.cursor/plans/переход_на_mac_mini.plan.md) → **Фаза 4**.

Ручной вызов:

```bash
npm run cron:scout           # GPS
npm run cron:scout-sensors   # датчики за сутки
bash scripts/cron-curl.sh <suffix>   # любой job
```
