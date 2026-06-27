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