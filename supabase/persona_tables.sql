-- Syntrae persona data model
-- Run this in Supabase SQL Editor (once per project).
-- This creates account-scoped persona rows plus a chat-history table scaffold.

create extension if not exists pgcrypto;

create table if not exists public.personas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  persona_key text not null,
  name text not null default 'Persona 1',
  portrait_data_url text,
  portrait_storage_path text,
  state jsonb not null default '{}'::jsonb,
  traits jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint personas_user_key_unique unique (user_id, persona_key)
);

alter table public.personas
  add column if not exists portrait_storage_path text;

alter table public.personas
  alter column persona_key drop default;

with normalized as (
  select
    p.id,
    coalesce(
      nullif(trim(both '-' from regexp_replace(lower(coalesce(nullif(p.name, ''), 'persona')), '[^a-z0-9_-]+', '-', 'g')), ''),
      'persona'
    ) as slug
  from public.personas p
  where p.persona_key is null
     or btrim(p.persona_key) = ''
     or lower(p.persona_key) = 'default'
)
update public.personas p
set persona_key = left(n.slug, 24) || '-' || substr(replace(p.id::text, '-', ''), 1, 6)
from normalized n
where p.id = n.id;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'personas_persona_key_not_default'
  ) then
    alter table public.personas
      add constraint personas_persona_key_not_default
      check (
        length(btrim(persona_key)) > 0
        and lower(persona_key) <> 'default'
      );
  end if;
end $$;

create index if not exists personas_user_id_idx on public.personas (user_id);
create index if not exists personas_updated_at_idx on public.personas (updated_at desc);

create table if not exists public.persona_chat_sessions (
  id uuid primary key default gen_random_uuid(),
  persona_id uuid not null references public.personas (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'New chat',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists persona_chat_sessions_persona_idx
  on public.persona_chat_sessions (persona_id, updated_at desc);
create index if not exists persona_chat_sessions_user_idx
  on public.persona_chat_sessions (user_id, updated_at desc);

create table if not exists public.persona_chat_messages (
  id bigint generated always as identity primary key,
  session_id uuid references public.persona_chat_sessions (id) on delete cascade,
  persona_id uuid not null references public.personas (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('system', 'user', 'assistant')),
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.persona_chat_messages
  add column if not exists session_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'persona_chat_messages_session_id_fkey'
  ) then
    alter table public.persona_chat_messages
      add constraint persona_chat_messages_session_id_fkey
      foreign key (session_id)
      references public.persona_chat_sessions (id)
      on delete cascade;
  end if;
end $$;

create index if not exists persona_chat_messages_persona_idx
  on public.persona_chat_messages (persona_id, created_at asc);
create index if not exists persona_chat_messages_user_idx
  on public.persona_chat_messages (user_id, created_at desc);
create index if not exists persona_chat_messages_session_idx
  on public.persona_chat_messages (session_id, created_at asc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists personas_set_updated_at on public.personas;
create trigger personas_set_updated_at
before update on public.personas
for each row
execute function public.set_updated_at();

drop trigger if exists persona_chat_sessions_set_updated_at on public.persona_chat_sessions;
create trigger persona_chat_sessions_set_updated_at
before update on public.persona_chat_sessions
for each row
execute function public.set_updated_at();

alter table public.personas enable row level security;
alter table public.persona_chat_sessions enable row level security;
alter table public.persona_chat_messages enable row level security;

drop policy if exists personas_select_own on public.personas;
create policy personas_select_own
on public.personas
for select
using (auth.uid() = user_id);

drop policy if exists personas_insert_own on public.personas;
create policy personas_insert_own
on public.personas
for insert
with check (auth.uid() = user_id);

drop policy if exists personas_update_own on public.personas;
create policy personas_update_own
on public.personas
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists personas_delete_own on public.personas;
create policy personas_delete_own
on public.personas
for delete
using (auth.uid() = user_id);

drop policy if exists persona_chat_select_own on public.persona_chat_messages;
create policy persona_chat_select_own
on public.persona_chat_messages
for select
using (auth.uid() = user_id);

drop policy if exists persona_chat_sessions_select_own on public.persona_chat_sessions;
create policy persona_chat_sessions_select_own
on public.persona_chat_sessions
for select
using (auth.uid() = user_id);

drop policy if exists persona_chat_sessions_insert_own on public.persona_chat_sessions;
create policy persona_chat_sessions_insert_own
on public.persona_chat_sessions
for insert
with check (auth.uid() = user_id);

drop policy if exists persona_chat_sessions_update_own on public.persona_chat_sessions;
create policy persona_chat_sessions_update_own
on public.persona_chat_sessions
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists persona_chat_sessions_delete_own on public.persona_chat_sessions;
create policy persona_chat_sessions_delete_own
on public.persona_chat_sessions
for delete
using (auth.uid() = user_id);

drop policy if exists persona_chat_insert_own on public.persona_chat_messages;
create policy persona_chat_insert_own
on public.persona_chat_messages
for insert
with check (auth.uid() = user_id);

drop policy if exists persona_chat_update_own on public.persona_chat_messages;
create policy persona_chat_update_own
on public.persona_chat_messages
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists persona_chat_delete_own on public.persona_chat_messages;
create policy persona_chat_delete_own
on public.persona_chat_messages
for delete
using (auth.uid() = user_id);

grant select, insert, update, delete on public.personas to authenticated;
grant select, insert, update, delete on public.persona_chat_sessions to authenticated;
grant select, insert, update, delete on public.persona_chat_messages to authenticated;

-- Persona portrait storage bucket + owner-scoped policies.
insert into storage.buckets (id, name, public)
values ('persona-portraits', 'persona-portraits', true)
on conflict (id) do nothing;

drop policy if exists persona_portraits_select_own on storage.objects;
create policy persona_portraits_select_own
on storage.objects
for select
to authenticated
using (
  bucket_id = 'persona-portraits'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists persona_portraits_insert_own on storage.objects;
create policy persona_portraits_insert_own
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'persona-portraits'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists persona_portraits_update_own on storage.objects;
create policy persona_portraits_update_own
on storage.objects
for update
to authenticated
using (
  bucket_id = 'persona-portraits'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'persona-portraits'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists persona_portraits_delete_own on storage.objects;
create policy persona_portraits_delete_own
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'persona-portraits'
  and (storage.foldername(name))[1] = auth.uid()::text
);
