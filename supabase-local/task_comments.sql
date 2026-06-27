create table public.task_comments (
  id bigserial not null,
  task_id bigint null,
  user_id bigint not null,
  comment text not null,
  created_at timestamp with time zone null default now(),
  constraint task_comments_pkey primary key (id),
  constraint task_comments_task_id_fkey foreign KEY (task_id) references tasks (id)
) TABLESPACE pg_default;