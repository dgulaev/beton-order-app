create table public.active_sessions (
  id bigserial not null,
  user_id bigint not null,
  ip text null,
  user_agent text null,
  last_active timestamp with time zone null default now(),
  created_at timestamp with time zone null default now(),
  constraint active_sessions_pkey primary key (id),
  constraint unique_user_active unique (user_id),
  constraint active_sessions_user_id_fkey foreign KEY (user_id) references users (user_id)
) TABLESPACE pg_default;

create index IF not exists idx_active_sessions_user on public.active_sessions using btree (user_id) TABLESPACE pg_default;

create index IF not exists idx_active_sessions_last_active on public.active_sessions using btree (last_active) TABLESPACE pg_default;

create table public.admin_notifications (
  id bigserial not null,
  type text not null,
  title text not null,
  message text not null,
  user_id bigint null,
  redemption_id text null,
  priority text null default 'medium'::text,
  is_read boolean null default false,
  created_at timestamp with time zone null default now(),
  order_id bigint null,
  constraint admin_notifications_pkey primary key (id)
) TABLESPACE pg_default;

create index IF not exists idx_admin_notifications_order_id on public.admin_notifications using btree (order_id) TABLESPACE pg_default;

create index IF not exists idx_admin_notifications_user_read on public.admin_notifications using btree (user_id, is_read) TABLESPACE pg_default;

