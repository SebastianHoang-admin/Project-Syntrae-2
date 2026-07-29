-- Keeps public.waitlist aligned with verified Supabase Auth users created
-- through the founding waitlist flow.
create schema if not exists private;

revoke all on schema private from public;

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

  next_status := case when new.email_confirmed_at is not null then 'joined' else 'pending' end;

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
        when excluded.status = 'joined' then 'joined'
        else public.waitlist.status
      end,
      consent_to_updates = true,
      updated_at = now();

  return new;
end;
$$;

revoke all on function private.sync_waitlist_from_auth_user() from public, anon, authenticated;

drop trigger if exists sync_waitlist_from_auth_user on auth.users;

create trigger sync_waitlist_from_auth_user
after insert or update of email, email_confirmed_at, raw_user_meta_data
on auth.users
for each row
execute function private.sync_waitlist_from_auth_user();
