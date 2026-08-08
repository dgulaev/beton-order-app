---
name: Переход на Mac mini
overview: "ЕДИНСТВЕННЫЙ план перехода. Шаги 0–12 (Шаг 11 = деплой на mini; Шаг 12 = бэкап кода в GitHub как раньше). Полный текст: .cursor/plans/переход_на_mac_mini.plan.md — открой как файл (Cmd+P). Фраза с Mac mini: «Сейчас пишу с Mac mini сервера. Папка: ~/…. Продолжаем .cursor/plans/переход_на_mac_mini.plan.md. Сейчас на шаге: …»"
todos:
  - id: precheck-dev
    content: "Перед cutover: финальный коммит+деплой на Vercel (уже делали, повторить), свежий GitHub db-backup, ручной curl трёх кронов"
    status: pending
  - id: mac-setup
    content: "Mac mini: Docker Desktop, Node LTS, Git, libpq, sleep off, автологин, Restart after power failure, статический LAN IP"
    status: pending
  - id: supabase-restore
    content: npx supabase start + restore свежего backup-*.sql.gz + проверка таблиц/логина
    status: pending
  - id: env-and-app
    content: Собрать .env.local (локальные Supabase-ключи + токены), npm install/build/start
    status: pending
  - id: autostart-launchd
    content: "Автозапуск после сбоя питания: Docker Login Items + launchd скрипты supabase/next с KeepAlive"
    status: pending
  - id: remote-access
    content: "Удалённое управление: SSH + Screen Sharing в LAN; снаружи — Tailscale; шпаргалка launchctl/docker/логи"
    status: pending
  - id: local-crons
    content: "Шаг 6: crontab со ВСЕМИ задуманными интервалами (cron-schedules.md), scout-sync */2; ENABLE_LOCAL_CRONS=0"
    status: pending
  - id: local-backups-github
    content: Локальный pg_dump → скрипт → git push в GitHub; отключить облачный db-backup.yml после cutover
    status: pending
  - id: keenetic-internet
    content: "Keenetic Ultra: tradecom.keenetic.link + проброс 80/443 + Caddy HTTPS; NEXT_PUBLIC_APP_URL; staff/водители из интернета"
    status: pending
  - id: local-backups-cutover
    content: Cutover закладок операторов, пауза Vercel production
    status: pending
  - id: post-cutover-deploy-db-sync
    content: "Шаг 11: деплой с ноутбука на mini (git+deploy.sh); локальный Supabase на ноуте; миграции SQL в git"
    status: pending
  - id: code-backup-github
    content: "Шаг 12: бэкап кода на GitHub — commit+push в main как раньше (история = бэкап); .env.local не коммитить"
    status: pending
isProject: false
---

# План перехода на локальный сервер (Mac mini M4)

> **Защита файла:** это единственный полный план. Не перезаписывать через CreatePlan / старую копию панели Plan.  
> Маркеры целостности: есть `## Порядок исполнения` и `## Шаг 12`. Если их нет — файл битый, восстановить из `~/.cursor/plans/переход_на_mac_mini_*.plan.md` или git.  
> Правило: `.cursor/rules/mac-mini-migration-plan.mdc`.

## Порядок исполнения (оглавление)

Идти **строго сверху вниз: Шаг 0 → Шаг 12**. В этом файле разделы идут **в том же порядке**, что и номера шагов.  
Блоки «Для агента», «Исходная точка», «Железо», «SQL-дамп» — справочно.

- **Шаг 0.** До переноса (ноутбук) — коммит, build, свежий db-backup  
- **Шаг 1.** Подготовка Mac mini — Docker, Node, sleep off, копия проекта  
- **Шаг 2.** База: Docker + Supabase + restore дампа  
- **Шаг 3.** `.env.local` на Mac mini  
- **Шаг 4.** Приложение: `npm run build` + `npm run start`  
- **Шаг 5.** Автозапуск после сбоя питания (launchd)  
- **Шаг 6.** Кроны — задуманные интервалы (включая scout-sync `*/2`)  
- **Шаг 7.** Удалённый доступ (SSH, Tailscale, Screen Sharing)  
- **Шаг 8.** Бэкапы **прод-БД с Mac mini** → GitHub по cron каждую ночь (`db-backups/*.sql.gz`) — как сейчас облачный backup, только источник = локальный Supabase  
- **Шаг 9.** Интернет: Keenetic + `tradecom.keenetic.link` + Caddy  
- **Шаг 10.** Cutover — день переключения с Vercel  
- **Шаг 11.** Деплой с ноутбука на Mac mini + синхронизация БД ← аналог деплоя на Vercel  
- **Шаг 12.** Бэкап кода на GitHub ← **как раньше: commit + push, история в репо**

После переезда ежедневно: **Шаг 12** (сохранить код в GitHub) → **Шаг 11** (выкатить на mini).

### Фраза-триггер с Mac mini (для пустого чата)

```
Сейчас пишу с Mac mini сервера. Папка: ~/ПУТЬ_К_ПРОЕКТУ.
Продолжаем .cursor/plans/переход_на_mac_mini.plan.md. Сейчас на шаге: N.
```

Агент обязан прочитать этот файл и продолжить с указанного шага (история чата с ноутбука не переносится).

> **Где читать план:** открой файл `.cursor/plans/переход_на_mac_mini.plan.md` через `Cmd+P` / Explorer.  
> Боковая панель «Plan» в Cursor часто показывает только краткий overview и todos — **не весь текст** (поэтому «Порядок исполнения» и фраза-триггер там могут быть не видны).

---

## Для агента Cursor — пустой чат на Mac mini (прочитай первым)

История чата с ноутбука Дмитрия **не переносится**. Если пользователь пишет с сервера фразы вроде:

- «пишу с Mac mini / с сервера»
- «продолжи план»
- «папка приложения здесь: …»
- «продолжим запуск»

то агент обязан:

1. **Прочитать этот файл целиком** (или минимум: этот блок + оглавление/`##` заголовки + текущую фазу):  
   `.cursor/plans/переход_на_mac_mini.plan.md`  
   (дубликат мог лежать в `~/.cursor/plans/переход_на_mac_mini_e4c0bcd2.plan.md` — сверять с копией в репо).
2. Уточнить/зафиксировать **абсолютный путь** к проекту (пользователь покажет). Дальше все команды — из этой папки.
3. Обращаться на **«ты»**, по имени **Дмитрий**, ответы **на русском** (правила репо).
4. **Не начинать cutover с нуля**, если уже что-то сделано: сначала быстро проверить факты на машине:
   - есть ли Docker, `docker info`;
   - `npx supabase status` / контейнеры;
   - есть ли `.env.local`, `node_modules`, `.next`;
   - слушает ли `:3000` (`curl -I http://127.0.0.1:3000`);
   - есть ли launchd `com.concrete.local-server`, crontab, Caddy;
   - резолвится ли `tradecom.keenetic.link`.
5. Спросить (если не сказано): **на каком шаге остановились** / что уже сделано. Отмечать прогресс в todos frontmatter этого плана (`pending` → `completed`) и коротко писать в чат «следующий шаг: …».
6. Идти **по порядку фаз** плана, не прыгать к KeenDNS/cutover, пока не подняты БД + `npm run start`, если пользователь явно не просит иначе.
7. Ключевые решения уже приняты (не пересогласовывать без нужды):
   - БД: **локальный Supabase в Docker**, не голый Postgres;
   - приложение: `npm run build` + `npm run start`, автозапуск через **launchd** + скрипт;
   - кроны: **macOS crontab** с **задуманными** интервалами из [`scripts/cron-schedules.md`](../../scripts/cron-schedules.md) + **Шаг 6** (не копировать урезанный Hobby/`vercel.json`);
   - админка удалённо: **SSH + Screen Sharing + Tailscale**;
   - публичный сайт: **Keenetic** домен **`https://tradecom.keenetic.link`**, проброс **80/443**, **Caddy** → `:3000` (не светить голый 3000 в интернет);
   - бэкапы БД после cutover: скрипт на mini → **git push** в `db-backups/` (**Шаг 8**);
   - бэкап кода: с ноута commit + `git push origin main` как раньше (**Шаг 12**);
   - после cutover: деплой на mini «push → pull+build» (**Шаг 11**); БД: две среды + миграции в git.
8. Секреты (`.env.local`, пароли, ключи) **не коммитить** и не светить лишний раз в чат.
9. Если пользователь только копирует план без всего репо — всё равно вести по этому файлу; недостающие скрипты (`start-local-server.sh`, `backup-db-to-github.sh`, `Caddyfile`, `cron-curl.sh`) создать на mini по тексту плана.

### Кроны: Hobby vs задумано (агент — запомнить)

**Лимит Vercel Hobby (почему сейчас урезано):**

- cron job на Hobby может запускаться **не чаще 1 раза в сутки**; выражение чаще раза в день → деплой падает;
- точность слота ~±59 мин (сработает когда-то в течение часа);
- до 100 cron entries на проект, но **частота** — главное ограничение.

**Что из-за этого сделано на облаке сейчас (`vercel.json`):**

- суточные jobs оставлены (dismiss, avito, demand, callout×3, competitor-prices, planner-learn, scout-sensors-daily, **nerudas-road-control** раз в месяц) — каждый слот ≤1×/сутки;
- **`/api/cron/scout-sync` (GPS каждые 2 мин) в vercel.json НЕТ** — Hobby запрещает `*/2`;
- до cutover GPS крутит [`lib/localCrons.ts`](lib/localCrons.ts) при `next dev`/`next start` вне Vercel (`ENABLE_LOCAL_CRONS` не `0`).

**На Mac mini после cutover — вернуть ВСЁ как задумано** (источник правды: [`scripts/cron-schedules.md`](../../scripts/cron-schedules.md)):

- `scout-sync` → crontab `*/2 * * * *`
- `scout-sensors-daily` → `50 23 * * *` МСК
- `nerudas-road-control` → `40 6 1 * *` МСК (1-го числа; прогон ~10–20 мин — на mini без таймаута Vercel)
- остальные суточные слоты МСК как в Шаге 6
- в `.env.local`: **`ENABLE_LOCAL_CRONS=0`** (чтобы не дублировать СКАУТ с процессом Next)
- **запрещено** ставить на mini только то, что в `vercel.json`, без `scout-sync */2`

### Чеклист агента: запуск проекта на Mac mini

Когда Дмитрий пишет с сервера «продолжи / запускаем»:

1. Прочитать этот план + `scripts/cron-schedules.md`.
2. Зафиксировать `APP_DIR` (путь, который покажет Дмитрий).
3. Проверить стек по порядку:
   - Docker Desktop running → `docker info`
   - `cd $APP_DIR && npx supabase status` (если down → `npx supabase start`)
   - есть `.env.local` с локальными Supabase-ключами + `CRON_SECRET` + `ENABLE_LOCAL_CRONS=0` (после настройки crontab)
   - `npm install` при необходимости → `npm run build` → приложение через launchd или временно `npm run start`
   - `curl -I http://127.0.0.1:3000`
4. Настроить **полный** crontab из **Шага 6** (все строки, включая `*/2` scout-sync).
5. Ручная проверка кронов:
   ```bash
   npm run cron:scout
   npm run cron:scout-sensors
   bash scripts/cron-curl.sh dismiss-notifications
   bash scripts/cron-curl.sh avito-sync
   bash scripts/cron-curl.sh demand-radar
   bash scripts/cron-curl.sh callout-winners
   bash scripts/cron-curl.sh competitor-prices
   bash scripts/cron-curl.sh planner-learn
   ```
6. Дальше по плану: launchd автозапуск → Tailscale/SSH → KeenDNS `tradecom.keenetic.link` + Caddy → бэкапы в GitHub → cutover Vercel.

Фраза-триггер — см. блок сразу под **«Порядок исполнения»** (начало файла).

### Как перенести `.cursor` на Mac mini (скрытая папка)

В Finder папки с точкой (`.cursor`) **не видны**, пока не включить показ скрытых файлов.

1. В Finder нажми **`Cmd + Shift + .`** (точка) — появятся `.cursor`, `.env.local`, `.git` и т.д. Повторное нажатие снова скроет.
2. Либо копируй **весь проект целиком** (AirDrop / внешний диск / `rsync` / `git clone`) — `.cursor` уедет вместе с ним, даже если в Finder её не видно.
3. Через Терминал на ноутбуке (пример на внешний диск):
   ```bash
   cp -R /Users/gudman/concrete-beton-app/.cursor /Volumes/USB/concrete-beton-app/
   # или весь проект:
   rsync -a --exclude node_modules --exclude .next ~/concrete-beton-app/ /Volumes/USB/concrete-beton-app/
   ```
