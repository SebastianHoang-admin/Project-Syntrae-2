-- Moves waitlist collection from browser inserts to backend email verification.
-- Public clients may submit only through /api/waitlist, which validates email
-- quality, stores pending rows, and sends the confirmation link.
create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

alter table public.waitlist enable row level security;

alter table public.waitlist
  add column if not exists verification_token_hash text,
  add column if not exists verification_sent_at timestamptz,
  add column if not exists verification_expires_at timestamptz,
  add column if not exists verified_at timestamptz;

update public.waitlist
set status = 'verified',
    verified_at = coalesce(verified_at, updated_at, created_at, now()),
    updated_at = now()
where status = 'joined';

alter table public.waitlist
  alter column status set default 'pending';

alter table public.waitlist
  drop constraint if exists waitlist_status_check;

alter table public.waitlist
  add constraint waitlist_status_check
  check (status in ('pending', 'verified'));

create unique index if not exists waitlist_verification_token_hash_idx
on public.waitlist (verification_token_hash)
where verification_token_hash is not null;

create index if not exists waitlist_pending_cleanup_idx
on public.waitlist (created_at)
where status = 'pending';

create index if not exists waitlist_verified_announcements_idx
on public.waitlist (email)
where status = 'verified' and consent_to_updates is true;

drop policy if exists "Anyone can join waitlist" on public.waitlist;
drop policy if exists "Authenticated verified email can join waitlist" on public.waitlist;

revoke select, insert, update, delete on public.waitlist from anon, authenticated;
grant select, insert, update, delete on public.waitlist to service_role;

create or replace function private.sync_waitlist_from_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_email text;
  normalized_name text;
  normalized_referral_source text;
  should_join_waitlist boolean;
  next_status text;
begin
  normalized_email := lower(trim(coalesce(new.email, '')));
  if normalized_email = '' then
    return new;
  end if;

  normalized_name := nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')), '');
  normalized_referral_source := nullif(trim(coalesce(new.raw_user_meta_data ->> 'referral_source', '')), '');
  should_join_waitlist := lower(coalesce(new.raw_user_meta_data ->> 'waitlist', 'false')) in ('true', '1', 'yes', 'on')
    or normalized_referral_source in ('landing_hero', 'founding_form', 'founding_waitlist');

  if not should_join_waitlist then
    return new;
  end if;

  next_status := case when new.email_confirmed_at is not null then 'verified' else 'pending' end;

  insert into public.waitlist (email, full_name, referral_source, status, consent_to_updates, created_at, updated_at)
  values (
    normalized_email,
    normalized_name,
    coalesce(normalized_referral_source, 'founding_waitlist'),
    next_status,
    true,
    now(),
    now()
  )
  on conflict (email) do update
  set full_name = coalesce(excluded.full_name, public.waitlist.full_name),
      referral_source = coalesce(public.waitlist.referral_source, excluded.referral_source),
      status = case
        when excluded.status = 'verified' then 'verified'
        else public.waitlist.status
      end,
      consent_to_updates = true,
      updated_at = now();

  return new;
end;
$$;

revoke all on function private.sync_waitlist_from_auth_user() from public, anon, authenticated;

create or replace function private.delete_expired_waitlist_pending()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  deleted_count integer;
begin
  delete from public.waitlist
  where status = 'pending'
    and created_at < now() - interval '30 days';

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function private.delete_expired_waitlist_pending() from public, anon, authenticated;

create extension if not exists pg_cron with schema extensions;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'delete_expired_waitlist_pending') then
    perform cron.unschedule('delete_expired_waitlist_pending');
  end if;

  perform cron.schedule(
    'delete_expired_waitlist_pending',
    '0 7 * * *',
    'select private.delete_expired_waitlist_pending();'
  );
end;
$$;

comment on column public.waitlist.status is 'pending until the confirmation link is clicked, verified after email ownership is confirmed.';
comment on column public.waitlist.verification_token_hash is 'SHA-256 hash of the latest expiring waitlist confirmation token.';
comment on column public.waitlist.verification_expires_at is 'Expiration timestamp for the latest waitlist confirmation token.';
comment on function private.delete_expired_waitlist_pending() is 'Deletes pending waitlist records older than 30 days.';

-- Moves waitlist collection from browser inserts to backend email verification.
-- Public clients may submit only through /api/waitlist, which validates email
-- quality, stores pending rows, and sends the confirmation link.
create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

alter table public.waitlist enable row level security;

alter table public.waitlist
  add column if not exists verification_token_hash text,
  add column if not exists verification_sent_at timestamptz,
  add column if not exists verification_expires_at timestamptz,
  add column if not exists verified_at timestamptz;

update public.waitlist
set status = 'verified',
    verified_at = coalesce(verified_at, updated_at, created_at, now()),
    updated_at = now()
where status = 'joined';

alter table public.waitlist
  alter column status set default 'pending';

alter table public.waitlist
  drop constraint if exists waitlist_status_check;

alter table public.waitlist
  add constraint waitlist_status_check
  check (status in ('pending', 'verified'));

create unique index if not exists waitlist_verification_token_hash_idx
on public.waitlist (verification_token_hash)
where verification_token_hash is not null;

create index if not exists waitlist_pending_cleanup_idx
on public.waitlist (created_at)
where status = 'pending';

create index if not exists waitlist_verified_announcements_idx
on public.waitlist (email)
where status = 'verified' and consent_to_updates is true;

drop policy if exists "Anyone can join waitlist" on public.waitlist;
drop policy if exists "Authenticated verified email can join waitlist" on public.waitlist;

revoke select, insert, update, delete on public.waitlist from anon, authenticated;
grant select, insert, update, delete on public.waitlist to service_role;

create or replace function private.delete_expired_waitlist_pending()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  deleted_count integer;
begin
  delete from public.waitlist
  where status = 'pending'
    and created_at < now() - interval '30 days';

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function private.delete_expired_waitlist_pending() from public, anon, authenticated;

create extension if not exists pg_cron with schema extensions;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'delete_expired_waitlist_pending') then
    perform cron.unschedule('delete_expired_waitlist_pending');
  end if;

  perform cron.schedule(
    'delete_expired_waitlist_pending',
    '0 7 * * *',
    'select private.delete_expired_waitlist_pending();'
  );
end;
$$;
