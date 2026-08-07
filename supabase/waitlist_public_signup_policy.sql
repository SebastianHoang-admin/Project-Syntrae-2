-- Legacy public insert policy replaced by the email-verification flow.
-- Public landing-page visitors should submit through /api/waitlist so the
-- backend can validate suspicious addresses and create expiring tokens.
alter table public.waitlist enable row level security;

revoke select, insert, update, delete on public.waitlist from anon, authenticated;
grant select, insert, update, delete on public.waitlist to service_role;

drop policy if exists "Anyone can join waitlist" on public.waitlist;
drop policy if exists "Authenticated verified email can join waitlist" on public.waitlist;
