-- Syntrae billing model (additive)
-- Safe to run after persona_tables.sql. This does not delete persona data.

create table if not exists public.billing_customers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id text not null unique,
  trial_consumed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.persona_subscriptions (
  persona_id uuid primary key references public.personas (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  stripe_subscription_id text not null unique,
  stripe_customer_id text not null,
  stripe_price_id text not null,
  status text not null check (
    status in ('trialing', 'active', 'past_due', 'unpaid', 'canceled', 'incomplete', 'incomplete_expired')
  ),
  cancel_at_period_end boolean not null default false,
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_start timestamptz,
  trial_end timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.billing_webhook_events (
  stripe_event_id text primary key,
  event_type text not null,
  received_at timestamptz not null default timezone('utc', now())
);

create index if not exists persona_subscriptions_user_idx on public.persona_subscriptions (user_id);
create index if not exists persona_subscriptions_status_idx on public.persona_subscriptions (status);
create index if not exists persona_subscriptions_period_end_idx on public.persona_subscriptions (current_period_end desc);

alter table public.billing_customers enable row level security;
alter table public.persona_subscriptions enable row level security;
alter table public.billing_webhook_events enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'persona_subscriptions'
      and policyname = 'persona_subscriptions_select_own'
  ) then
    create policy persona_subscriptions_select_own
    on public.persona_subscriptions
    for select
    using (auth.uid() = user_id);
  else
    alter policy persona_subscriptions_select_own
    on public.persona_subscriptions
    using (auth.uid() = user_id);
  end if;
end $$;

grant select on public.persona_subscriptions to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'billing_customers_set_updated_at'
      and tgrelid = 'public.billing_customers'::regclass
      and not tgisinternal
  ) then
    create trigger billing_customers_set_updated_at
    before update on public.billing_customers
    for each row
    execute function public.set_updated_at();
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'persona_subscriptions_set_updated_at'
      and tgrelid = 'public.persona_subscriptions'::regclass
      and not tgisinternal
  ) then
    create trigger persona_subscriptions_set_updated_at
    before update on public.persona_subscriptions
    for each row
    execute function public.set_updated_at();
  end if;
end $$;