create table public.balance_redemptions (
  id uuid not null default extensions.uuid_generate_v4 (),
  user_id bigint not null,
  order_id bigint null,
  amount integer not null,
  type text not null,
  status text null default 'pending'::text,
  payout_details jsonb null,
  created_at timestamp with time zone null default now(),
  processed_at timestamp with time zone null,
  constraint balance_redemptions_pkey primary key (id),
  constraint balance_redemptions_order_id_fkey foreign KEY (order_id) references orders (id) on delete set null,
  constraint balance_redemptions_user_id_fkey foreign KEY (user_id) references users (user_id) on delete CASCADE,
  constraint balance_redemptions_amount_check check ((amount > 0)),
  constraint balance_redemptions_status_check check (
    (
      status = any (
        array[
          'pending'::text,
          'completed'::text,
          'rejected'::text
        ]
      )
    )
  ),
  constraint balance_redemptions_type_check check (
    (
      type = any (array['discount'::text, 'cash'::text])
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_redemptions_user on public.balance_redemptions using btree (user_id) TABLESPACE pg_default;

create index IF not exists idx_redemptions_order on public.balance_redemptions using btree (order_id) TABLESPACE pg_default;

create index IF not exists idx_redemptions_status on public.balance_redemptions using btree (status) TABLESPACE pg_default;

create table public.client_calls (
  id bigserial not null,
  client_id bigint null,
  manager_id bigint null,
  call_date timestamp with time zone null default now(),
  result text not null,
  comment text null,
  created_at timestamp with time zone null default now(),
  staff_id bigint null,
  constraint client_calls_pkey primary key (id),
  constraint client_calls_client_id_fkey foreign KEY (client_id) references users (user_id),
  constraint client_calls_manager_id_fkey foreign KEY (manager_id) references users (user_id),
  constraint client_calls_staff_id_fkey foreign KEY (staff_id) references users (user_id) on delete set null
) TABLESPACE pg_default;

create index IF not exists idx_client_calls_client on public.client_calls using btree (client_id) TABLESPACE pg_default;

create index IF not exists idx_client_calls_manager on public.client_calls using btree (manager_id) TABLESPACE pg_default;

create index IF not exists idx_client_calls_created on public.client_calls using btree (created_at) TABLESPACE pg_default;

create table public.client_interactions (
  id bigserial not null,
  client_id bigint null,
  staff_id bigint null,
  type text null,
  comment text null,
  created_at timestamp with time zone null default now(),
  constraint client_interactions_pkey primary key (id),
  constraint client_interactions_client_id_fkey foreign KEY (client_id) references users (user_id),
  constraint client_interactions_staff_id_fkey foreign KEY (staff_id) references users (user_id)
) TABLESPACE pg_default;

create table public.fbs_blocks (
  id serial not null,
  code text not null,
  name text not null,
  unit text null default 'шт'::text,
  price numeric(12, 2) not null,
  length_cm numeric(6, 2) null,
  width_cm numeric(6, 2) null,
  height_cm numeric(6, 2) null,
  weight_kg numeric(8, 2) null,
  is_active boolean null default true,
  created_at timestamp without time zone null default now(),
  updated_at timestamp without time zone null default now(),
  current numeric null default 0,
  recipe_id integer null,
  constraint fbs_blocks_pkey primary key (id),
  constraint fbs_blocks_code_key unique (code)
) TABLESPACE pg_default;

create table public.meka_reports (
  id bigserial not null,
  report_date date not null,
  file_name text null,
  total_volume numeric null default 0,
  total_cement numeric null default 0,
  total_sand numeric null default 0,
  total_gravel numeric null default 0,
  total_water numeric null default 0,
  total_additive numeric null default 0,
  raw_data jsonb null,
  created_at timestamp without time zone null default now(),
  constraint meka_reports_pkey primary key (id)
) TABLESPACE pg_default;

create index IF not exists idx_meka_reports_date on public.meka_reports using btree (report_date) TABLESPACE pg_default;

create table public.mixers (
  id bigserial not null,
  number text not null,
  model text null,
  driver text null,
  phone text null,
  volume integer null default 10,
  type text null,
  status text null default 'Доступен'::text,
  location text null,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  current_status text null default 'Доступен'::text,
  last_status_update timestamp with time zone null,
  current_order_id bigint null,
  driver_telegram_id bigint null,
  constraint mixers_pkey primary key (id),
  constraint mixers_number_key unique (number),
  constraint mixers_current_order_id_fkey foreign KEY (current_order_id) references orders (id),
  constraint mixers_type_check check ((type = any (array['own'::text, 'rented'::text])))
) TABLESPACE pg_default;

create table public.order_history (
  id bigserial not null,
  order_id bigint null,
  action text not null,
  user_name text null default 'Диспетчер'::text,
  created_at timestamp with time zone null default now(),
  user_role text null,
  field_name text null,
  old_value text null,
  new_value text null,
  constraint order_history_pkey primary key (id),
  constraint order_history_order_id_fkey foreign KEY (order_id) references orders (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_order_history_order_id on public.order_history using btree (order_id) TABLESPACE pg_default;

create index IF not exists idx_order_history_order_id_field on public.order_history using btree (order_id, field_name) TABLESPACE pg_default;

create table public.order_mixers (
  id bigserial not null,
  order_id bigint null,
  mixer_name text not null,
  time text not null,
  volume numeric not null,
  created_at timestamp with time zone null default now(),
  status text null default 'В пути'::text,
  updated_at timestamp with time zone null default now(),
  sort_order integer null default 0,
  loading_started_at timestamp with time zone null,
  podvizhnost text null default 'П3'::text,
  constraint order_mixers_pkey primary key (id),
  constraint order_mixers_order_id_fkey foreign KEY (order_id) references orders (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_order_mixers_order_id on public.order_mixers using btree (order_id) TABLESPACE pg_default;

create table public.orders (
  id bigserial not null,
  user_id bigint null,
  grade text not null,
  volume numeric not null,
  delivery_date date not null,
  delivery_time time without time zone not null,
  address text not null,
  customer_type text not null,
  full_name text null,
  organization_name text null,
  phone text not null,
  comment text null,
  concrete_cost numeric null,
  delivery_cost numeric null,
  total_price numeric null,
  created_at timestamp with time zone null default now(),
  referred_by bigint null,
  status text null default 'new'::text,
  client_name text null,
  vehicle text null,
  driver text null,
  plant text null,
  logistics_ready boolean null default false,
  logistics_completed_at timestamp with time zone null,
  updated_at timestamp with time zone null default now(),
  inn text null,
  is_questionable boolean null default false,
  constraint orders_pkey primary key (id),
  constraint orders_status_check check (
    (
      status = any (
        array[
          'new'::text,
          'processing'::text,
          'completed'::text,
          'cancelled'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_orders_user_id on public.orders using btree (user_id) TABLESPACE pg_default;

create index IF not exists idx_orders_referred_by on public.orders using btree (referred_by) TABLESPACE pg_default;

create index IF not exists idx_orders_status on public.orders using btree (status) TABLESPACE pg_default;

create index IF not exists idx_orders_inn on public.orders using btree (inn) TABLESPACE pg_default;

create index IF not exists idx_orders_delivery_date on public.orders using btree (delivery_date) TABLESPACE pg_default;

create table public.production_logs (
  id bigserial not null,
  order_id bigint null,
  order_mixer_id bigint null,
  mixer_name text null,
  concrete_grade text null,
  volume numeric null,
  podvizhnost text null,
  start_time timestamp with time zone null,
  end_time timestamp with time zone null,
  duration_minutes integer null,
  created_at timestamp with time zone null default now(),
  constraint production_logs_pkey primary key (id),
  constraint production_logs_order_id_fkey foreign KEY (order_id) references orders (id),
  constraint production_logs_order_mixer_id_fkey foreign KEY (order_mixer_id) references order_mixers (id)
) TABLESPACE pg_default;

create table public.recipes (
  id bigserial not null,
  code text not null,
  name text not null,
  price numeric(10, 2) not null,
  type text null,
  cement numeric(8, 2) null default 0,
  sand numeric(8, 2) null default 0,
  gravel numeric(8, 2) null default 0,
  water numeric(8, 2) null default 0,
  additive numeric(8, 2) null default 0,
  is_active boolean null default true,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  additive2 numeric null default 0,
  item_type text null default 'concrete'::text,
  length_cm numeric(6, 2) null,
  width_cm numeric(6, 2) null,
  height_cm numeric(6, 2) null,
  unit text null default 'шт'::text,
  constraint recipes_pkey primary key (id),
  constraint recipes_code_key unique (code),
  constraint recipes_type_check check (
    (
      type = any (
        array[
          'granite'::text,
          'dolomite'::text,
          'mortar'::text,
          'cps'::text
        ]
      )
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_recipes_code on public.recipes using btree (code) TABLESPACE pg_default;

create index IF not exists idx_recipes_type on public.recipes using btree (type) TABLESPACE pg_default;

create index IF not exists idx_recipes_is_active on public.recipes using btree (is_active) TABLESPACE pg_default;

create table public.referral_transactions (
  id bigserial not null,
  referrer_id bigint not null,
  referred_user_id bigint not null,
  order_id bigint not null,
  volume numeric not null,
  potential_bonus integer not null,
  status text null default 'pending'::text,
  created_at timestamp with time zone null default now(),
  activated_at timestamp with time zone null,
  cancelled_at timestamp with time zone null,
  processed_at timestamp with time zone null,
  comment text null,
  constraint referral_transactions_pkey primary key (id),
  constraint fk_order foreign KEY (order_id) references orders (id),
  constraint fk_referred_user foreign KEY (referred_user_id) references users (user_id),
  constraint fk_referrer foreign KEY (referrer_id) references users (user_id)
) TABLESPACE pg_default;

create index IF not exists idx_referral_referrer on public.referral_transactions using btree (referrer_id) TABLESPACE pg_default;

create index IF not exists idx_referral_order on public.referral_transactions using btree (order_id) TABLESPACE pg_default;

create index IF not exists idx_referral_status on public.referral_transactions using btree (status) TABLESPACE pg_default;

create table public.task_comments (
  id bigserial not null,
  task_id bigint null,
  user_id bigint not null,
  comment text not null,
  created_at timestamp with time zone null default now(),
  constraint task_comments_pkey primary key (id),
  constraint task_comments_task_id_fkey foreign KEY (task_id) references tasks (id)
) TABLESPACE pg_default;

create table public.tasks (
  id bigserial not null,
  title text not null,
  description text null,
  created_by bigint not null,
  assigned_to bigint null,
  status text null default 'new'::text,
  due_date timestamp with time zone null,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  completed_at timestamp with time zone null,
  completion_note text null,
  constraint tasks_pkey primary key (id)
) TABLESPACE pg_default;

create index IF not exists idx_tasks_created_by on public.tasks using btree (created_by) TABLESPACE pg_default;

create index IF not exists idx_tasks_assigned on public.tasks using btree (assigned_to) TABLESPACE pg_default;

create index IF not exists idx_tasks_status on public.tasks using btree (status) TABLESPACE pg_default;

create table public.users (
  user_id bigint not null,
  referral_code text not null,
  balance integer null default 0,
  created_at timestamp with time zone null default now(),
  referred_by bigint null,
  role text null default 'client'::text,
  phone text null,
  username text null,
  password_hash text null,
  full_name text null,
  organization_name text null,
  inn text null,
  created_by bigint null,
  address text null,
  assigned_to bigint null,
  client_status text null default 'cold'::text,
  last_contact timestamp with time zone null,
  next_contact timestamp with time zone null,
  contact_count integer null default 0,
  loyalty_score integer null default 50,
  predicted_next_order date null,
  force_logout_version integer null default 0,
  constraint users_pkey primary key (user_id),
  constraint users_phone_key unique (phone),
  constraint users_referral_code_key unique (referral_code),
  constraint users_username_key unique (username),
  constraint users_assigned_to_fkey foreign KEY (assigned_to) references users (user_id) on delete set null
) TABLESPACE pg_default;

create index IF not exists idx_users_referral_code on public.users using btree (referral_code) TABLESPACE pg_default;

create index IF not exists idx_users_referred_by on public.users using btree (referred_by) TABLESPACE pg_default;

create index IF not exists idx_users_phone on public.users using btree (phone) TABLESPACE pg_default;

create index IF not exists idx_users_username on public.users using btree (username) TABLESPACE pg_default;

create index IF not exists idx_users_role on public.users using btree (role) TABLESPACE pg_default;

create table public.users_backup (
  user_id bigint null,
  referral_code text null,
  balance integer null,
  created_at timestamp with time zone null,
  referred_by bigint null,
  role text null,
  phone text null
) TABLESPACE pg_default;

create table public.warehouse_additives (
  id serial not null,
  additive_id integer not null,
  name text not null,
  current numeric not null default 0,
  max numeric not null,
  updated_at timestamp with time zone null default now(),
  constraint warehouse_additives_pkey primary key (id),
  constraint warehouse_additives_additive_id_key unique (additive_id)
) TABLESPACE pg_default;

create table public.warehouse_operations (
  id bigserial not null,
  operation_type text not null,
  item_type text not null,
  amount numeric not null,
  old_value numeric null,
  new_value numeric not null,
  created_at timestamp with time zone null default now(),
  unit text null default 'л'::text,
  constraint warehouse_operations_pkey primary key (id)
) TABLESPACE pg_default;

create index IF not exists idx_warehouse_operations_created_at on public.warehouse_operations using btree (created_at desc) TABLESPACE pg_default;

create table public.warehouse_silos (
  id serial not null,
  silo_id integer not null,
  name text not null,
  current numeric not null default 0,
  max numeric not null,
  nominal numeric not null,
  updated_at timestamp with time zone null default now(),
  constraint warehouse_silos_pkey primary key (id),
  constraint warehouse_silos_silo_id_key unique (silo_id)
) TABLESPACE pg_default;

create unique INDEX IF not exists idx_warehouse_silos_silo_id on public.warehouse_silos using btree (silo_id) TABLESPACE pg_default;