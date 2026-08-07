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
