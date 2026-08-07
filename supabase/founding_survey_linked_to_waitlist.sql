-- Links founding survey responses to the verified waitlist email used to sign up.
-- Public clients submit through /api/founding-survey; no browser role can read or
-- write survey answers directly.
alter table public.waitlist
  add column if not exists survey_token_hash text,
  add column if not exists survey_token_created_at timestamptz;

create unique index if not exists waitlist_survey_token_hash_idx
on public.waitlist (survey_token_hash)
where survey_token_hash is not null;

create table if not exists public.founding_survey_responses (
  id bigserial primary key,
  waitlist_id bigint not null references public.waitlist(id) on delete cascade,
  waitlist_email text not null,
  uncertain_moment text,
  relationship_to_person text,
  situation_details text,
  possible_actions text,
  feared_consequences text,
  hoped_outcome text,
  uncertainty_response text,
  supports_used text,
  syntrae_usefulness text,
  shared_syntrae text,
  user_agent text,
  page_referrer text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint founding_survey_waitlist_unique unique (waitlist_id),
  constraint founding_survey_email_normalized check (
    waitlist_email = lower(trim(waitlist_email))
    and length(waitlist_email) between 3 and 320
    and position('@' in waitlist_email) > 1
  )
);

alter table public.founding_survey_responses enable row level security;

revoke all privileges on table public.founding_survey_responses from anon, authenticated;
revoke all privileges on sequence public.founding_survey_responses_id_seq from anon, authenticated;

grant select, insert, update, delete on public.founding_survey_responses to service_role;
grant usage, select on sequence public.founding_survey_responses_id_seq to service_role;

create index if not exists founding_survey_email_idx
on public.founding_survey_responses (waitlist_email);

create index if not exists founding_survey_updated_at_idx
on public.founding_survey_responses (updated_at desc);

comment on table public.founding_survey_responses is 'Founding survey answers linked to the verified waitlist record used to sign up.';
comment on column public.founding_survey_responses.waitlist_id is 'Foreign key to public.waitlist.id for the signup email owner.';
comment on column public.founding_survey_responses.waitlist_email is 'Lowercase email snapshot from the linked waitlist row.';
comment on column public.waitlist.survey_token_hash is 'SHA-256 hash of the private browser token used to link a verified waitlist member to survey answers.';
