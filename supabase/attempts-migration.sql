-- ============================================================================
-- attempts-migration.sql
-- Run in the Supabase SQL editor (project lfbsratbyfgjufjpqfvi).
-- Idempotent — safe to run even if parts were applied before.
-- SUPERSEDES daily-points-migration.sql (points are no longer used; the
-- column is kept nullable for any legacy rows but nothing reads it).
--
-- Daily boards rank by: accuracy desc (solved), attempts asc, time asc.
-- ============================================================================

begin;

-- 1. Speed floor: fastest believable average is ~0.5s/problem.
alter table public.scores drop constraint if exists scores_avg_solve_ms_range;
alter table public.scores
  add constraint scores_avg_solve_ms_range
  check (avg_solve_ms between 500 and 600000) not valid;

-- 2. Difficulty set (practice values stay legal for old rows; only 'daily'
--    is written going forward).
alter table public.scores drop constraint if exists scores_difficulty_allowed;
alter table public.scores
  add constraint scores_difficulty_allowed
  check (difficulty in ('easy', 'medium', 'hard', 'daily')) not valid;

-- 3. Day identity: everyone competing on daily #N is compared by day_key,
--    regardless of timezone.
alter table public.scores
  add column if not exists day_key text;
alter table public.scores drop constraint if exists scores_day_key_format;
alter table public.scores
  add constraint scores_day_key_format
  check (day_key is null or day_key ~ '^\d{4}-\d{2}-\d{2}$') not valid;

-- 4. Attempts: total tries across the 5 daily puzzles (1–3 each → 5–15).
alter table public.scores
  add column if not exists attempts int;
alter table public.scores drop constraint if exists scores_attempts_range;
alter table public.scores
  add constraint scores_attempts_range
  check (attempts is null or attempts between 5 and 15) not valid;

-- Legacy column from the short-lived points system; kept nullable, unused.
alter table public.scores
  add column if not exists points int;

-- 5. Board index, matching the ranking order.
drop index if exists scores_daily_board_idx;
create index if not exists scores_daily_board_idx
  on public.scores (day_key, accuracy desc, attempts asc, avg_solve_ms asc);

commit;
