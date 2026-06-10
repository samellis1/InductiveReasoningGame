-- ============================================================================
-- scores-hardening.sql
-- Hardens the public.scores table against forged client-side inserts.
-- The game posts scores from js/social.js (postScore) using the anon key,
-- so every value is client-supplied. This migration:
--   1. Adds CHECK constraints on plausible value ranges
--   2. Locks inserts to the caller's own auth.uid() via RLS
--   3. Adds a per-user rate limit (max inserts per minute) via trigger
-- Apply in the Supabase SQL editor (project lfbsratbyfgjufjpqfvi).
-- See supabase/README.md for step-by-step instructions.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 0. Prerequisite: created_at, needed by the rate-limit trigger.
--    No-op if the column already exists (Supabase table templates include it).
-- ----------------------------------------------------------------------------
alter table public.scores
  add column if not exists created_at timestamptz not null default now();

-- Speeds up the rate-limit lookup (and any per-user history queries).
create index if not exists scores_user_created_idx
  on public.scores (user_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 1. CHECK constraints on value ranges.
--    Added NOT VALID so the migration succeeds even if forged rows already
--    exist; new/updated rows are checked immediately. After cleaning up old
--    rows (see README), run the commented VALIDATE statements below.
-- ----------------------------------------------------------------------------

-- Fastest believable average solve time is ~0.5s/problem; slowest allowed 10min.
alter table public.scores drop constraint if exists scores_avg_solve_ms_range;
alter table public.scores
  add constraint scores_avg_solve_ms_range
  check (avg_solve_ms between 500 and 600000) not valid;

alter table public.scores drop constraint if exists scores_accuracy_range;
alter table public.scores
  add constraint scores_accuracy_range
  check (accuracy >= 0 and accuracy <= 1) not valid;

alter table public.scores drop constraint if exists scores_difficulty_allowed;
alter table public.scores
  add constraint scores_difficulty_allowed
  check (difficulty in ('easy', 'medium', 'hard', 'expert', 'daily')) not valid;

-- display_name is also client-supplied; cap it so nobody injects a novel.
alter table public.scores drop constraint if exists scores_display_name_length;
alter table public.scores
  add constraint scores_display_name_length
  check (display_name is not null and char_length(display_name) between 1 and 80) not valid;

-- After deleting rows that violate the ranges (README step 3), enforce them
-- on existing data too:
-- alter table public.scores validate constraint scores_avg_solve_ms_range;
-- alter table public.scores validate constraint scores_accuracy_range;
-- alter table public.scores validate constraint scores_difficulty_allowed;
-- alter table public.scores validate constraint scores_display_name_length;

-- ----------------------------------------------------------------------------
-- 2. Row Level Security: users may only insert rows as themselves.
--    All existing policies on scores are dropped and replaced with a known
--    set, so a permissive leftover policy can't undercut the new rules.
--    No UPDATE/DELETE policies are created, so rows are immutable to clients.
-- ----------------------------------------------------------------------------
alter table public.scores enable row level security;

do $$
declare
  p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'scores'
  loop
    execute format('drop policy %I on public.scores', p.policyname);
  end loop;
end $$;

-- Leaderboards are public within the app: any client may read.
create policy scores_select_all
  on public.scores
  for select
  to anon, authenticated
  using (true);

-- Only signed-in users may insert, and only as themselves.
create policy scores_insert_own
  on public.scores
  for insert
  to authenticated
  with check (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 3. Rate limit: reject more than 5 score inserts per user per minute.
--    A legitimate round takes at minimum ~10s (5+ problems at 1.5s+ each plus
--    reading time), so 5/minute is generous for real play and cheap to spam-
--    proof. SECURITY DEFINER so the count isn't subject to the caller's RLS;
--    search_path is pinned to prevent function hijacking.
-- ----------------------------------------------------------------------------
create or replace function public.scores_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  recent_count integer;
begin
  select count(*) into recent_count
  from public.scores
  where user_id = new.user_id
    and created_at > now() - interval '1 minute';

  if recent_count >= 5 then
    raise exception 'Too many score submissions; please wait a minute before posting again.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

-- Function should not be callable directly by clients, only via the trigger.
revoke all on function public.scores_rate_limit() from public, anon, authenticated;

drop trigger if exists scores_rate_limit_trigger on public.scores;
create trigger scores_rate_limit_trigger
  before insert on public.scores
  for each row
  execute function public.scores_rate_limit();

commit;

-- ----------------------------------------------------------------------------
-- Optional cleanup of pre-existing forged rows (run separately, after
-- eyeballing what it would delete with the SELECT version first):
--
-- select * from public.scores
-- where avg_solve_ms not between 500 and 600000
--    or accuracy not between 0 and 1
--    or difficulty not in ('easy', 'medium', 'hard', 'expert', 'daily')
--    or display_name is null
--    or char_length(display_name) not between 1 and 80;
--
-- delete from public.scores
-- where avg_solve_ms not between 500 and 600000
--    or accuracy not between 0 and 1
--    or difficulty not in ('easy', 'medium', 'hard', 'expert', 'daily')
--    or display_name is null
--    or char_length(display_name) not between 1 and 80;
-- ----------------------------------------------------------------------------
