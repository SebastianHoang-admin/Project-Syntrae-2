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
  profile jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint personas_user_key_unique unique (user_id, persona_key)
);

alter table public.personas
  add column if not exists portrait_storage_path text;

alter table public.personas
  add column if not exists profile jsonb not null default '{}'::jsonb;

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

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  first_name text,
  last_name text,
  occupation text,
  organization text,
  location text,
  profile jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists user_profiles_updated_at_idx on public.user_profiles (updated_at desc);

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

drop trigger if exists user_profiles_set_updated_at on public.user_profiles;
create trigger user_profiles_set_updated_at
before update on public.user_profiles
for each row
execute function public.set_updated_at();

drop trigger if exists persona_chat_sessions_set_updated_at on public.persona_chat_sessions;
create trigger persona_chat_sessions_set_updated_at
before update on public.persona_chat_sessions
for each row
execute function public.set_updated_at();

alter table public.personas enable row level security;
alter table public.user_profiles enable row level security;
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

drop policy if exists user_profiles_select_own on public.user_profiles;
create policy user_profiles_select_own
on public.user_profiles
for select
using (auth.uid() = user_id);

drop policy if exists user_profiles_insert_own on public.user_profiles;
create policy user_profiles_insert_own
on public.user_profiles
for insert
with check (auth.uid() = user_id);

drop policy if exists user_profiles_update_own on public.user_profiles;
create policy user_profiles_update_own
on public.user_profiles
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists user_profiles_delete_own on public.user_profiles;
create policy user_profiles_delete_own
on public.user_profiles
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
grant select, insert, update, delete on public.user_profiles to authenticated;
grant select, insert, update, delete on public.persona_chat_sessions to authenticated;
grant select, insert, update, delete on public.persona_chat_messages to authenticated;

-- Global token budget state for Outcome Test (cross-user TPM coordination).
create table if not exists public.outcome_token_budget_state (
  id boolean primary key default true check (id),
  window_started_at timestamptz not null default timezone('utc', now()),
  window_seconds integer not null default 60,
  max_tpm bigint not null default 30000,
  reserved_tokens bigint not null default 0,
  consumed_tokens bigint not null default 0,
  updated_at timestamptz not null default timezone('utc', now())
);

insert into public.outcome_token_budget_state (id)
values (true)
on conflict (id) do nothing;

create table if not exists public.outcome_token_budget_reservations (
  reservation_id uuid primary key default gen_random_uuid(),
  request_id text,
  user_id uuid references auth.users (id) on delete set null,
  reserved_tokens bigint not null check (reserved_tokens >= 0),
  consumed_tokens bigint not null default 0 check (consumed_tokens >= 0),
  status text not null default 'reserved' check (status in ('reserved', 'released', 'consumed')),
  model text,
  prompt_id text,
  prompt_version text,
  error_stage text,
  created_at timestamptz not null default timezone('utc', now()),
  released_at timestamptz
);

create index if not exists outcome_token_budget_reservations_status_idx
  on public.outcome_token_budget_reservations (status, created_at desc);

