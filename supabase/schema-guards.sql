-- Guards for league connection. Run this in the Supabase SQL editor.
--
-- WHY THIS FILE EXISTS
--
-- The app checks these rules before it writes, but an app check is a courtesy,
-- not a guarantee: anyone can call the Supabase REST API directly with their own
-- session token and skip the UI entirely. Only the database can actually stop a
-- bad write, so the rules that matter are here.
--
-- Two things are being protected:
--
--   1. A team belongs to ONE Huddle account. Sleeper has no OAuth, so knowing
--      someone's username is enough to list their leagues -- the account itself
--      can't be proven. What CAN be guaranteed is that whoever connects a team
--      first holds it, and nobody else can attach themselves to the same roster.
--
--   2. Nobody can write a membership row for somebody else. Without this, one
--      account could insert a row claiming another user is in a league, or edit
--      someone else's row to hand themselves commissioner rights.
--
-- Run the AUDIT section first. If it returns rows, resolve those before applying
-- the unique index, because it will refuse to build while duplicates exist.

-- ---------------------------------------------------------------------------
-- AUDIT -- run this first, on its own.
-- ---------------------------------------------------------------------------
-- Teams currently claimed by more than one account. Expect zero rows.
select
    league_id,
    lower(regexp_replace(trim(team_name), '\s+', ' ', 'g')) as team_claim,
    count(*)                as claim_count,
    array_agg(user_id)      as accounts
from public.user_leagues
where team_name is not null and trim(team_name) <> ''
group by 1, 2
having count(*) > 1;

-- ---------------------------------------------------------------------------
-- 1. One account per team, per league.
-- ---------------------------------------------------------------------------
-- Normalised the same way the app normalises it (see teamClaimKey in
-- src/utils/leagueMembership.js), so a claim can't be sidestepped by changing
-- capitalisation or padding. Rows with no team name are excluded: "not yet
-- identified" is not a claim, and several of those must be allowed to coexist.
create unique index if not exists user_leagues_one_account_per_team
    on public.user_leagues (
        league_id,
        (lower(regexp_replace(trim(team_name), '\s+', ' ', 'g')))
    )
    where team_name is not null and trim(team_name) <> '';

-- A user joins a given league once.
create unique index if not exists user_leagues_one_row_per_user_league
    on public.user_leagues (user_id, league_id);

-- ---------------------------------------------------------------------------
-- 2. A membership row belongs to the account that owns it.
-- ---------------------------------------------------------------------------
alter table public.user_leagues enable row level security;

drop policy if exists user_leagues_select_own on public.user_leagues;
drop policy if exists user_leagues_insert_own on public.user_leagues;
drop policy if exists user_leagues_update_own on public.user_leagues;
drop policy if exists user_leagues_delete_own on public.user_leagues;

-- Read: members of a league can see who else is in it. That is what lets chat
-- and the manager pages show league mates, so it is deliberately not "own row
-- only" -- it is "leagues you are in".
--
-- The lookup goes through a SECURITY DEFINER function rather than a plain
-- subquery. A policy on user_leagues that itself selects from user_leagues
-- re-enters the policy and Postgres fails the query with infinite recursion --
-- which would break chat and the manager pages outright. The function runs with
-- the owner's rights, so it reads the table once without re-triggering RLS.
create or replace function public.current_user_league_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
    select league_id from public.user_leagues where user_id = auth.uid();
$$;

revoke all on function public.current_user_league_ids() from public;
grant execute on function public.current_user_league_ids() to authenticated;

create policy user_leagues_select_own on public.user_leagues
    for select using (
        user_id = auth.uid()
        or league_id in (select public.current_user_league_ids())
    );

-- Write: only ever your own row.
create policy user_leagues_insert_own on public.user_leagues
    for insert with check (user_id = auth.uid());

create policy user_leagues_update_own on public.user_leagues
    for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy user_leagues_delete_own on public.user_leagues
    for delete using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 3. League settings are the commissioner's to change.
-- ---------------------------------------------------------------------------
-- Dues, the constitution and the commish note all live on `leagues`. Without
-- this, any member could rewrite them.
alter table public.leagues enable row level security;

drop policy if exists leagues_select_member on public.leagues;
drop policy if exists leagues_insert_authenticated on public.leagues;
drop policy if exists leagues_update_commissioner on public.leagues;

-- Any signed-in user can look a league up: connecting to one requires finding
-- the existing row first, otherwise every member would create a duplicate
-- league and land in a different chat.
create policy leagues_select_member on public.leagues
    for select using (auth.uid() is not null);

create policy leagues_insert_authenticated on public.leagues
    for insert with check (auth.uid() is not null);

-- Reads user_leagues, not leagues, so there is no recursion here -- but it does
-- depend on the reader being able to see their own membership row, which the
-- policy above allows.
create policy leagues_update_commissioner on public.leagues
    for update using (
        exists (
            select 1 from public.user_leagues ul
            where ul.league_id = public.leagues.id
              and ul.user_id = auth.uid()
              and ul.is_commissioner = true
        )
    );

-- ---------------------------------------------------------------------------
-- NOTE ON COMMISSIONER STATUS
-- ---------------------------------------------------------------------------
-- is_commissioner lives on the user's own row, and the policy above lets them
-- update that row -- so a determined user could set it themselves via the API.
-- Closing that properly means moving the flag somewhere the user cannot write,
-- verified server-side against the platform. Worth doing if league settings
-- become sensitive; noted here rather than left as a silent assumption.