4. На Mac mini после копирования проверь:
   ```bash
   ls ~/concrete-beton-app/.cursor/plans/переход_на_mac_mini.plan.md
   ```
5. **Предпочтительный способ:** на mini `git clone` / `git pull` репозитория — если план закоммичен в git. Если `.cursor` в `.gitignore` и в git нет — копируй папку `.cursor` вручную (`Cmd+Shift+.` или `cp -R` выше). Файл плана должен лежать как:  
   `…/concrete-beton-app/.cursor/plans/переход_на_mac_mini.plan.md`

---

## Исходная точка (сейчас)

> **⚠ Кроны при cutover:** на локальном сервере выставить **задуманные** интервалы для **всех** jobs — см. [`scripts/cron-schedules.md`](../../scripts/cron-schedules.md) и **Шаг 6**.  
> То, что сейчас в `vercel.json`, — облачный компромисс (Hobby: не чаще 1 cron/сутки на job; GPS `scout-sync` из vercel убран). **Не копировать урезанное облачное расписание на mini.**

- Приложение: Next.js на **Vercel**, кроны в `[vercel.json](vercel.json)` (UTC):
  - `/api/cron/dismiss-notifications` — `1 21 * * *` UTC (= **00:01 МСК**)
  - `/api/cron/avito-sync` — `15 5 * * *` UTC (= **08:15 МСК**)
  - `/api/cron/demand-radar` — `0 6 * * *` UTC (= **09:00 МСК**)
  - `/api/cron/callout-winners` — `30 6` / `0 11` / `0 15` UTC (= **09:30 / 14:00 / 18:00 МСК**)
  - `/api/cron/competitor-prices` — `0 7 * * *` UTC (= **10:00 МСК**)
  - `/api/cron/planner-learn` — `20 20 * * *` UTC (= **23:20 МСК**)
  - `/api/cron/scout-sensors-daily` — `50 20 * * *` UTC (= **23:50 МСК**) — суточные датчики СКАУТ → БД
  - `/api/cron/nerudas-road-control` — `40 3 1 * *` UTC (= **06:40 МСК 1-го числа**) — весы/Платон с nerudas.ru → слой на карте (~10–20 мин; на Vercel может оборваться по `maxDuration`, на mini — без лимита)
  - **`/api/cron/scout-sync` (GPS каждые 2 мин)** — **задумано** `*/2`, на Vercel Hobby **не в расписании**; до cutover крутит `[lib/localCrons.ts](lib/localCrons.ts)` / crontab на Mac
- **Локально (ноутбук / до cutover):** Vercel Cron не работает. Пока крутится `next dev` / `next start` **не на Vercel**, СКАУТ (GPS + проверка daily) поднимает `instrumentation.ts` → `[lib/localCrons.ts](lib/localCrons.ts)`. Выключить: `ENABLE_LOCAL_CRONS=0`. Ручной вызов: `npm run cron:scout` / `npm run cron:scout-sensors` / `npm run cron:nerudas`.
- БД: **Supabase Cloud**; ежедневный дамп в `[db-backups/](db-backups/)` (workflow `[.github/workflows/db-backup.yml](.github/workflows/db-backup.yml)`).
- Свежий снимок уже в репо: `db-backups/backup-2026-07-28.sql.gz` (~500 КБ) — нормальный размер, не «пустой» 20-байтный gzip.
- Приложение ходит в Supabase URL + anon/service_role + Realtime (`[lib/supabaseClient.ts](lib/supabaseClient.ts)`, `[lib/supabaseAdmin.ts](lib/supabaseAdmin.ts)`) — **голый Postgres в Docker недостаточен**. В Docker Desktop поднимаем **локальный стек Supabase** (`npx supabase start`).

```mermaid
flowchart LR
  subgraph now [Сейчас]
    Users1[Операторы] --> Vercel
    Vercel --> SupaCloud[Supabase Cloud]
    VercelCron[Vercel Cron] --> Vercel
  end
  subgraph target [Mac mini]
    Users2[Операторы LAN] --> NextStart["npm run start :3000"]
    MacCron[crontab curl] --> NextStart
    NextStart --> SupaLocal[Supabase Docker]
  end
  now --> target
```



## Оценка железа: Mac mini M4 16 ГБ / 256 ГБ

**Вердикт: подойдёт** для вашего завода (небольшой Next.js + локальный Supabase + единицы одновременных операторов). Это не «запас на годы роста», а рабочий минимум с дисциплиной по диску.

### RAM 16 ГБ — ок, с запасом небольшим

Ориентир потребления в простое/обычной работе:

- macOS + фоновые службы: ~3–4 ГБ
- Docker Desktop + стек Supabase (Postgres, Auth, Realtime, Kong, Studio…): обычно **~2–3.5 ГБ**, официально минимум 4 ГБ / рекомендуется 8 ГБ+ под Docker
- Next.js `npm run start`: обычно **~0.3–0.8 ГБ**
- Итого типично: **~8–12 ГБ**, пики ближе к 13–14 ГБ при `supabase start` / тяжёлом cron

Вывод: **16 ГБ хватает**, если на этом mini не держать Chrome с десятками вкладок, Xcode, второй IDE и т.п. В Docker Desktop выделить **6–8 ГБ** (не 4 и не все 14).

Риски по RAM: одновременный тяжёлый build (`npm run build`) + полный стек + Studio открыт — может подтормаживать/свопить. Build лучше делать в «тихий час», на работе крутить только `start`.

### Диск 256 ГБ — главное узкое место

По вашему проекту сейчас:

- БД крошечная: дамп ~0.5–2 МБ gzip, разжатый SQL ~4 МБ — **не проблема годами** при текущем объёме данных
- `node_modules` ~0.5 ГБ, прод-сборка обычно 0.5–2 ГБ (локальный `.next` на деве раздут — на сервере после чистого `build` будет меньше)
- Образы Docker Supabase при первом старте: порядка **3–8+ ГБ**, плюс volumes и кэш слоёв

Реалистичная раскладка 256 ГБ:

- macOS + обновления: ~40–60 ГБ
- Docker image/volume: ~20–40 ГБ со временем (если не чистить)
- Проект + логи + 14–30 дневных дампов: ~2–5 ГБ
- Свободно желательно держать **≥40–50 ГБ**

Итого: **влезет**, если:

- не ставить Xcode / тяжёлые приложения «на всякий случай»;
- раз в неделю `docker system prune` (и следить за Docker Disk image size в Settings → Resources);
- хранить дампы **14–30 дней**, старые — на внешний диск;
- Time Machine / большие бэкапы — **только на внешний SSD**, не на системный 256 ГБ.

Если диск начнёт забиваться — первый апгрейд по смыслу: **внешний SSD**, не обязательно новый Mac. Идеал на будущее: конфигурация **512 ГБ**, но для старта 256 ГБ приемлема.

### Если взять 512 ГБ вместо 256

**Предпочтительный вариант.** RAM 16 ГБ та же (этого хватает), а диск перестаёт быть главным риском:

- спокойно живут Docker images/volumes, логи, 30–90 дней дампов;
- можно держать Time Machine локально или большой запас без еженедельной паники;
- меньше шанс, что Docker «съест» систему и упадёт `supabase start` / `npm run build`.

Для завода **16/512 лучше, чем 16/256** именно из‑за диска. Покупать 32 ГБ ради текущего стека не обязательно.

### CPU M4 — с большим запасом

M4 для этого стека избыточен в хорошем смысле: Next API, кроны, склад, realtime для нескольких операторов — без проблем.

### Для каких сценариев 16/256 уже слабо

- десятки одновременных тяжёлых пользователей / публичный интернет-трафик;
- большие бинарники в Storage, тяжёлая аналитика, Logflare и т.п.;
- разработка (Cursor/Xcode) + прод на одной машине постоянно;
- рост БД до гигабайт без внешнего диска под бэкапы.

У вас профиль завода (несколько операторов, маленькая БД) — **вписывается**.

### Практические лимиты в настройках

- Docker Memory: **8 ГБ**, Swap 1–2 ГБ, Disk image start ~64 ГБ max (не раздувать заранее)
- Не включать лишнюю аналитику Supabase
- Studio (`http://127.0.0.1:54323`) открывать только для админки БД, не держать постоянно

---

## Шаг 0. До переноса (проверить на ноутбуке)

Сделай это **до** копирования папки на Mac mini.

1. **Финальный коммит + деплой на Vercel** — уже делали; перед переходом повторить, чтобы на Mac mini уезжал тот же код, что в проде. `.env.local` в git не класть; `node_modules` / `.next` на Mac mini ставить заново.
2. **Локальный смоук на текущей машине** (уже есть Docker + Node + `.env.local`):
  - `npm run build` → `npm run start`
  - логин в админку, склад, отгрузки, realtime (если используешь)
  - ручной вызов кронов с `Authorization: Bearer $CRON_SECRET`:
    ```bash
    curl -s -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/dismiss-notifications
    curl -s -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/avito-sync
    curl -s -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/demand-radar
    npm run cron:scout   # или: bash scripts/cron-curl.sh scout-sync
    ```
  - убедиться, что в логе `next dev` есть `[local-cron] включены` и через ~2 мин `[local-cron scout-sync] ok=…` (нужны `SCOUT_*` + `CRON_SECRET` в `.env.local`).
3. **Свежий дамп перед cutover** — в GitHub Actions вручную запусти workflow **Database Backup**, дождись коммита `backup-YYYY-MM-DD.sql.gz`, проверь размер файла **> 1 КБ** (лучше сотни КБ, как у сегодняшнего).
4. **Дисциплина по ресурсам на 16/256** (см. оценку железа выше):
  - Docker: Memory **8 ГБ**, Swap 1–2 ГБ; регулярно `docker system prune`.
  - Дампы 14–30 дней; внешний диск под старые бэкапы / Time Machine.
  - Не усыплять Mac mini; автозапуск через **launchd** (раздел ниже) — Terminal сам по себе после блекаута не оживает.
5. **Доступ staff/водителей из интернета** — через **Keenetic Ultra + KeenDNS** (проброс портов, см. отдельный раздел). Avito webhook тоже сможет бить на этот HTTPS; до настройки — cron `avito-sync` (polling).

---

## Шаг 1. Подготовка Mac mini (железо и софт)

Цель шага: на чистом (или почти чистом) Mac mini поставить всё ПО, настроить питание/сеть и положить проект в `~/concrete-beton-app` **без** `node_modules` / `.next`.  
После этого шага ещё нет работающего сайта — только готовая машина. Дальше → **Шаг 2** (БД).

### 1.1. Обновить macOS и открыть Терминал

1. Системные настройки → Основные → Обновление ПО — поставить доступные обновления (по возможности).
2. Открыть **Терминал** (Программы → Утилиты → Терминал).
3. Все команды ниже — в Терминале на Mac mini, если не сказано иное.

### 1.2. Установить Homebrew (если ещё нет)

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

После установки Apple Silicon обычно нужно добавить brew в PATH (скрипт установки сам подскажет), например:

```bash
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"
brew --version
```

### 1.3. Docker Desktop

1. Скачать с https://www.docker.com/products/docker-desktop/ вариант **Mac (Apple chip)** для M4.
2. Открыть `.dmg` → перетащить Docker в Программы → запустить **Docker**.
3. Принять лицензию / войти в аккаунт Docker (можно Skip, если предлагает).
4. Дождаться в строке меню иконки кита и статуса вроде **Docker Desktop is running** / Engine running.
5. Проверка:

```bash
docker version
docker info
```

Оба без ошибки «Cannot connect to the Docker daemon».

6. **Resources** (Docker Desktop → Settings → Resources):
   - Memory: **8 GB** (на Mac mini 16 GB);
   - Swap: 1–2 GB;
   - Disk image: не раздувать заранее (ориентир до ~64 GB).
7. General: включить **Start Docker Desktop when you sign in** (пригодится на Шаге 5).

Русского интерфейса у Docker Desktop нет — это нормально.

### 1.4. Node.js LTS (не v25 с дев-машины)

На сервере лучше **LTS 20 или 22**, не bleeding-edge.

Вариант через Homebrew:

```bash
brew install node@22
# если brew напишет про PATH — выполнить его подсказку, затем:
node -v    # ожидаем v22.x
npm -v
```

Или через официальный установщик с https://nodejs.org/ (кнопка LTS).

Не ставь на сервер то же v25 «потому что на ноуте так» — LTS стабильнее для `npm run start` 24/7.

### 1.5. Git

```bash
brew install git
git --version
```

Настройка имени для коммитов на mini нужна в основном боту бэкапов БД (Шаг 8); для обычного кода push идёт с ноутбука:

```bash
git config --global user.name "Mac mini server"
git config --global user.email "server@local"
```

### 1.6. Клиент Postgres (`psql`, `pg_dump`)

