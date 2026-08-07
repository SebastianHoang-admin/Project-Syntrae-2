-- Link founding waitlist and survey responses to Supabase Auth accounts.
alter table public.waitlist
  add column if not exists user_id uuid references auth.users(id) on delete set null;

alter table public.founding_survey_responses
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

create unique index if not exists waitlist_user_id_unique
on public.waitlist (user_id)
where user_id is not null;

create unique index if not exists founding_survey_user_id_unique
on public.founding_survey_responses (user_id)
where user_id is not null;

update public.waitlist w
set user_id = u.id,
    updated_at = now()
from auth.users u
where w.user_id is null
  and w.email = lower(trim(u.email))
  and u.email_confirmed_at is not null;

update public.founding_survey_responses s
set user_id = w.user_id,
    updated_at = now()
from public.waitlist w
where s.user_id is null
  and s.waitlist_id = w.id
  and w.user_id is not null;

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

  insert into public.waitlist (email, full_name, referral_source, status, consent_to_updates, user_id, created_at, updated_at)
  values (
    normalized_email,
    normalized_name,
    coalesce(normalized_referral_source, 'founding_waitlist'),
    next_status,
    true,
    new.id,
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
      user_id = coalesce(public.waitlist.user_id, excluded.user_id),
      consent_to_updates = true,
      updated_at = now();

  return new;
end;
$$;

revoke all on function private.sync_waitlist_from_auth_user() from public, anon, authenticated;

comment on column public.waitlist.user_id is 'Supabase Auth user linked to this verified founding waitlist email.';
comment on column public.founding_survey_responses.user_id is 'Supabase Auth user whose account submitted this founding survey response.';
