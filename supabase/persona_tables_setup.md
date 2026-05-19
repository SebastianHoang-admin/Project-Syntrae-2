# Persona Tables Setup (Syntrae)

This project now writes account data into:
- `public.user_profiles` for the signed-in user profile
- `public.personas` for each persona owned by that user
- `public.persona_chat_sessions` / `public.persona_chat_messages` for chat windows/history
- `public.outcome_token_budget_state` / `public.outcome_token_budget_reservations` for global Outcome TPM scheduling

## 1) Create tables + RLS

Run `supabase/persona_tables.sql` in **Supabase Dashboard -> SQL Editor**.
You can safely re-run it later; it is idempotent and also applies chat-session upgrades, adds `portrait_storage_path` + `profile` on personas, creates `user_profiles`, provisions global Outcome token-budget RPCs, adds storage bucket policies for persona portraits, and migrates any legacy `persona_key = 'default'` rows to generated slug keys.

## 2) Optional backfill from old metadata storage

If you already have personas stored in `auth.users.raw_user_meta_data.persona_state_v1`, run:

```sql
insert into public.personas (user_id, persona_key, name, portrait_data_url, state, traits)
select
  u.id as user_id,
  'persona-' || substr(replace(u.id::text, '-', ''), 1, 6) as persona_key,
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

Use this query to confirm each user profile row is linked to an account:

```sql
select
  up.user_id,
  up.first_name,
  up.last_name,
  up.updated_at
from public.user_profiles up
order by up.updated_at desc
limit 100;
```

Use this query to confirm chat windows are linked to persona + account:

```sql
select
  s.user_id,
  s.persona_id,
  s.id as session_id,
  s.title,
  s.updated_at
from public.persona_chat_sessions s
order by s.updated_at desc
limit 100;
```

Use this query to confirm portrait storage keys are persisted per persona:

```sql
select
  p.user_id,
  p.persona_key,
  p.name,
  p.portrait_storage_path,
  p.updated_at
from public.personas p
order by p.updated_at desc
limit 100;
```

## 4) Current structure

- `auth.users` -> account identities
- `public.user_profiles` -> per-account user profile (`user_id` primary key)
- `public.personas` -> per-account persona records (`user_id` foreign key, `profile` JSON for LLM context)
- `storage.objects` in bucket `persona-portraits` -> portrait files at path `user_id/persona_key/...`
- `public.persona_chat_sessions` -> chat windows per persona
- `public.persona_chat_messages` -> messages in each chat window (`session_id`)