Нужен для restore дампа (Шаг 2) и ночных бэкапов (Шаг 8):

```bash
brew install libpq
brew link --force libpq
# или добавить в PATH, если brew так подскажет:
# echo 'export PATH="/opt/homebrew/opt/libpq/bin:$PATH"' >> ~/.zprofile
# source ~/.zprofile

psql --version
pg_dump --version
```

### 1.7. Проверка установленных версий (чеклист)

```bash
brew --version
docker info >/dev/null && echo docker_ok
node -v
npm -v
git --version
psql --version
pg_dump --version
```

Все команды должны отвечать без «command not found».

### 1.8. Питание: sleep off, автологин, restart after power failure

Чтобы после блекаута машина сама ожила (детали автозапуска приложения — **Шаг 5**):

```bash
sudo pmset -a autorestart 1
sudo pmset -a sleep 0 displaysleep 10 disksleep 0
pmset -g | grep -E 'autorestart|sleep'
```

Ожидание: `autorestart 1`, `sleep 0`.

**Автологин:** Системные настройки → Пользователи и группы → Параметры входа → **Автоматический вход** → пользователь сервера.  
Без автологина Docker Login Items и launchd пользователя после блекаута могут не стартовать.

**FileVault:** для сервера без присмотра лучше выключен (иначе после сбоя нужен пароль диска вручную).

### 1.9. Статический LAN IP (через Keenetic)

Чтобы проброс портов и закладки не «плыли»:

1. На Mac mini узнать текущий IP и MAC:

```bash
ipconfig getifaddr en0    # Wi‑Fi; для Ethernet часто en1
ifconfig en0 | grep ether
```

2. В веб-морде Keenetic → список устройств → найти Mac mini → **постоянный IP** / DHCP reservation (например `192.168.1.50`).
3. Переподключить сеть / перезагрузить mini → снова `ipconfig getifaddr en0` — адрес должен совпасть с зарезервированным.
4. Записать IP в заметки — понадобится на Шагах 7 и 9.

### 1.10. Скопировать проект на Mac mini

Рекомендуемый путь: **`~/concrete-beton-app`**.

**Что копировать:** код, `.cursor/` (план!), `db-backups/` со свежим дампом, `.env.local` можно отдельно (не в git).  
**Что НЕ копировать:** `node_modules/`, `.next/` — тяжёлые и под другую машину; ставятся на месте.

#### Способ A — git clone (предпочтительно, если код уже в GitHub)

```bash
cd ~
git clone <URL_РЕПО> concrete-beton-app
cd concrete-beton-app
git checkout main
git pull
ls .cursor/plans/переход_на_mac_mini.plan.md
ls db-backups/backup-*.sql.gz | tail -3
```

`.env.local` после clone создать вручную (Шаг 3) — в git его нет.

#### Способ B — копия папки с ноутбука (флешка / AirDrop / диск)

На **ноутбуке** (пример на внешний том `USB`):

```bash
rsync -a --exclude node_modules --exclude .next \
  ~/concrete-beton-app/ /Volumes/USB/concrete-beton-app/
```

Или в Finder: `Cmd+Shift+.` чтобы видеть `.cursor`, копировать всю папку проекта.  
На Mac mini: перенести в `~/concrete-beton-app`.

Проверка:

```bash
ls ~/concrete-beton-app/package.json
ls ~/concrete-beton-app/.cursor/plans/переход_на_mac_mini.plan.md
```

### 1.11. Установить зависимости npm (без запуска сайта)

```bash
cd ~/concrete-beton-app
npm install
# или, если есть package-lock.json и хочешь строгую установку:
# npm ci
```

Пока **не** обязательно `npm run build` — это Шаг 4, после БД и `.env.local`.  
Сейчас достаточно, что `node_modules` появился.

### 1.12. Чеклист Шага 1 — можно идти дальше?

- [ ] Homebrew установлен
- [ ] Docker Desktop: Engine running, Memory 8 GB, Start at login
- [ ] Node LTS 20/22 (`node -v`), npm ок
- [ ] Git, `psql`, `pg_dump` в PATH
- [ ] `autorestart 1`, sleep выключен, автологин включён
- [ ] Постоянный LAN IP на Keenetic, IP записан
- [ ] Проект в `~/concrete-beton-app`, план `.cursor/plans/переход_на_mac_mini.plan.md` на месте
- [ ] Свежий `db-backups/backup-*.sql.gz` есть (для Шага 2)
- [ ] `npm install` выполнен; `node_modules` есть; `.next` ещё может не быть

**Следующий шаг: Шаг 2** — поднять локальный Supabase и накатить дамп.

---

## Что входит в SQL-дамп (ответ про скрипты / RLS)

Дамп — это снимок **живого состояния облачной Postgres на момент `pg_dump`**, не «файлов скриптов из репо».

**Да, подтянется всё, что уже применено в облаке:**

- таблицы и данные (`CREATE TABLE` + `COPY`/inserts);
- RLS (`ENABLE ROW LEVEL SECURITY`) и политики (`CREATE POLICY`);
- функции/триггеры склада и прочего (`warehouse_*`, broadcast, balance и т.д.);
- `GRANT` / `REVOKE` (ACL) для `anon` / `authenticated` / `service_role`;
- схемы `auth` (пользователи логина), `public`, служебные куски Supabase.

Проверка по текущему `backup-2026-07-28.sql.gz`: около 89 таблиц, ~72 RLS, ~36 политик, десятки функций — дамп полноценный (~4 МБ в разжатом виде).

**Правило про ваши SQL-скрипты:**

- скрипт **уже выполняли** в Supabase Cloud (SQL Editor / `psql`) → изменения в БД → попадут в следующий backup;
- скрипт только лежит в `scripts/*.sql`, но в облако **не накатывали** → в дампе его **не будет** (нужно либо накатить в облако до backup, либо прогнать на локали после restore).

**Не входит / отдельно:**

- бинарные файлы Storage (сами объекты); метаданные buckets могут быть, файлы — нет (у вас Storage почти пустой — ок);
- секреты из Vercel / `.env.local` — это не БД;
- код Next.js — только через git/копию папки.

Перед cutover: финальный Database Backup **после** последних правок схемы в облаке.

---

## Шаг 2. База: Docker + локальный Supabase + restore

1. В корне проекта:
  ```bash
   npx supabase init   # если ещё нет supabase/config.toml
   npx supabase start
   npx supabase status # URL, anon key, service_role key, DB URL
  ```
2. Восстановить **самый свежий** дамп (после ручного backup в день переноса):
  ```bash
   gunzip -c db-backups/backup-YYYY-MM-DD.sql.gz | psql "$LOCAL_DB_URL"
  ```
   `LOCAL_DB_URL` — из `supabase status` (обычно `postgresql://postgres:postgres@127.0.0.1:54322/postgres`).
3. Нюансы restore (ожидаемо):
  - дамп содержит `public` + системные схемы Supabase; при ошибках на `auth`/`storage`/`realtime` — оставить системные схемы стека, главное чтобы поднялись таблицы приложения (`warehouse_*`, заказы, `mobile_notifications`, `integration_settings`, MEKA и т.д.);
  - роли `anon` / `authenticated` / `service_role` уже есть в локальном стеке; ACL из дампа как раз для них.
4. Проверка БД:
  - несколько ключевых таблиц (`\dt public.*` в `psql`);
  - свежие строки заказов/отгрузок по датам;
  - логин пользователя админки (Auth).

---

## Шаг 3. `.env.local` на Mac mini

Собрать env из текущего `.env.local` + Vercel Dashboard + ключей `supabase status`.

Обязательные:

- `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_URL` → локальный API (обычно `http://127.0.0.1:54321`)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_ANON_KEY` → локальный anon
- `SUPABASE_SERVICE_ROLE_KEY` → локальный service_role
- `CRON_SECRET` — тот же или новый длинный секрет
- `NEXT_PUBLIC_APP_URL` → сначала `http://<LAN-IP>:3000`, после интернета — `https://tradecom.keenetic.link`

Перенести без потерь (если используются):

- `DADATA_API_KEY`
- `MAX_BOT_TOKEN`, `MANAGER_CHAT_ID`
- `AVITO_CLIENT_ID`, `AVITO_CLIENT_SECRET`, `AVITO_USER_ID`, `AVITO_WEBHOOK_SECRET`, `AVITO_DEMAND_MESSENGER`
- `GOSPLAN_*`, `DEMAND_*` (см. `[scripts/leads-marketplace-env.example](scripts/leads-marketplace-env.example)`)

Важно: после переключения URL/ключей на локальный Supabase облачная БД больше не используется приложением на Mac mini. Облако можно оставить как read-only fallback до финального cutover.

---

## Шаг 4. Приложение: build + `npm run start`

```bash
cd ~/concrete-beton-app
npm install
npm run build
npm run start
# слушает :3000
```

Смоук с другого ПК/телефона в LAN: `http://<IP-Mac-mini>:3000` — логин, заказы, склад, мобильная админка.

Для повседневной работы завода **не держать** Terminal открытым: подключить launchd (раздел «Автозапуск»). Ручной `npm run start` — только для первой проверки или отладки (перед этим остановить агент через `launchctl bootout`).

---

## Шаг 5. Автозапуск после сбоя питания

Цель: после отключения электричества Mac mini сам включается, логинится, поднимает Docker → Supabase → `npm run start`, без открытия окна Terminal вручную.

Цепочка при восстановлении питания:

```mermaid
flowchart TD
  Power[Питание вернулось] --> Boot[macOS загрузился]
  Boot --> AutoLogin[Автологин пользователя]
  AutoLogin --> Docker[Docker Desktop Start at Login]
  Docker --> WaitEngine[Ждём docker info OK]
  WaitEngine --> Supabase[npx supabase start]
  Supabase --> NextApp["npm run start :3000"]
  NextApp --> Ready[Сайт снова доступен в LAN]
```



### A. Система macOS (обязательно)

1. **Автоматический вход** (иначе launchd пользователя и Docker Login Items не стартуют без пароля):
  - Системные настройки → Пользователи и группы → Параметры входа → **Автоматический вход** → выбрать пользователя сервера.
2. **Старт после сбоя питания** (на Apple Silicon обычно работает из коробки; проверить):
  ```bash
   sudo pmset -a autorestart 1
   pmset -g | grep autorestart
  ```
   Должно быть `autorestart 1`.
3. **Не усыплять**:
  ```bash
   sudo pmset -a sleep 0 displaysleep 10 disksleep 0
  ```
   Или в GUI: Энергия → не допускать автоматический переход Mac в сон при выключенном дисплее.
4. **Файл обмена / FileVault**: если включён FileVault, после сбоя нужен пароль диска до автологина — для «сервера без присмотра» FileVault лучше выключить на этом Mac mini (или принять ручной ввод пароля после блекаута).

### B. Docker Desktop — автозапуск

1. Открыть Docker Desktop → Settings (шестерёнка) → **General**:
  - включить **Start Docker Desktop when you sign in** (Start at login);
  - при наличии — **Open Docker Dashboard when Docker Desktop starts** можно выключить (не обязательно).
2. Resources: Memory **8 GB** (Mac mini 16 ГБ).
3. Проверка после ребута: иконка кита в меню, `docker info` без ошибки.

Docker сам контейнеры Supabase **не поднимает** после ребута надёжно в нужном порядке — поэтому следующий шаг через скрипт + launchd.

### C. Скрипт старта стека (Supabase + Next)

Создать файл `~/concrete-beton-app/scripts/start-local-server.sh`:

```bash
#!/bin/bash
set -euo pipefail

APP_DIR="$HOME/concrete-beton-app"
LOG_DIR="$APP_DIR/logs"
mkdir -p "$LOG_DIR"

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$APP_DIR"

# 1) Ждём Docker Engine (до ~3 мин)
for i in $(seq 1 60); do
  if docker info >/dev/null 2>&1; then
    echo "$(date '+%F %T') docker ready" >> "$LOG_DIR/autostart.log"
    break
  fi
  sleep 3
  if [ "$i" -eq 60 ]; then
    echo "$(date '+%F %T') docker NOT ready" >> "$LOG_DIR/autostart.log"
    exit 1
  fi
done

# 2) Поднимаем локальный Supabase (идемпотентно)
npx supabase start >> "$LOG_DIR/supabase.log" 2>&1

# 3) Ждём API Supabase
for i in $(seq 1 40); do
  if curl -sf "http://127.0.0.1:54321/rest/v1/" >/dev/null 2>&1 \
     || curl -sf "http://127.0.0.1:54321" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

# 4) Next.js prod (тот же npm run start)
# KeepAlive в launchd перезапустит процесс, если упадёт
exec npm run start >> "$LOG_DIR/next.log" 2>&1
```

Сделать исполняемым:

