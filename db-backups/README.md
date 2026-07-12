# Автоматические бэкапы базы данных

Эта папка хранит ежедневные сжатые дампы Supabase-базы (`backup-YYYY-MM-DD.sql.gz`).
Создаются автоматически GitHub Action'ом `.github/workflows/db-backup.yml`
каждый день в 05:00 по Москве. Хранятся последние 30 дней, старые удаляются
автоматически.

## Настройка (сделать один раз)

1. Откройте Supabase Dashboard → ваш проект → **Project Settings → Database**.
2. Скопируйте **Connection string** в режиме **URI** (не Pooler — нужна прямая
   строка подключения, там будет виден плейсхолдер `[YOUR-PASSWORD]`).
   Вставьте вместо плейсхолдера настоящий пароль базы.

   Формат:
   `postgresql://postgres:ВАШ_ПАРОЛЬ@db.xxxxxxxxxxxx.supabase.co:5432/postgres`

3. В репозитории на GitHub: **Settings → Secrets and variables → Actions →
   New repository secret**.
   - Имя секрета: `SUPABASE_DB_URL`
   - Значение: строка подключения из шага 2.
4. Сохранить. Готово — с этого момента бэкапы будут создаваться сами по расписанию.

Проверить сразу, не дожидаясь ночи: вкладка **Actions** → workflow
**Database Backup** → кнопка **Run workflow**.

## Если backup не создаётся / файл пустой (~20 байт)

Самая частая причина — прямое подключение вида
`db.xxxxx.supabase.co:5432` у Supabase иногда работает только по IPv6, а
раннеры GitHub Actions — IPv4-only, из-за чего `pg_dump` не может
подключиться. Решение: в Supabase Dashboard → **Project Settings →
Database** переключите вид строки подключения на **Session pooler**
(порт `6543` или `5432`, имя пользователя вида `postgres.xxxxxxxx`) — она
работает по IPv4, и подставьте её в секрет `SUPABASE_DB_URL` вместо прямой.

## Восстановление из бэкапа

```bash
gunzip backup-2026-07-12.sql.gz
psql "postgresql://postgres:ВАШ_ПАРОЛЬ@db.xxxxxxxxxxxx.supabase.co:5432/postgres" -f backup-2026-07-12.sql
```

⚠️ Восстановление накатывает дамп поверх текущей базы — используйте с
осторожностью, лучше на тестовом проекте, а не на продакшене напрямую.
