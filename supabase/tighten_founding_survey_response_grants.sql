-- Follow-up hardening for founding survey responses.
-- Keeps public browser roles from retaining inherited table or sequence privileges.
revoke all privileges on table public.founding_survey_responses from anon, authenticated;
revoke all privileges on sequence public.founding_survey_responses_id_seq from anon, authenticated;
