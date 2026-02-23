# Persona Tables Setup (Syntrae)

This project now writes persona data to `public.personas` (instead of only Auth metadata), keyed by account (`user_id`).

## 1) Create tables + RLS

Run `supabase/persona_tables.sql` in **Supabase Dashboard -> SQL Editor**.

## 2) Optional backfill from old metadata storage

If you already have personas stored in `auth.users.raw_user_meta_data.persona_state_v1`, run:

```sql
insert into public.personas (user_id, persona_key, name, portrait_data_url, state, traits)
select
  u.id as user_id,
  'default' as persona_key,
  coalesce(
    nullif(trim(u.raw_user_meta_data->'persona_state_v1'->>'personaName'), ''),
    'Persona 1'
  ) as name,
  nullif(u.raw_user_meta_data->'persona_state_v1'->>'personaPortrait', '') as portrait_data_url,
  coalesce(u.raw_user_meta_data->'persona_state_v1', '{}'::jsonb) as state,
  coalesce(
    jsonb_build_object(
      'L1', coalesce((u.raw_user_meta_data->'persona_state_v1'->'identityLayers'->>'L1')::jsonb, '{}'::jsonb),
      'L2', coalesce((u.raw_user_meta_data->'persona_state_v1'->'identityLayers'->>'L2')::jsonb, '{}'::jsonb),
      'L3', coalesce((u.raw_user_meta_data->'persona_state_v1'->'identityLayers'->>'L3')::jsonb, '{}'::jsonb)
    ),
    '{}'::jsonb
  ) as traits
from auth.users u
where u.raw_user_meta_data ? 'persona_state_v1'
on conflict (user_id, persona_key)
do update
set
  name = excluded.name,
  portrait_data_url = excluded.portrait_data_url,
  state = excluded.state,
  traits = excluded.traits,
  updated_at = timezone('utc', now());
```

## 3) Verify

Use this query to confirm each persona is linked to an account:

```sql
select
  p.user_id,
  p.id as persona_id,
  p.persona_key,
  p.name,
  p.updated_at
from public.personas p
order by p.updated_at desc
limit 100;
```

## 4) Current structure

- `auth.users` -> account identities
- `public.personas` -> per-account persona records (`user_id` foreign key)
- `public.persona_chat_messages` -> per-persona chat logs (ready for future use)

