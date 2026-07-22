-- Auth-backed waitlist setup for founding-member reservations.
-- Re-run safely after creating public.waitlist.

revoke insert on table public.waitlist from anon;
revoke usage, select on sequence public.waitlist_id_seq from anon;

grant insert on table public.waitlist to authenticated;
grant usage, select on sequence public.waitlist_id_seq to authenticated;

drop policy if exists "Anyone can join waitlist" on public.waitlist;
drop policy if exists "Authenticated verified email can join waitlist" on public.waitlist;

create policy "Authenticated verified email can join waitlist"
on public.waitlist
for insert
to authenticated
with check (
  email = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
  and length(email) between 3 and 320
  and position('@' in email) > 1
  and status = 'pending'
  and consent_to_updates = true
);