```bash
chmod +x ~/concrete-beton-app/scripts/start-local-server.sh
```

Перед первым автозапуском один раз вручную: `npm run build` (иначе `next start` упадёт без `.next`).

### D. launchd — вместо «вечного терминала»

1. Создать plist `~/Library/LaunchAgents/com.concrete.local-server.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.concrete.local-server</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>/Users/ИМЯ_ПОЛЬЗОВАТЕЛЯ/concrete-beton-app/scripts/start-local-server.sh</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>15</integer>
  <key>WorkingDirectory</key>
  <string>/Users/ИМЯ_ПОЛЬЗОВАТЕЛЯ/concrete-beton-app</string>
  <key>StandardOutPath</key>
  <string>/Users/ИМЯ_ПОЛЬЗОВАТЕЛЯ/concrete-beton-app/logs/launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/ИМЯ_ПОЛЬЗОВАТЕЛЯ/concrete-beton-app/logs/launchd.err.log</string>
</dict>
</plist>
```

Подставить реальное имя пользователя Mac (или `$HOME` руками в путях — в plist переменные оболочки не раскрываются).

1. Загрузить агент:

```bash
mkdir -p ~/concrete-beton-app/logs
launchctl bootout gui/$(id -u)/com.concrete.local-server 2>/dev/null || true
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.concrete.local-server.plist
launchctl enable gui/$(id -u)/com.concrete.local-server
launchctl kickstart -k gui/$(id -u)/com.concrete.local-server
```

1. Проверка:
  - `curl -I http://127.0.0.1:3000`
  - логи: `~/concrete-beton-app/logs/autostart.log`, `next.log`, `supabase.log`
  - тест сбоя: закрыть Terminal (если открыт) — сайт должен жить; убить процесс `kill` на node — launchd поднимет снова через ~15 сек; полный ребут / выдернуть питание (осторожно) — после возврата питания через 1–3 минуты сайт снова отвечает.
2. Остановка вручную (обслуживание):

```bash
launchctl bootout gui/$(id -u)/com.concrete.local-server
```

Запуск снова — командами bootstrap/kickstart выше.

### E. Что уже «само» переживает ребут

- **crontab** — задания остаются, начнут дергать URL, когда поднимется `:3000`.
- Данные Supabase в Docker volumes — переживают ребут; `supabase start` поднимает те же контейнеры/тома, restore дампа заново не нужен.

### F. Частые косяки

- Docker ещё не готов, а скрипт уже вызвал `supabase start` — поэтому цикл ожидания `docker info`.
- Нет `.next` после обновления кода — после `git pull` делать `npm install && npm run build`, потом `kickstart` агента.
- Порт 3000 занят старым процессом — `lsof -i :3000` и убить лишнее, либо `KeepAlive` сам разрулит после падения.
- Автологин выключен / FileVault — после блекаута всё «зависнет» на экране входа.

---

## Шаг 6. Кроны (macOS crontab, задуманные интервалы)

Vercel Cron на Mac mini не работает. Оставляем обычный `next start`, расписание — **системный crontab** (часовой пояс Mac = **МСК**).

### Обязательно: задуманные интервалы для ВСЕХ кронов

На Vercel часть расписания урезана (Hobby). **На локальном сервере вернуть целевую схему** — полная таблица: [`scripts/cron-schedules.md`](../../scripts/cron-schedules.md).

| Job | crontab МСК (задумано) | Зачем |
|-----|------------------------|--------|
| dismiss-notifications | `1 0 * * *` | сброс уведомлений |
| avito-sync | `15 8 * * *` | Авито polling |
| demand-radar | `0 9 * * *` | радар спроса |
| callout-winners | `30 9`, `0 14`, `0 18` | победители ЕИС |
| competitor-prices | `0 10 * * *` | прайсы конкурентов |
| planner-learn | `20 23 * * *` | калибровка планировщика |
| **scout-sensors-daily** | **`50 23 * * *`** | суточные датчики СКАУТ → БД |
| **scout-sync (GPS)** | **`*/2 * * * *`** | телематика → карта парка |
| **nerudas-road-control** | **`40 6 1 * *`** (1-го числа 06:40) | весы/Платон nerudas.ru → слой карты; лог в `road_control_sync_runs` |

Чеклист агента на Фазе 4: в crontab есть **каждая** строка из таблицы выше (не только dismiss/avito/demand/scout).

**СКАУТ GPS:** эндпоинт [`/api/cron/scout-sync`](app/api/cron/scout-sync/route.ts), интервал **каждые 2 минуты** — как задумано изначально. На ноутбуке до cutover тот же sync крутит `lib/localCrons.ts`. На Mac mini после cutover — **только crontab**, in-process выключить:

```bash
# в .env.local на Mac mini:
ENABLE_LOCAL_CRONS=0
```

Иначе СКАУТ будут дергать и crontab, и процесс Next — лишняя нагрузка.

```bash
crontab -e
```

Полный набор (подставить `CRON_SECRET` и путь `ИМЯ`; предпочтительно `scripts/cron-curl.sh` — секрет из `.env.local`):

```cron
# === Задуманные интервалы (МСК). См. scripts/cron-schedules.md ===
1 0 * * * curl -s -H "Authorization: Bearer CRON_SECRET" http://127.0.0.1:3000/api/cron/dismiss-notifications >> /tmp/cron-dismiss.log 2>&1
15 8 * * * curl -s -H "Authorization: Bearer CRON_SECRET" http://127.0.0.1:3000/api/cron/avito-sync >> /tmp/cron-avito.log 2>&1
0 9 * * * curl -s -H "Authorization: Bearer CRON_SECRET" http://127.0.0.1:3000/api/cron/demand-radar >> /tmp/cron-demand.log 2>&1
30 9 * * * curl -s -H "Authorization: Bearer CRON_SECRET" http://127.0.0.1:3000/api/cron/callout-winners >> /tmp/cron-callout.log 2>&1
0 14 * * * curl -s -H "Authorization: Bearer CRON_SECRET" http://127.0.0.1:3000/api/cron/callout-winners >> /tmp/cron-callout.log 2>&1
0 18 * * * curl -s -H "Authorization: Bearer CRON_SECRET" http://127.0.0.1:3000/api/cron/callout-winners >> /tmp/cron-callout.log 2>&1
0 10 * * * curl -s -H "Authorization: Bearer CRON_SECRET" http://127.0.0.1:3000/api/cron/competitor-prices >> /tmp/cron-competitors.log 2>&1
20 23 * * * curl -s -H "Authorization: Bearer CRON_SECRET" http://127.0.0.1:3000/api/cron/planner-learn >> /tmp/cron-planner.log 2>&1
50 23 * * * /Users/ИМЯ/concrete-beton-app/scripts/cron-curl.sh scout-sensors-daily >> /tmp/cron-scout-sensors.log 2>&1
# Телематика СКАУТ GPS → карта парка (каждые 2 мин) — ОБЯЗАТЕЛЬНО на local
*/2 * * * * /Users/ИМЯ/concrete-beton-app/scripts/cron-curl.sh scout-sync >> /tmp/cron-scout.log 2>&1
# Весы / Платон (nerudas.ru) — 1-го числа 06:40 МСК; прогон ~10–20 мин, без лимита Vercel
40 6 1 * * /Users/ИМЯ/concrete-beton-app/scripts/cron-curl.sh nerudas-road-control >> /tmp/cron-nerudas.log 2>&1
```

Проверка сразу (не ждать расписания):

```bash
npm run cron:scout
npm run cron:scout-sensors
npm run cron:nerudas
# или
bash scripts/cron-curl.sh scout-sync
bash scripts/cron-curl.sh scout-sensors-daily
bash scripts/cron-curl.sh nerudas-road-control
```

Ожидание GPS: HTTP 200, JSON с `success`, `mapped`, `snapshotsUpdated`. В UI «Парк на карте» бейдж **«Обновлено N мин назад»** уходит к 0–2 мин.

Ожидание nerudas: HTTP 200, JSON с `success`, `upserted`, `inserted`, `updated`; в UI легенды карты — **«обновлено ДД.ММ · N точ.»** (таблица `road_control_sync_runs`).

Остальные `curl` — HTTP 200 и JSON без `Unauthorized`.

Секцию `"crons"` в `[vercel.json](vercel.json)` на Mac mini можно не трогать (без Vercel не используется); после окончательного ухода с Vercel — убрать, чтобы не путать. **Источник правды на mini — crontab + [`scripts/cron-schedules.md`](../../scripts/cron-schedules.md), не облачный vercel.json.**

---

## Шаг 7. Удалённый доступ (SSH, Tailscale, Screen Sharing)

Цель: с ноутбука/телефона перезапустить Next/Docker/Supabase, смотреть логи, обновлять код — **без поездки к серверу**.  
Операторы по-прежнему ходят в приложение по LAN (`http://<IP>:3000`). Удалёнка ниже — для **тебя как админа**.

```mermaid
flowchart LR
  AdminLaptop[Ноутбук админа] --> Tailscale[Tailscale VPN]
  AdminPhone[Телефон] --> Tailscale
  FactoryPC[ПК на заводе LAN] --> LAN[Локальная сеть]
  Tailscale --> MacMini[Mac mini]
  LAN --> MacMini
  MacMini --> SSH[SSH терминал]
  MacMini --> VNC[Screen Sharing GUI]
  SSH --> Procs[launchctl docker logs]
```



### Выбранная схема

- **На заводе (LAN):** SSH + Screen Sharing по локальному IP — быстро, без интернета.
- **Из дома / в дороге:** **Tailscale** → тот же SSH / Screen Sharing — безопасно, без проброса портов на роутере.
- **Не делать:** проброс 22/5900 в интернет «как есть» — сканеры и брутфорс.

**Tailscale** — админский VPN (SSH / Screen Sharing).  
**Публичный сайт для staff/водителей** — не через Tailscale и не через зарубежный Cloudflare: **Keenetic Ultra + KeenDNS + проброс 80/443** (см. раздел ниже).

### A. Включить на Mac mini (один раз)

1. **Удалённый вход (SSH)**
  Системные настройки → Основные → Общий доступ (или Sharing) → **Удалённый вход** / Remote Login → Вкл.  
   Разрешить доступ: только твоему пользователю (не «всем»).
2. **Общий экран (Screen Sharing)** — подробная настройка в подразделе **E** ниже.
3. **Узнать адреса**
  ```bash
   ipconfig getifaddr en0   # LAN, часто Wi‑Fi; для Ethernet может быть en1
   scutil --get LocalHostName
   whoami                   # короткое имя пользователя для входа
  ```
   В LAN: `ssh ИМЯ@192.168.x.x` или `ssh ИМЯ@имя-mac.local` (Bonjour).
4. **Сложный пароль** пользователя Mac (или лучше SSH-ключ — см. ниже). Автологин для сервера остаётся, но пароль должен быть сильным — он же для Screen Sharing.

### B. SSH-ключ (рекомендуется)

На своём ноутбуке:

```bash
ssh-keygen -t ed25519 -C "admin-to-macmini"
ssh-copy-id ИМЯ@192.168.x.x
```

Потом вход без пароля:

```bash
ssh ИМЯ@192.168.x.x
```

### C. Tailscale Connected — подробная инструкция

**Зачем:** безопасный «личный VPN» между твоими устройствами. Mac mini на заводе и ноутбук/телефон дома получают адреса `100.x.x.x` и видят друг друга **без** проброса портов на роутере. Через Tailscale ходим по SSH и Screen Sharing.

**Статус Connected** = клиент вошёл в твой tailnet, туннель жив, устройство видно в админке и пингуется с других машин.

```mermaid
flowchart LR
  HomeMac[Ноутбук дома] --> TS[Tailscale mesh]
  Phone[iPhone] --> TS
  TS --> Mini[Mac mini завод]
  Mini --> SSH2[SSH :22]
  Mini --> VNC2[Screen Sharing :5900]
```



Personal-план (вход через Gmail/Apple/Microsoft): до 6 пользователей бесплатно — для завода более чем достаточно.

#### C1. Создать аккаунт / tailnet (один раз)

