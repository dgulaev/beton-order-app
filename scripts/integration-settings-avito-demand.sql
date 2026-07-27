-- Тумблер: легальный спрос из Messenger Авито (входящие в ваши объявления).
-- Не поиск чужих объявлений. Применить в Supabase SQL Editor.

alter table public.integration_settings
  add column if not exists avito_demand_messenger boolean not null default false;

comment on column public.integration_settings.avito_demand_messenger is
  'Если true — Demand Radar подтягивает непрочитанные чаты Авито (официальный Messenger API) как карточки спроса. Поиск чужих объявлений не используется.';

select id, avito_enabled, avito_demand_messenger, updated_at
from public.integration_settings
where id = 1;
