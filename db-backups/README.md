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

## Восстановление из бэкапа

```bash
gunzip backup-2026-07-12.sql.gz
psql "postgresql://postgres:ВАШ_ПАРОЛЬ@db.xxxxxxxxxxxx.supabase.co:5432/postgres" -f backup-2026-07-12.sql
```

⚠️ Восстановление накатывает дамп поверх текущей базы — используйте с
осторожностью, лучше на тестовом проекте, а не на продакшене напрямую.
