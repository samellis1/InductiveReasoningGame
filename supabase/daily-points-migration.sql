-- ============================================================================
-- daily-points-migration.sql
-- Run in the Supabase SQL editor (project lfbsratbyfgjufjpqfvi).
-- Idempotent — safe to run even if parts were applied before.
--
-- 1+2: previously-pending constraint updates (speed floor, difficulty set)
-- 3:   3-try scoring — points (0–15) + day_key so daily boards compare
--      everyone on the same daily number regardless of timezone.
-- ============================================================================

begin;

-- 1. Speed floor: fastest believable average is ~0.5s/problem.
alter table public.scores drop constraint if exists scores_avg_solve_ms_range;
alter table public.scores
  add constraint scores_avg_solve_ms_range
  check (avg_solve_ms between 500 and 600000) not valid;

-- 2. Difficulty set (expert removed; practice no longer posts, daily is the
--    only difficulty written going forward, but practice values stay legal
--    for old rows).
alter table public.scores drop constraint if exists scores_difficulty_allowed;
alter table public.scores
  add constraint scores_difficulty_allowed
  check (difficulty in ('easy', 'medium', 'hard', 'daily')) not valid;

-- 3. Daily points + day identity.
alter table public.scores
  add column if not exists points int;
alter table public.scores drop constraint if exists scores_points_range;
alter table public.scores
  add constraint scores_points_range
  check (points is null or points between 0 and 15) not valid;

alter table public.scores
  add column if not exists day_key text;
alter table public.scores drop constraint if exists scores_day_key_format;
alter table public.scores
  add constraint scores_day_key_format
  check (day_key is null or day_key ~ '^\d{4}-\d{2}-\d{2}$') not valid;

-- The daily board query: where day_key = today order by points desc, time asc.
create index if not exists scores_daily_board_idx
  on public.scores (day_key, points desc, avg_solve_ms asc);

commit;
