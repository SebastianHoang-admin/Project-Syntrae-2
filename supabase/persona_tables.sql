-- Syntrae persona data model
-- Run this in Supabase SQL Editor (once per project).
-- This creates account-scoped persona rows plus a chat-history table scaffold.

create extension if not exists pgcrypto;

create table if not exists public.personas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  persona_key text not null default 'default',
  name text not null default 'Persona 1',
  portrait_data_url text,
  state jsonb not null default '{}'::jsonb,
  traits jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint personas_user_key_unique unique (user_id, persona_key)
);

create index if not exists personas_user_id_idx on public.personas (user_id);
create index if not exists personas_updated_at_idx on public.personas (updated_at desc);

create table if not exists public.persona_chat_messages (
  id bigint generated always as identity primary key,
  persona_id uuid not null references public.personas (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('system', 'user', 'assistant')),
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists persona_chat_messages_persona_idx
  on public.persona_chat_messages (persona_id, created_at asc);
create index if not exists persona_chat_messages_user_idx
  on public.persona_chat_messages (user_id, created_at desc);

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

alter table public.personas enable row level security;
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
grant select, insert, update, delete on public.persona_chat_messages to authenticated;