1. На любом устройстве открыть [https://tailscale.com](https://tailscale.com) → **Get Started** / Sign up.
2. Войти через **Google / Apple / Microsoft** (лучше личный аккаунт, которым пользуешься постоянно).
3. Выбрать **Personal use** (личное использование), если спросят.
4. Откроется админка: [https://login.tailscale.com/admin/machines](https://login.tailscale.com/admin/machines) — пока пусто или с первым устройством.

Все устройства (Mac mini, ноутбук, телефон) должны входить **в один и тот же** аккаунт / один tailnet. Иначе друг друга не увидят.

#### C2. Установить и подключить Mac mini (сервер)

1. Скачать клиент для Mac (Apple Silicon): [https://tailscale.com/download/mac](https://tailscale.com/download/mac)
  Или App Store → «Tailscale».
2. Установить → открыть **Tailscale**.
3. При первом запуске macOS может спросить разрешения:
  - добавить сетевое расширение / VPN-конфигурацию → **Разрешить**;
  - доступ в локальную сеть → **ОК**;
  - в Системные настройки → Конфиденциальность → если просят — разрешить Tailscale.
4. В меню Tailscale (иконка в строке меню сверху) нажать **Log in** / Войти → тот же аккаунт, что в C1.
5. Дождаться статуса **Connected** (Подключено) в меню.
  Если пишет **Disconnected** / Logged out — снова Log in; если **Needs approval** — см. C6.
6. В меню Tailscale скопировать **IP** вида `100.x.x.x` (или Look up IP / This device).
  Записать его в заметки: это адрес mini «с улицы».
7. В админке [https://login.tailscale.com/admin/machines](https://login.tailscale.com/admin/machines) должно появиться устройство (часто имя как hostname Mac). Можно переименовать в `mac-mini-zavod` (⋯ → Edit machine name).

**Автозапуск после ребута (обязательно на сервере):**

- Меню Tailscale → **Settings** / Preferences:
  - включить **Start Tailscale at login** / Start on login (формулировка может чуть отличаться);
  - оставить VPN/туннель активным после входа пользователя.
- На mini у нас уже **автологин** пользователя — без него GUI-клиент Tailscale после блекаута может не подняться, пока никто не вошёл в систему.
- Проверка: перезагрузить mini → через 1–2 минуты с телефона (мобильный интернет) статус устройства в админке **Connected**, IP `100.x.x.x` пингуется.

Опционально в Терминале на mini (если установлен CLI):

```bash
tailscale status
tailscale ip -4
```

Ожидание: своя строка Online и адрес `100.…`.

#### C3. Подключить ноутбук админа (второй Mac)

1. Установить Tailscale так же (сайт или App Store).
2. **Log in** тем же аккаунтом.
3. Дождаться **Connected**.
4. Проверка связи с mini:
  ```bash
   ping 100.x.x.x
   # или, если MagicDNS включён (по умолчанию да):
   ping mac-mini-zavod
   # иногда суффикс:
   ping mac-mini-zavod.tailnet-name.ts.net
  ```
5. SSH:
  ```bash
   ssh ИМЯ_ПОЛЬЗОВАТЕЛЯ@100.x.x.x
  ```
6. Screen Sharing: Finder → `Cmd + K` → `vnc://100.x.x.x` (см. раздел E).

Пока оба **Connected**, неважно, что mini в сети завода, а ты на домашнем Wi‑Fi или LTE.

#### C4. Подключить iPhone / iPad

1. App Store → **Tailscale** → установить.
2. Открыть → **Sign in** тем же аккаунтом → дождаться **Connected** / VPN-иконка активна.
3. В приложении увидеть список машин и IP mini `100.x.x.x`.
4. Для SSH: Termius / Prompt / Blink → хост `100.x.x.x`, пользователь macOS, ключ или пароль.
5. Для экрана: Jump Desktop / Screens / VNC Viewer → `100.x.x.x`.

На iOS VPN Tailscale должен быть **включён**, пока работаешь с удалёнкой (шторка / приложение Tailscale).

#### C5. Админка Tailscale — полезные настройки

Открыть [https://login.tailscale.com/admin/](https://login.tailscale.com/admin/)

- **Machines** — список устройств, Online/Offline, IP `100.…`, переименование, Disable/Remove lost device.
- **DNS → MagicDNS** — оставить **включенным**: можно `ssh user@mac-mini-zavod` вместо запоминания IP.
- **Settings → Keys** — auth keys для автоматизации (на старте не обязательно).
- **Access controls** — по умолчанию устройства одного хвоста видят друг друга; позже можно сузить правила, если появятся чужие пользователи.

**Не нужно** для нашего сценария на старте:

- Exit Node (гнать весь интернет через завод);
- Subnet router (открывать всю LAN завода в Tailscale) — только если потом захочешь ходить на принтеры/ПК без клиента Tailscale;
- Funnel / Cloudflare Tunnel — не нужны для сайта: публичный доступ делаем через KeenDNS + проброс на Keenetic.

#### C6. Если не Connected / не пингуется

1. **Logged out** — Log in снова тем же аккаунтом.
2. **Needs approval / pending** — в админке Machines → Approve device (если включено ручное одобрение).
3. **Connected, но ping не идёт**:
  - на обеих машинах статус Connected;
  - в Machines оба Online;
  - выключен файрвол, режущий Tailscale (на macOS: разрешить входящие для Tailscale);
  - корпоративный/гостевой Wi‑Fi с жёстким VPN-фильтром — проверить с LTE на телефоне.
4. После ребута mini **Offline** в админке:
  - нет автологина пользователя;
  - не включён Start Tailscale at login;
  - клиент ждёт клика «Allow» по системному диалогу — зайти по Screen Sharing из LAN один раз и подтвердить.
5. Два разных Apple/Google-аккаунта на mini и ноутбуке → разные tailnet → не увидят друг друга. Перелогинить в один.
6. Устройство старое/потерянное — Remove в админке, поставить Tailscale заново, Log in.

#### C7. Как пользоваться каждый день

- **На заводе (LAN):** можно без Tailscale: `ssh` / `vnc://192.168.…`.
- **Из дома:** сначала проверить иконку Tailscale → **Connected** на ноутбуке → затем:
  ```bash
  ssh ИМЯ@100.x.x.x
  # или
  open vnc://100.x.x.x
  ```
- Перед дорогой один раз проверить: mini в админке Online после обычного ребута.

#### C8. Безопасность Tailscale

- Не шарить приглашения в tailnet посторонним.
- Утерянный ноутбук/телефон: админка → Machines → **Disable** / Remove; сменить пароль провайдера входа (Google/Apple).
- Порты 22/5900 на роутере завода **не** открывать — доступ только пока удалённое устройство Logged in в твой Tailscale.
- Операторам завода клиент Tailscale **не нужен** — им только сайт `:3000` в LAN.

#### C9. Чеклист Tailscale

- [ ] Аккаунт создан, Personal use
- [ ] Mac mini: установлен, Log in, статус **Connected**, IP `100.…` записан
- [ ] Start Tailscale at login + автологин macOS
- [ ] Ноутбук: Connected, `ping 100.…` OK
- [ ] `ssh` на mini по `100.…` OK
- [ ] `vnc://100.…` (Screen Sharing) OK
- [ ] iPhone: Connected (опционально)
- [ ] Ребут mini → через 1–2 мин снова Online / Connected без ручных кликов
- [ ] MagicDNS: устройство переименовано (`mac-mini-zavod`)

### D. Шпаргалка: управление процессами по SSH

После `ssh` на Mac mini:

**Статус**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000
docker info >/dev/null && echo docker_ok || echo docker_down
cd ~/concrete-beton-app && npx supabase status
launchctl print gui/$(id -u)/com.concrete.local-server | head -40
tail -n 50 ~/concrete-beton-app/logs/next.log
tail -n 50 ~/concrete-beton-app/logs/autostart.log
```

**Перезапуск приложения (Next + ожидание Docker/Supabase через наш скрипт)**

```bash
launchctl kickstart -k gui/$(id -u)/com.concrete.local-server
```

**Остановить / запустить агент**

```bash
launchctl bootout gui/$(id -u)/com.concrete.local-server
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.concrete.local-server.plist
launchctl kickstart -k gui/$(id -u)/com.concrete.local-server
```

**Только Supabase**

```bash
cd ~/concrete-beton-app
npx supabase stop
npx supabase start
```

**Docker Desktop** (если Engine мёртв — иногда нужен GUI/Screen Sharing)

```bash
open -a Docker
# подождать, пока docker info заработает
```

**Обновление кода с удалёнки**

```bash
cd ~/concrete-beton-app
git pull
npm install
npm run build
launchctl kickstart -k gui/$(id -u)/com.concrete.local-server
```

**Ребут всего Mac** (крайний случай)

```bash
sudo reboot
```

После ребута: автологин → Docker → launchd → сайт (см. раздел автозапуска). Через 1–3 минуты снова `ssh` / `curl`.

### E. Общий экран (Screen Sharing) — подробная инструкция

**Зачем:** видеть рабочий стол Mac mini как будто сидишь перед ним — Docker Desktop, окна, настройки. Для повседневных перезапусков удобнее SSH; Screen Sharing — когда нужен GUI.

**Когда открывать GUI:**

- Docker Desktop «завис», просит логин/обновление/лицензию;
- нужно изменить Memory/Disk в Docker → Settings → Resources;
- непонятная ошибка, хочется видеть меню кита и уведомления macOS;
- SSH не помогает.

#### E1. Включить на Mac mini (сервер)

Интерфейс macOS Sequoia / Tahoe (названия могут чуть отличаться):

1. Открыть **Системные настройки** (System Settings).
2. Слева: **Основные** (General) → **Общий доступ** (Sharing).
  На части систем: сразу пункт **Общий доступ** в боковом списке.
3. Найти переключатель **Общий экран** (Screen Sharing) → **включить**.
4. Нажать кнопку **i** / **Подробнее** рядом с «Общий экран» (если есть):
  - **Разрешить доступ для:** выбрать **Только этим пользователям** (Only these users);
  - нажать **+** → добавить **только свой** аккаунт админа (не «Administrators» всем подряд, если на машине есть другие люди);
  - при наличии опции вроде «Anyone may request permission…» / «Гости» — **выключить**.
5. Запомнить строку подключения, которую показывает macOS, например:
  `vnc://192.168.1.50` или `vnc://Mac-mini.local`.
6. Убедиться, что у пользователя **есть пароль** (не пустой) — иначе удалённый вход в экран часто не пускает.
7. Firewall (если включён): Системные настройки → Сеть → Firewall / Защита → разрешить **Screen Sharing** / входящие для общего экрана. На чистом Mac mini Firewall часто выключен — тогда ничего делать не нужно.

Проверка, что служба слушает (в Терминале на mini):

```bash
sudo lsof -iTCP:5900 -sTCP:LISTEN
```

Должна быть строка с `screensharing` / портом **5900**.

#### E2. Подключение с другого Mac в той же сети (завод)

**Способ 1 — Finder (самый простой)**

1. На ноутбуке открыть **Finder**.
2. Меню **Переход** → **Подключение к серверу…** (Go → Connect to Server…), или `Cmd + K`.
3. Ввести один из вариантов:
  - `vnc://192.168.x.x` — IP Mac mini из `ipconfig getifaddr en0`;
  - `vnc://Имя-Mac.local` — локальное имя (`scutil --get LocalHostName`).
4. Нажать **Подключить**.
5. Выбрать **Зарегистрированный пользователь** (Registered User):
  - Имя: короткое имя пользователя mini (`whoami` на сервере), не Apple ID email, если вход локальный;
  - Пароль: пароль этого пользователя на Mac mini.
6. Откроется окно **Screen Sharing** с рабочим столом mini. Мышь и клавиатура управляют удалённым Mac.

**Способ 2 — приложение «Общий экран»**

1. Spotlight (`Cmd + Space`) → набрать **Screen Sharing** / **Общий экран**.
2. Ввести IP или `имя.local` → Connect.
3. Логин/пароль как выше.

**Способ 3 — боковая панель Finder**

Если оба Mac в одной сети и видны в разделе **Сеть** (Network): выбрать Mac mini → кнопка **Общий экран** / Share Screen.

#### E3. Подключение из дома через Tailscale

1. На Mac mini и на ноутбуке Tailscale в статусе **Connected**.
2. На mini скопировать адрес Tailscale: меню кита Tailscale → IP вида `100.x.x.x`
  (или в админке [https://login.tailscale.com/admin/machines](https://login.tailscale.com/admin/machines)).
3. На ноутбуке: Finder → `Cmd + K` →
  `vnc://100.x.x.x`  
   → логин/пароль пользователя Mac mini.
4. **Не** пробрасывать порт 5900 на роутере — только через Tailscale.

#### E4. Подключение с Windows / iPhone (кратко)

- **Windows:** клиент VNC (RealVNC Viewer, TightVNC) → хост `192.168.x.x` или `100.x.x.x`, порт 5900, логин/пароль macOS. Иногда macOS просит отдельно разрешить «доступ к экрану» для не-Apple клиентов — тогда проще зайти один раз с Mac или через SSH.
- **iPhone/iPad:** Tailscale + приложение вроде **Screens**, **Jump Desktop**, **VNC Viewer** → тот же `100.x.x.x`. Для админки завода удобнее ноутбук; телефон — запасной вариант.

#### E5. Полезные настройки во время сессии

В меню приложения Screen Sharing на ноутбуке:

- **View → Adapt to size / Actual size** — масштаб окна;
- качество картинки — при слабом интернете снизить (если пункт есть);
- буфер обмена: копирование текста между Mac часто работает; большие файлы лучше через `scp`/AirDrop/общую папку, не через экран;
- не выключать Mac mini из меню Apple → Shut Down без нужды — лучше `sudo reboot` осознанно или просто закрыть окно Screen Sharing (это только отключает тебя, сервер продолжает работать).

Закрытие окна Screen Sharing на ноутбуке **не останавливает** Docker и `npm run start` на mini.

#### E6. Если не подключается — чеклист

1. Mac mini включён, пользователь залогинен (автологин после блекаута).
2. Screen Sharing переключатель **зелёный/вкл** в Общем доступе.
3. Ты в той же Wi‑Fi/LAN **или** оба в Tailscale Connected.
4. Верный IP: `ping 192.168.x.x` или `ping 100.x.x.x`.
5. Верное имя пользователя (`whoami` на mini) и пароль.
6. На mini не включён режим, блокирующий удалённое управление; перезапуск службы:
  ```bash
   sudo launchctl kickstart -k system/com.apple.screensharing
  ```
7. Антивирус/роутер «изоляция клиентов Wi‑Fi» (AP isolation) — выключить: иначе телефоны/ноутбуки в Wi‑Fi не видят mini.
8. После смены пароля пользователя — подключаться уже **новым** паролем.

#### E7. Безопасность

- Screen Sharing только для админа; операторам завода не нужен.
- Из интернета — **только через Tailscale** (или другой VPN), не открывать 5900 на белый IP.
- Пароль пользователя Mac — длинный; по возможности не совпадает с паролями сайта/Supabase.
- Если кто-то уволился и знал пароль mini — сменить пароль пользователя и проверить список разрешённых в «Общий экран».

### F. Чего не делать

- Не пробрасывать порты 22 и 5900 на белый IP роутера без VPN.
- Не давать SSH «всем пользователям».
- Не путать: **доступ операторов к сайту** (`:3000`) и **твой админский SSH/VNC** — разные вещи. Операторам SSH не нужен.
- Публичный сайт (KeenDNS) ≠ админка по Tailscale: операторам Tailscale не ставим; SSH/VNC в интернет не открываем.

### G. Минимальный чеклист удалёнки

- [ ] Remote Login (SSH) вкл, только твой user
- [ ] Screen Sharing вкл, только твой user
- [ ] SSH-ключ с личного ноутбука
- [ ] Tailscale на Mac mini + личных устройствах, Start at login
- [ ] Проверка из LAN: `ssh` + `kickstart`
- [ ] Проверка «с улицы» (мобильный интернет): `ssh` на `100.x.x.x` + `curl` сайта через LAN IP или через туннель позже

---

## Шаг 8. Бэкапы локальной БД → GitHub

**Да — прод-база на Mac mini будет бэкапиться на GitHub по cron**, как сейчас облачная.  
Сейчас: GitHub Action раз в сутки → `db-backups/backup-YYYY-MM-DD.sql.gz`.  
После cutover: **crontab на mini в 05:00 МСК** → `pg_dump` локального Supabase → тот же `db-backups/` → `git push` в GitHub. Файлы в репо те же по смыслу.

После cutover прод — Postgres в Docker на Mac mini. Облачный Action `[.github/workflows/db-backup.yml](.github/workflows/db-backup.yml)` на `SUPABASE_DB_URL` **уже не отражает прод** (раннер не видит БД на mini) — его отключаем; вместо него скрипт на сервере.

Схема: **Mac mini сам** делает `pg_dump`, кладёт файл в `db-backups/`, коммитит и пушит в GitHub.

```mermaid
flowchart LR
  Cron[crontab 05:00 МСК] --> Script[backup-db-to-github.sh]
  Script --> Dump["pg_dump → backup-DATE.sql.gz"]
  Dump --> Prune[удалить старше 30 дней]
  Prune --> Git[git add commit push]
  Git --> GH[GitHub db-backups/]
```



Почему не оставить только Action: Actions не достучатся до локальной БД без сложного Tailscale subnet / открытого порта. Пуш **с mini** проще и надёжнее.

### 5.1. Подготовка git на Mac mini (один раз)

1. Клон репо на mini (если ещё нет): `git clone … ~/concrete-beton-app`, ветка `main`.
2. На mini должен быть доступ на `git push` в этот репозиторий:
  - **предпочтительно:** SSH deploy key (read/write) только для этого репо; или
  - Personal Access Token (fine-grained) с `contents: write`, сохранённый в macOS Keychain через `gh auth login` / credential helper.
3. Проверка вручную:
  ```bash
   cd ~/concrete-beton-app
   git status
   git pull --ff-only
   # тестовый пустой push не нужен — достаточно:
   git ls-remote origin HEAD
  ```
4. Не коммитить `.env.local` — убедиться, что он в `.gitignore`.

### 5.2. Скрипт дампа и пуша

Создать `~/concrete-beton-app/scripts/backup-db-to-github.sh`:

```bash
#!/bin/bash
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/concrete-beton-app}"
BACKUP_DIR="$APP_DIR/db-backups"
LOG="$APP_DIR/logs/db-backup-github.log"
# URL локального Supabase Postgres (из supabase status; пароль по умолчанию postgres)
DB_URL="${LOCAL_SUPABASE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
PG_DUMP="${PG_DUMP_BIN:-/opt/homebrew/opt/libpq/bin/pg_dump}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"

mkdir -p "$BACKUP_DIR" "$(dirname "$LOG")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

{
  echo "==== $(date '+%F %T') start ===="

  # Docker/БД должны быть живы
  if ! docker info >/dev/null 2>&1; then
    echo "ERROR: docker not ready"; exit 1
  fi

  TIMESTAMP=$(date +'%Y-%m-%d')
  FILE="$BACKUP_DIR/backup-${TIMESTAMP}.sql.gz"
  TMP="${FILE}.partial"

  # Тот же формат, что облачный Action: plain SQL, --no-owner, ACL сохраняем
  set -o pipefail
  "$PG_DUMP" "$DB_URL" --no-owner --format=plain | gzip > "$TMP"
  SIZE=$(stat -f%z "$TMP" 2>/dev/null || stat -c%s "$TMP")
  if [ "$SIZE" -lt 1024 ]; then
    echo "ERROR: dump too small ($SIZE bytes)"; rm -f "$TMP"; exit 1
  fi
  mv "$TMP" "$FILE"
  echo "created $FILE ($SIZE bytes)"

  # Ротация локальных файлов
  find "$BACKUP_DIR" -name 'backup-*.sql.gz' -mtime +"$KEEP_DAYS" -delete

  cd "$APP_DIR"
  git pull --ff-only || true

  git add db-backups/backup-*.sql.gz
  # убрать из индекса удалённые старые дампы
  git add -u db-backups/

  if git diff --cached --quiet; then
    echo "no changes to commit"
  else
    git -c user.name="db-backup-bot" -c user.email="db-backup-bot@local" \
      commit -m "Бэкап локальной БД ${TIMESTAMP} — $(date '+%d.%m.%Y %H:%M')"
    git push origin HEAD
    echo "pushed to GitHub"
  fi

  echo "==== $(date '+%F %T') done ===="
} >> "$LOG" 2>&1
```

Сделать исполняемым:

```bash
chmod +x ~/concrete-beton-app/scripts/backup-db-to-github.sh
```

Ручной прогон (не ждать ночи):

```bash
~/concrete-beton-app/scripts/backup-db-to-github.sh
tail -n 40 ~/concrete-beton-app/logs/db-backup-github.log
# на GitHub в db-backups/ должен появиться свежий backup-YYYY-MM-DD.sql.gz
```

### 5.3. Crontab на Mac mini

```bash
crontab -e
```

Добавить (05:00 МСК — как сейчас облачный бэкап по смыслу):

```cron
0 5 * * * /Users/ИМЯ/concrete-beton-app/scripts/backup-db-to-github.sh
```

Подставить реальное имя пользователя. Лог: `~/concrete-beton-app/logs/db-backup-github.log`.

### 5.4. Отключить облачный GitHub Action после cutover

Когда прод окончательно на mini:

1. В `[.github/workflows/db-backup.yml](.github/workflows/db-backup.yml)` — либо удалить workflow, либо отключить schedule (оставить только `workflow_dispatch` на время перехода), либо добавить в начало `if: false`.
2. Секрет `SUPABASE_DB_URL` в GitHub можно удалить / не обновлять — он указывает на старое облако.
3. Обновить `[db-backups/README.md](db-backups/README.md)`: источник бэкапов = скрипт на Mac mini, не Actions.

Иначе Action продолжит класть в репо **устаревшие облачные** дампы и путать с локальными.

### 5.5. Конфликты git и дисциплина

- На mini перед пушем скрипт делает `git pull --ff-only`. Если на `main` пушили код с ноутбука — обычно ок; если конфликт в `db-backups/` — редко (разные даты файлов).
- **Не коммитить код «с сервера»** этим ботом — только `db-backups/`. Разработку вести на ноутбуке, на mini только `git pull` при обновлении приложения.
- Если ночной push упал (нет сети) — дамп всё равно лежит локально в `db-backups/`; на следующий день скрипт закоммитит накопившееся (или поправить сеть и запустить скрипт вручную).
- Диск: при `KEEP_DAYS=30` и дампах ~1–2 МБ места почти не ест; на 256 ГБ всё равно не раздувать Docker.

### 5.6. Восстановление из GitHub-дампа

```bash
cd ~/concrete-beton-app
git pull
gunzip -c db-backups/backup-YYYY-MM-DD.sql.gz | psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
```

Тот же нюанс, что в Фазе 1: накатывать на локальный Supabase; при ошибках системных схем — приоритет данным `public`.

### 5.7. Чеклист бэкапа в GitHub

- [ ] `pg_dump` (libpq) установлен, `LOCAL_SUPABASE_DB_URL` верный
- [ ] `scripts/backup-db-to-github.sh` исполняемый, ручной прогон OK, файл > 1 КБ
- [ ] `git push` с mini в `origin` работает (deploy key / PAT)
- [ ] crontab `0 5 * * *` добавлен
- [ ] лог пишется в `logs/db-backup-github.log`
- [ ] на GitHub виден свежий `db-backups/backup-*.sql.gz`
- [ ] облачный `db-backup.yml` отключён после cutover
- [ ] README в `db-backups/` обновлён

---

## Шаг 9. Доступ из интернета (Keenetic + tradecom.keenetic.link)

Цель: staff и водители открывают приложение с телефона/дома по красивому имени, **бесплатно**, сервис **не зарубежный** (Keenetic / KeenDNS стабильно работает в РФ).  
У тебя на роутере уже есть **статический (белый) IP** — это как раз нужный режим.

```mermaid
flowchart LR
  Phone[Телефон водителя] --> DNS[tradecom.keenetic.link]
  DNS --> WAN[Белый IP Keenetic Ultra]
  WAN --> NAT["Проброс 80/443"]
  NAT --> Caddy[Caddy на Mac mini]
  Caddy --> Next["npm run start :3000"]
```

Разделение ролей:

- **Интернет → сайт** — KeenDNS + проброс портов (этот раздел).
- **Админ → SSH/экран** — только Tailscale (порты 22/5900 **не** пробрасывать).

### Почему KeenDNS, а не «зарубежный» DNS

- Домены Keenetic: `*.keenetic.link`, `*.keenetic.name`, `*.keenetic.pro` — бесплатно.
- Сервис заточен под Keenetic, в РФ обычно работает предсказуемо.
- При **белом статическом IP** включаем режим **Прямой доступ (Direct access)**: KeenDNS = просто красивое DNS-имя на твой IP; трафик идёт **напрямую** на роутер завода, не через «облачный прокси» Keenetic.
- Режим **Облачный доступ (Cloud access)** нужен только если IP серый/CGNAT — у тебя при заявленном статике он **не основной**.

### 0. Проверить, что IP действительно белый

На компьютере в LAN завода:

1. Зайти в веб-морду Keenetic (обычно `http://192.168.1.1` или my.keenetic.net).
2. Смотреть **Интернет** / статус WAN — внешний IP.
3. С телефона на LTE открыть https://ifconfig.me — IP должен **совпадать** с WAN роутера.

Если не совпадает — у провайдера серый IP/CGNAT: тогда либо просить белый IP, либо Cloud access KeenDNS (ограниченные порты). Дальше инструкция — для **белого статика**.

### 1. Зафиксировать Mac mini в LAN (обязательно)

Чтобы проброс не «поплыл» после ребута:

1. Keenetic → **Список устройств** → найти Mac mini (по имени / MAC).
2. Задать **постоянный IP** (регистрация DHCP / «Постоянный IP-адрес»), например `192.168.1.50`.
3. Записать этот IP — он будет в правиле проброса.

На самом mini можно дополнительно поставить ручной IP, но резервации в Keenetic обычно достаточно.

### 2. Доменное имя KeenDNS (уже есть)

**Зафиксировано:** `tradecom.keenetic.link` — имя уже зарегистрировано в Keenetic.

Проверить / не сбить настройки:

1. Keenetic → **Сетевые правила** → **KeenDNS** (или **Доменное имя**).
2. Убедиться, что имя именно **`tradecom.keenetic.link`**, сервис включён.
3. Режим: **Прямой доступ** (Direct) — при белом статическом IP.
4. Не переименовывать без нужды — на это имя повесим Caddy, `NEXT_PUBLIC_APP_URL` и закладки staff/водителей.
5. Проверка:
   ```bash
   ping tradecom.keenetic.link
   ```
   Должен резолвиться в **твой белый IP** завода.

Официальная справка Keenetic: разделы «Служба KeenDNS» и «Удалённый доступ к домашним ресурсам».

### 3. Проброс портов (NAT) на Mac mini

Нужны только веб-порты. Next слушает `:3000`, снаружи отдаём **80/443** через прокси на mini (см. п.4).

Keenetic → **Сетевые правила** → **Переадресация** (Проброс портов / Port Forwarding) → добавить правила:

1. **HTTP**
   - Вход (WAN): TCP **80**
   - Назначение: IP Mac mini `192.168.1.50`, порт **80** (Caddy)
2. **HTTPS**
   - Вход (WAN): TCP **443**
   - Назначение: IP Mac mini `192.168.1.50`, порт **443** (Caddy)

**Не пробрасывать:**

- `22` (SSH), `5900` (Screen Sharing), `54321`/`54322` (Supabase) — только LAN/Tailscale.
- Наружу напрямую **только** `3000` без HTTPS — см. ниже «почему не 3000».

#### Почему не пробросить сразу просто порт 3000?

Технически при белом IP можно: WAN TCP `3000` → mini `3000`, заходить на `http://tradecom.keenetic.link:3000`. Для **теста на час** — ок. Для staff/водителей из интернета — нет.

1. **Нет шифрования.** `npm run start` на `:3000` отдаёт обычный **HTTP**. Логины, сессии, токены едут открытым текстом (Wi‑Fi кафе, мобильный оператор, любой в пути). Для завода с реальными учётками это неприемлемо.
2. **Уродливый и ломкий URL.** Нужно писать `:3000` в конце. Часть сетей/операторов режет нестандартные порты → «у меня не открывается», а у другого открывается.
3. **Браузер орёт Not Secure**, на iOS/Android хуже сохраняются пароли/закладки; часть API и cookie с флагом Secure на HTTP не взлетит.
4. **Avito webhook** и нормальный прод ждут **HTTPS**, не `http://…:3000`.
5. **KeenDNS Cloud** (если вдруг IP окажется серым) порт `3000` **не из списка** разрешённых; 80/443 — да. При Direct/белом IP 3000 пробросится, но пункт 1–4 остаются.

Итого: снаружи слушаем **80/443** (Caddy + Let's Encrypt) → внутри прокси на `127.0.0.1:3000`. Порт 3000 наружу не торчит.  
Временный тест: можно один раз пробросить 3000, проверить что NAT доходит до Next, потом правило убрать и оставить 80/443.

Если на 80/443 с интернета уже висит веб-морда самого Keenetic — в настройках доступа к роутеру отключить «доступ к веб-интерфейсу из интернета» по 80/443 или перенести админку роутера на другой порт, чтобы не конфликтовать с сайтом. Админку Keenetic из интернета лучше **не** открывать; настройки роутера — из LAN или через отдельный VPN.

### 4. HTTPS на Mac mini: Caddy → Next.js :3000

С голым `http://имя:3000` водители будут логиниться по открытому каналу — плохо. Ставим лёгкий reverse-proxy **Caddy** (сам берёт Let's Encrypt).

На Mac mini:

```bash
brew install caddy
```

Файл `/usr/local/etc/Caddyfile` или `~/concrete-beton-app/Caddyfile`:

```caddyfile
tradecom.keenetic.link {
	encode gzip

	# Важно: /supabase* (не /supabase/*) — иначе /supabase/rest/v1/... не матчится
	# Фикс broadcast / «Нет связи»: браузер ходит в /supabase, не в 127.0.0.1 клиента
	handle /supabase* {
		uri strip_prefix /supabase
		reverse_proxy 127.0.0.1:54321
	}
	handle {
		reverse_proxy 127.0.0.1:3000
	}
}
```

На mini в `.env.local`: `NEXT_PUBLIC_SUPABASE_URL=https://tradecom.keenetic.link/supabase`,
`SUPABASE_URL=http://127.0.0.1:54321`. На ноуте оба URL — `http://127.0.0.1:54321` (не копировать tradecom).

Проверка и запуск:

```bash
cd ~/concrete-beton-app
caddy validate --config Caddyfile
caddy run --config Caddyfile
```

Порты 80/443 на macOS требуют прав — удобнее поставить Caddy как службу:

```bash
# пример; путь к Caddyfile поправить
sudo caddy start --config /Users/ИМЯ/concrete-beton-app/Caddyfile
```

Или launchd-агент/daemon по аналогии с Next (автозапуск после ребута). Порядок: Docker → Supabase → `npm run start` → **Caddy**.

Let's Encrypt должен успешно выпустить сертификат на `tradecom.keenetic.link`, если:

- имя резолвится в белый IP;
- с интернета на 80/443 достучаться до Caddy (проброс ок);
- firewall macOS пропускает 80/443 (Системные настройки → Сеть → Firewall → разрешить Caddy).

### 5. Прописать URL в приложении

В `.env.local` на Mac mini:

```env
NEXT_PUBLIC_APP_URL=https://tradecom.keenetic.link
```

Пересобрать и перезапустить:

```bash
npm run build
launchctl kickstart -k gui/$(id -u)/com.concrete.local-server
# перезапустить Caddy при необходимости
```

Выдать staff/водителям ссылки:

- корень: `https://tradecom.keenetic.link`
- мобилка / их разделы — `https://tradecom.keenetic.link/mobile/...` (реальные пути как сейчас в проде);
- админку операторов тоже можно по этому же домену из интернета — имей в виду, что URL станет известен; пароли сильные, лишние учётки закрыть.

На заводе в LAN можно по-прежнему `http://192.168.1.50:3000` или тот же `https://tradecom.keenetic.link`.

### 6. Проверки

С телефона на **LTE** (не Wi‑Fi завода):

1. Открывается `https://tradecom.keenetic.link` без ошибки сертификата.
2. Логин staff / водителя работает.
3. Realtime/обновления страниц — ок (WebSocket через тот же HTTPS обычно проходит).

С домашнего Wi‑Fi / другого провайдера — то же самое.

С завода по LAN: сайт жив; Tailscale на работу водителей не влияет.

### 7. Домен 4-го уровня KeenDNS (альтернатива без своего Caddy SSL)

Keenetic умеет «доступ к устройству» через имя 4-го уровня вида `macmini.tradecom.keenetic.link` и прокси на выбранный порт (часто 80 → 3000).  
При **белом IP + Direct** предпочтительнее схема с **Caddy на mini** на основном имени **`tradecom.keenetic.link`** (Let's Encrypt, URL без `:порт`).  
4-й уровень — запасной вариант без Caddy; тщательно проверить HTTPS.

### 8. Avito webhook после появления HTTPS

Когда HTTPS на домене жив:

```text
https://tradecom.keenetic.link/api/webhooks/avito?secret=...
```

Подписать в кабинете Avito. До этого — cron `avito-sync`.

### 9. Безопасность (обязательно)

- Проброс **только** 80 и 443 на Mac mini.
- SSH / Screen Sharing / Docker / Postgres — **не** в WAN.
- Веб-морду Keenetic из интернета закрыть.
- Сильные пароли staff/водителей; после утечки URL — смена паролей.
- Следить за обновлениями macOS / Docker; логи Caddy при странном трафике.
- Статический IP у провайдера: если сменят — обновить/проверить KeenDNS (при статике обычно не плывёт).

### 10. Чеклист Keenetic / интернет

- [ ] WAN IP = белый, совпадает с ifconfig.me с LTE
- [ ] Mac mini — постоянный LAN IP
- [ ] `tradecom.keenetic.link` активен, Direct access, `ping` → белый IP
- [ ] Проброс TCP 80 и 443 → mini:80/443
- [ ] Веб-морда роутера с WAN закрыта
- [ ] Caddy + Let's Encrypt на `tradecom.keenetic.link`
- [ ] `NEXT_PUBLIC_APP_URL=https://tradecom.keenetic.link`
- [ ] С LTE: логин staff и водителя на `https://tradecom.keenetic.link` OK
- [ ] 22/5900/54322 не проброшены
- [ ] Avito webhook (когда готов) на `https://tradecom.keenetic.link/api/webhooks/avito`

---

## Шаг 10. Cutover (день переключения)

1. Заморозить запись в облако / договориться о «тихом часе» (или принять небольшой рассинхрон).
2. Финальный manual backup из облака → скачать/забрать `backup-*.sql.gz`.
3. Restore на локальный Supabase (**Шаг 2**).
4. Обновить `.env.local`, `npm run build` + автозапуск (**Шаги 3–5**).
5. Проверить кроны вручную (**Шаг 6**).
6. Проброс + Caddy на **`https://tradecom.keenetic.link`** (**Шаг 9**) → выдать staff/водителям эту ссылку.
7. На Vercel: поставить на паузу / отключить production (чтобы не писали в старую облачную БД параллельно).
8. Avito: webhook на `https://tradecom.keenetic.link/api/webhooks/avito?secret=...`; до этого — `avito-sync` по cron.
9. Со следующего дня работать по **Шагу 11** (деплой с ноутбука + синхронизация БД).
10. **После стабилизации cutover** (сайт/кроны/бэкапы с mini ок, Vercel не прод, ноут на своём локальном Supabase): на [supabase.com](https://supabase.com) — **pause или удалить облачный проект / отменить платный план**, чтобы не платить за неиспользуемую облачную БД. Не делать в день cutover «сразу»; сначала 1–2 дня уверенности + свежие дампы уже с mini в GitHub. Облачный `db-backup.yml` к этому моменту уже отключён (**Шаг 8**).

---

## Шаг 11. Деплой с ноутбука на Mac mini и синхронизация БД

> **Это пункт про деплой «как на Vercel.com» после переезда.**  
> Номер в оглавлении: **Шаг 11**. Ежедневная работа после cutover — здесь.

Цель: дорабатывать программу на своём компе «как раньше», а выкатывать на завод **примерно как push в Vercel** — но на Mac mini. База прод — Docker на mini; на ноутбуке — **своя** локальная БД; схема/RLS/настройки ездят через **git + SQL-миграции**, а не через «две базы пишут друг в друга».

```mermaid
flowchart TB
  subgraph laptop [Ноутбук Дмитрия]
    CodeDev[код + SQL миграции]
    SupaDev[локальный Supabase Docker]
    CodeDev --> SupaDev
    CodeDev --> GitHub[GitHub main]
  end
  subgraph mini [Mac mini завод]
    Deploy[deploy.sh pull build restart]
    SupaProd[Supabase Docker ПРОД]
    App[Next npm start]
    Deploy --> App
    Migrate[psql apply migration] --> SupaProd
    App --> SupaProd
  end
  GitHub --> Deploy
  GitHub --> Migrate
  SupaProd -->|ночные дампы db-backups| GitHub
  GitHub -->|редко: restore дампа для теста| SupaDev
```

### Главное правило (не ломать прод)

- **Код Next.js:** ноут → GitHub → Mac mini (`git push` + `deploy-from-git.sh`).
- **Схема БД / RLS / функции / новые таблицы:** ноут → файл в git → `psql -f` на mini.
- **Секреты `.env.local`:** не в git; правятся руками на каждой машине.
- **Боевые данные (заказы, склад, GPS):** mini → дампы в GitHub → иногда restore на ноут для теста; с ноута полным дампом **не** затирать прод.
- **Настройки интеграций в таблице:** SQL/seed в git или правка на mini + тот же SQL в репо (не два «правды» без файла).

**Не делать:** постоянно работать ноутбуком напрямую в прод-БД на mini (через Tailscale). Для срочного хотфикса — можно один раз, для фич — нет.

---

### A. База на ноутбуке после отказа от облака

1. На ноутбуке тоже Docker Desktop + `npx supabase start` (отдельный стек, не путать с mini).
2. `.env.local` на ноуте указывает на **локальные** URL/ключи ноутбука (`127.0.0.1:54321` и т.д.).
3. Один раз наполнить dev-данные: свежий `db-backups/backup-*.sql.gz` с GitHub (это снимок **прода с mini**) → restore в локальный Supabase ноута.
4. Дальше крутишь `npm run dev` против своей БД: можно ломать, откатывать, накатывать скрипты без страха за завод.

Периодически (раз в неделю / перед крупной фичей) обновлять копию:

```bash
git pull
gunzip -c db-backups/backup-YYYY-MM-DD.sql.gz | psql "$NOTEBOOK_LOCAL_DB_URL"
```

(или пересоздать volume и restore заново, если схема сильно разъехалась).

---

### B. Деплой кода: аналог «задеплоил на Vercel»

Как сейчас: правка → коммит → push в `main` → Vercel сам собирает.  
Как будет: правка → коммит → push в `main` → **на Mac mini** pull + build + рестарт.

#### B1. Скрипт на Mac mini `scripts/deploy-from-git.sh`

Создать на сервере (агент может положить в репо):

```bash
#!/bin/bash
set -euo pipefail
APP_DIR="${APP_DIR:-$HOME/concrete-beton-app}"
cd "$APP_DIR"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

echo "$(date '+%F %T') deploy start" | tee -a logs/deploy.log
git fetch origin
git checkout main
git pull --ff-only origin main

npm install
npm run build

# перезапуск Next (launchd)
launchctl kickstart -k "gui/$(id -u)/com.concrete.local-server"

echo "$(date '+%F %T') deploy done" | tee -a logs/deploy.log
```

`chmod +x scripts/deploy-from-git.sh`

#### B2. Одна команда с ноутбука (как «задеплой»)

Через Tailscale / LAN SSH:

```bash
ssh ИМЯ@100.x.x.x '~/concrete-beton-app/scripts/deploy-from-git.sh'
# или
ssh ИМЯ@192.168.x.x '~/concrete-beton-app/scripts/deploy-from-git.sh'
```

Можно алиас на ноуте в `~/.zshrc`:

```bash
alias deploy-zavod='ssh ИМЯ@100.x.x.x ~/concrete-beton-app/scripts/deploy-from-git.sh'
```

Дальше привычный цикл:

```bash
# на ноутбуке
git add -A && git commit -m "…" && git push origin main
deploy-zavod
```

#### B3. Порядок как у Vercel (дисциплина)

1. Проверить локально: `npm run build`, смоук на своём Supabase.
2. Закоммитить и запушить в `main` (или PR → merge — как решите; для завода достаточно `main`).
3. `deploy-zavod` — дождаться build на mini.
4. Проверить `https://tradecom.keenetic.link` и критичный сценарий.
5. Если менялась БД — **сначала** миграция на mini (п. C), потом или вместе с деплоем кода (часто: миграция → deploy кода, если код ждёт новые колонки).

**Не коммитить с Mac mini обычный код** — mini только `git pull` (+ бот бэкапов в `db-backups/`). Иначе будут конфликты с ноутбуком.

---

### C. Синхронизация схемы и настроек БД (полная «логическая» синхронизация)

Сейчас DDL часто лежит в `scripts/*-schema.sql` и накатывается вручную. После cutover закрепляем процесс:

#### C1. Любое изменение БД = файл в git

Примеры:

- новая таблица / колонка / индекс;
- RLS / `CREATE POLICY`;
- функция склада / триггер;
- строка-настройка в `system_settings` / шаблон, которую должны видеть обе среды.

Кладём в репо, например:

- `scripts/migrations/2026-08-06-add-foo.sql`  
  или продолжаем `scripts/foo-schema.sql`, но **всегда коммитим до деплоя кода**, который это использует.

В начале файла — комментарий: зачем, идемпотентность (`IF NOT EXISTS` где возможно).

#### C2. Накатить у себя (ноут)

```bash
psql "$NOTEBOOK_LOCAL_DB_URL" -f scripts/migrations/2026-08-06-add-foo.sql
# проверить в приложении на localhost
```

#### C3. Накатить на прод (Mac mini)

После `git pull` (или внутри `deploy-from-git.sh` отдельным шагом / вручную по SSH):

```bash
ssh ИМЯ@100.x.x.x
cd ~/concrete-beton-app
git pull --ff-only
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f scripts/migrations/2026-08-06-add-foo.sql
# затем deploy / kickstart если ещё не делали
```

Опционально позже: `npm run db:migrate` который гоняет все ещё не применённые файлы из папки (таблица `schema_migrations`) — можно добавить, когда надоест руками.

#### C4. Настройки интеграций и «как в облаке правили SQL Editor»

- Секреты Avito/СКАУТ и т.п. — в `.env.local` на mini (и при необходимости на ноуте для теста).
- Значения в `integration_settings` / справочники: либо SQL upsert в миграции, либо один раз правишь на mini после проверки на ноуте и **дублируешь SQL в git**, чтобы не потерять.
- Не считать «я поправил только в Studio на mini» достаточным — через месяц на ноуте схемы не будет.

#### C5. Чего не делать с данными

- **Не** делать `pg_dump` с ноута и restore поверх прод-БД mini «чтобы синхронизировать» — сотрёшь заказы завода.
- **Не** поднимать два приложения (ноут + mini), пишущих в одну БД.
- Дампы mini → GitHub — это бэкап и источник для **обновления dev-копии**, не канал деплоя схемы.

---

### D. Ежедневный рабочий цикл (шпаргалка)

**Фича только в коде**

1. Ноут: код против локального Supabase → ок.
2. `git push origin main`
3. `deploy-zavod`
4. Смоук на `tradecom.keenetic.link`

**Фича с БД**

1. Ноут: написать `scripts/migrations/….sql` → `psql` на локальную БД → код → ок.
2. Коммит: SQL + код вместе (или SQL чуть раньше).
3. На mini: `git pull` → `psql -f …` → `deploy-from-git.sh` (или сначала миграция, потом deploy).
4. Смоук на проде.

**Нужны свежие боевые данные на ноуте**

1. Дождаться ночного бэкапа с mini в GitHub (или ручной `backup-db-to-github.sh`).
2. `git pull` на ноуте → restore дампа в **свой** локальный Supabase (не в прод).

---

### E. Чеклист «как Vercel + синхрон БД»

- [ ] На ноуте свой `supabase start` + `.env.local` на локаль
- [ ] Прод-БД только на Mac mini; ноут в неё не пишет при обычной работе
- [ ] `scripts/deploy-from-git.sh` на mini; с ноута `ssh … deploy-from-git.sh`
- [ ] Алиас `deploy-zavod` (по желанию)
- [ ] Любой DDL/RLS/настройка → файл в git → apply на ноуте → apply на mini
- [ ] Секреты только в `.env.local` каждой машины
- [ ] Дампы: mini → GitHub → иногда restore на ноут; никогда ноут-дамп → прод
- [ ] Код с mini не пушить (кроме бота `db-backups/`)
- [ ] После стабилизации: supabase.com — pause/удалить проект / отменить оплату (не в день cutover)

### F. Инструкция агенту на Mac mini / ноуте после cutover

Если Дмитрий говорит «задеплой на завод» / «как на Vercel»:

1. Убедиться, что изменения закоммичены и в `origin/main`.
2. По SSH на mini запустить `deploy-from-git.sh` (или создать скрипт, если ещё нет).
3. Если в коммите есть SQL — напомнить/выполнить `psql -f` на mini **до или сразу после** деплоя кода (порядок: сначала миграция, если код ломается без колонок).
4. Не предлагать «просто восстановить дамп с ноута на mini».
5. Для проверки фичи на ноуте — локальный Supabase; для проверки «как у завода» — после деплоя смоук на `tradecom.keenetic.link`.

---

## Шаг 12. Бэкап кода на GitHub (как раньше)

> Отдельно от **Шага 8** (там бэкап **базы** `db-backups/*.sql.gz`).  
> Здесь — бэкап **исходного кода** приложения в том же GitHub-репозитории.

### Зачем

После ухода с Vercel код всё равно должен жить на GitHub: история коммитов = бэкап, откат, копия не только на диске Mac mini / ноутбука.  
Схема **та же, что была**: поработал → закоммитил → `git push origin main`. Раньше push ещё и деплоил на Vercel; теперь push = сохранить код (+ потом **Шаг 11** выкатывает на mini).

### Что хранится на GitHub

- Весь код Next.js, `scripts/`, планы в `.cursor/plans/` (если закоммичены), конфиги без секретов.
- История веток/коммитов — можно откатиться на любой день.
- Вместе с **Шагом 8**: в репо же лежат дампы БД в `db-backups/` (их пушит mini по ночам).

### Что НЕ класть в git

- `.env.local`, пароли, ключи Avito/СКАУТ/CRON (только на машинах).
- `node_modules/`, `.next/` — ставятся заново (`npm install` / `build`).

### Как делать каждый день (с ноутбука)

После осмысленной порции работы (или перед деплоем на завод):

```bash
cd ~/concrete-beton-app   # путь на ноуте
git status
git add -A
# не добавлять .env.local — проверить git status
git commit -m "$(cat <<'EOF'
Кратко что сделали — ДД.ММ.ГГГГ ЧЧ:ММ

EOF
)"
git push origin main
```

Сообщения коммитов — **на русском**, с датой/временем (как в правилах репо).

Потом при необходимости деплой на mini (**Шаг 11**):

```bash
deploy-zavod
# или: ssh … ~/concrete-beton-app/scripts/deploy-from-git.sh
```

### Дисциплина

- Не оставлять готовый код только на ноуте или только на mini без push.
- С Mac mini **не** пушить обычный код (только бот бэкапов БД из Шага 8). Разработка и push кода — с ноутбука.
- Репозиторий на GitHub должен быть **private** (как сейчас), раз в коде/дампах могут быть чувствительные данные завода.
- По желанию: теги релизов `git tag -a v2026-08-06 -m "…" && git push --tags` перед крупным cutover.

### Чеклист Шага 12

- [ ] Репо на GitHub private, доступ с ноута на `git push` есть
- [ ] После правок стабильно: commit + `git push origin main`
- [ ] `.env.local` в `.gitignore`, в remote не уезжает
- [ ] Понятно: Шаг 8 = БД, Шаг 12 = код, Шаг 11 = выкатка на mini

---

## Чеклист приёмки

- [ ] Docker Desktop + `supabase status` OK
- [ ] Restore свежего дампа, таблицы склада/заказов/MEKA на месте
- [ ] `.env.local` с локальными Supabase-ключами
- [ ] `npm run build` + `npm run start` без ошибок
- [ ] Логин, склад, отгрузки, мобилка в LAN
- [ ] Cron-эндпоинты (dismiss / avito / demand / **scout-sync**) отвечают 200 с `CRON_SECRET`
- [ ] crontab записан (МСК-времена), включая **`*/2` scout-sync**; на mini `ENABLE_LOCAL_CRONS=0`
- [ ] Карта парка: после 2–4 мин без ручной кнопки бейдж «Обновлено» свежий; broadcast двигает маркеры
- [ ] Nightly `backup-db-to-github.sh`: дамп + push в `db-backups/` на GitHub (**Шаг 8**)
- [ ] Код регулярно в GitHub: commit + push с ноута (**Шаг 12**)
- [ ] Облачный `db-backup.yml` отключён после cutover
- [ ] Mac mini не уходит в sleep; `autorestart 1`; автологин
- [ ] Docker Start at login + launchd агент; после ребута сайт поднимается сам
- [ ] SSH + Screen Sharing; Tailscale **Connected** на mini/ноутбуке, Start at login, `ssh`/`vnc` по `100.x.x.x`; удалённый `kickstart` работает
- [ ] `https://tradecom.keenetic.link` (проброс 80/443 + Caddy); с LTE staff/водители логинятся
- [ ] Vercel больше не является продом (после стабилизации)
- [ ] После cutover: ноут со своим Supabase; `deploy-from-git.sh` + цикл push→deploy; миграции БД только через SQL в git
- [ ] Облачный проект на supabase.com: pause/удалён / платный план отменён (после 1–2 дней стабильной работы на mini; чтобы не платить за облако)

## Оценка времени

- Подготовка Mac mini + Docker/Supabase: ~1 ч
- Restore + env + build/start: ~1–2 ч
- Кроны + смоук + cutover: ~1–2 ч
- Удалёнка (SSH + Screen Sharing + Tailscale): ~30–60 мин
- Локальный бэкап БД → GitHub (скрипт + crontab): ~30–45 мин
- Бэкап кода → GitHub: тот же привычный commit/push (без отдельного времени)
- Keenetic KeenDNS + проброс + Caddy HTTPS: ~1–2 ч
- Avito webhook на новый домен — после стабильного HTTPS

