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