create or replace function public.outcome_token_budget_acquire(
  p_tokens bigint,
  p_tpm_limit bigint default null,
  p_window_seconds integer default 60,
  p_request_id text default null,
  p_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_window_started_at timestamptz;
  v_window_seconds integer;
  v_max_tpm bigint;
  v_reserved_tokens bigint;
  v_consumed_tokens bigint;
  v_stale_cutoff timestamptz;
  v_stale_tokens bigint := 0;
  v_requested_tokens bigint := greatest(1, coalesce(p_tokens, 0));
  v_retry_after_seconds integer;
  v_reservation_id uuid;
  v_elapsed_seconds double precision;
begin
  insert into public.outcome_token_budget_state (id)
  values (true)
  on conflict (id) do nothing;

  select
    window_started_at,
    greatest(20, coalesce(p_window_seconds, window_seconds, 60)) as window_seconds,
    greatest(1000, coalesce(p_tpm_limit, max_tpm, 30000)) as max_tpm,
    greatest(0, reserved_tokens) as reserved_tokens,
    greatest(0, consumed_tokens) as consumed_tokens
  into
    v_window_started_at,
    v_window_seconds,
    v_max_tpm,
    v_reserved_tokens,
    v_consumed_tokens
  from public.outcome_token_budget_state
  where id = true
  for update;

  if v_window_started_at is null then
    v_window_started_at := v_now;
    v_reserved_tokens := 0;
    v_consumed_tokens := 0;
  end if;

  v_elapsed_seconds := extract(epoch from (v_now - v_window_started_at));
  if coalesce(v_elapsed_seconds, 0) >= v_window_seconds then
    v_window_started_at := v_now;
    v_reserved_tokens := 0;
    v_consumed_tokens := 0;
    v_elapsed_seconds := 0;
  end if;

  -- Reap stale reservations so old crashes do not block the window forever.
  v_stale_cutoff := v_now - make_interval(secs => greatest(v_window_seconds * 4, 240));
  select coalesce(sum(reserved_tokens), 0)
  into v_stale_tokens
  from public.outcome_token_budget_reservations
  where status = 'reserved'
    and created_at < v_stale_cutoff;

  if v_stale_tokens > 0 then
    update public.outcome_token_budget_reservations
    set
      status = 'released',
      released_at = v_now,
      error_stage = coalesce(error_stage, 'stale_reap')
    where status = 'reserved'
      and created_at < v_stale_cutoff;

    v_reserved_tokens := greatest(0, v_reserved_tokens - v_stale_tokens);
  end if;

  if v_requested_tokens > v_max_tpm then
    return jsonb_build_object(
      'granted', false,
      'reason', 'request_exceeds_limit',
      'limit_tokens', v_max_tpm,
      'remaining_tokens', greatest(0, v_max_tpm - (v_reserved_tokens + v_consumed_tokens)),
      'retry_after_seconds', greatest(1, v_window_seconds)
    );
  end if;

  if (v_reserved_tokens + v_consumed_tokens + v_requested_tokens) <= v_max_tpm then
    insert into public.outcome_token_budget_reservations (
      request_id,
      user_id,
      reserved_tokens,
      status
    )
    values (
      nullif(trim(coalesce(p_request_id, '')), ''),
      p_user_id,
      v_requested_tokens,
      'reserved'
    )
    returning reservation_id into v_reservation_id;

    v_reserved_tokens := v_reserved_tokens + v_requested_tokens;

    update public.outcome_token_budget_state
    set
      window_started_at = v_window_started_at,
      window_seconds = v_window_seconds,
      max_tpm = v_max_tpm,
      reserved_tokens = v_reserved_tokens,
      consumed_tokens = v_consumed_tokens,
      updated_at = v_now
    where id = true;

    return jsonb_build_object(
      'granted', true,
      'reason', 'ok',
      'reservation_id', v_reservation_id,
      'limit_tokens', v_max_tpm,
      'remaining_tokens', greatest(0, v_max_tpm - (v_reserved_tokens + v_consumed_tokens)),
      'retry_after_seconds', 0
    );
  end if;

  v_retry_after_seconds := greatest(
    1,
    ceil(v_window_seconds - coalesce(v_elapsed_seconds, 0))
  )::integer;

  update public.outcome_token_budget_state
  set
    window_started_at = v_window_started_at,
    window_seconds = v_window_seconds,
    max_tpm = v_max_tpm,
    reserved_tokens = v_reserved_tokens,
    consumed_tokens = v_consumed_tokens,
    updated_at = v_now
  where id = true;

  return jsonb_build_object(
    'granted', false,
    'reason', 'window_exhausted',
    'limit_tokens', v_max_tpm,
    'remaining_tokens', greatest(0, v_max_tpm - (v_reserved_tokens + v_consumed_tokens)),
    'retry_after_seconds', v_retry_after_seconds
  );
end;
$$;

create or replace function public.outcome_token_budget_release(
  p_reservation_id uuid,
  p_actual_tokens bigint default 0,
  p_success boolean default false,
  p_request_id text default null,
  p_user_id uuid default null,
  p_model text default null,
  p_prompt_id text default null,
  p_prompt_version text default null,
  p_error_stage text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_window_started_at timestamptz;
  v_window_seconds integer;
  v_max_tpm bigint;
  v_reserved_tokens bigint;
  v_consumed_tokens bigint;
  v_elapsed_seconds double precision;
  v_reserved bigint;
  v_actual bigint := greatest(0, coalesce(p_actual_tokens, 0));
  v_to_consume bigint;
  v_status text;
begin
  if p_reservation_id is null then
    return jsonb_build_object('released', false, 'reason', 'missing_reservation_id');
  end if;

  insert into public.outcome_token_budget_state (id)
  values (true)
  on conflict (id) do nothing;

  select
    window_started_at,
    greatest(20, coalesce(window_seconds, 60)) as window_seconds,
    greatest(1000, coalesce(max_tpm, 30000)) as max_tpm,
    greatest(0, reserved_tokens) as reserved_tokens,
    greatest(0, consumed_tokens) as consumed_tokens
  into
    v_window_started_at,
    v_window_seconds,
    v_max_tpm,
    v_reserved_tokens,
    v_consumed_tokens
  from public.outcome_token_budget_state
  where id = true
  for update;

  select status, reserved_tokens
  into v_status, v_reserved
  from public.outcome_token_budget_reservations
  where reservation_id = p_reservation_id
  for update;

  if v_status is null then
    return jsonb_build_object('released', false, 'reason', 'reservation_not_found');
  end if;

  if v_status <> 'reserved' then
    return jsonb_build_object('released', false, 'reason', 'reservation_already_released');
  end if;

  v_elapsed_seconds := extract(epoch from (v_now - coalesce(v_window_started_at, v_now)));
  if coalesce(v_elapsed_seconds, 0) >= v_window_seconds then
    v_window_started_at := v_now;
    v_reserved_tokens := 0;
    v_consumed_tokens := 0;
  end if;

  if coalesce(p_success, false) then
    v_to_consume := greatest(1, coalesce(nullif(v_actual, 0), v_reserved, 0));
  else
    v_to_consume := 0;
  end if;

  v_reserved_tokens := greatest(0, v_reserved_tokens - greatest(0, coalesce(v_reserved, 0)));
  v_consumed_tokens := greatest(0, v_consumed_tokens + v_to_consume);

  update public.outcome_token_budget_state
  set
    window_started_at = coalesce(v_window_started_at, v_now),
    reserved_tokens = v_reserved_tokens,
    consumed_tokens = v_consumed_tokens,
    updated_at = v_now
  where id = true;

  update public.outcome_token_budget_reservations
  set
    status = case when coalesce(p_success, false) then 'consumed' else 'released' end,
    consumed_tokens = v_to_consume,
    released_at = v_now,
    request_id = coalesce(nullif(trim(coalesce(p_request_id, '')), ''), request_id),
    user_id = coalesce(p_user_id, user_id),
    model = coalesce(nullif(trim(coalesce(p_model, '')), ''), model),
    prompt_id = coalesce(nullif(trim(coalesce(p_prompt_id, '')), ''), prompt_id),
    prompt_version = coalesce(nullif(trim(coalesce(p_prompt_version, '')), ''), prompt_version),
    error_stage = coalesce(nullif(trim(coalesce(p_error_stage, '')), ''), error_stage)
  where reservation_id = p_reservation_id;

  return jsonb_build_object(
    'released', true,
    'reason', case when coalesce(p_success, false) then 'consumed' else 'released' end,
    'limit_tokens', v_max_tpm,
    'remaining_tokens', greatest(0, v_max_tpm - (v_reserved_tokens + v_consumed_tokens))
  );
end;
$$;

-- Service-role-only primitive: no client grants here.
revoke all on public.outcome_token_budget_state from anon, authenticated;
revoke all on public.outcome_token_budget_reservations from anon, authenticated;
revoke all on function public.outcome_token_budget_acquire(bigint, bigint, integer, text, uuid) from public, anon, authenticated;
revoke all on function public.outcome_token_budget_release(uuid, bigint, boolean, text, uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.outcome_token_budget_acquire(bigint, bigint, integer, text, uuid) to service_role;
grant execute on function public.outcome_token_budget_release(uuid, bigint, boolean, text, uuid, text, text, text, text) to service_role;

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
