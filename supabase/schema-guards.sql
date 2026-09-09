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

-- ---------------------------------------------------------------------------
-- 4. Power-ranking movement, shared across every viewer of a league.
-- ---------------------------------------------------------------------------
-- This used to live in the viewing browser's own localStorage, which meant two
-- different members (or the same person on two devices) could see different
-- "moved up/down" numbers for the identical league on the identical day,
-- depending purely on how consistently each one's own browser had happened to
-- load the app in past weeks. One row per league per week, shared by everyone
-- who can see the league, is what makes the number actually mean the same
-- thing to whoever is looking at it.
create table if not exists public.league_rank_snapshots (
    league_id   uuid not null references public.leagues(id) on delete cascade,
    week        integer not null,
    -- Roster ids, best-to-worst, as of this week -- what movementFromSnapshots
    -- (src/utils/rankMovement.js) compares the current order against.
    roster_order jsonb not null,
    updated_at  timestamptz not null default now(),
    primary key (league_id, week)
);

alter table public.league_rank_snapshots enable row level security;

drop policy if exists league_rank_snapshots_select_member on public.league_rank_snapshots;
drop policy if exists league_rank_snapshots_insert_member on public.league_rank_snapshots;
drop policy if exists league_rank_snapshots_update_member on public.league_rank_snapshots;

-- Read: anyone in the league -- reuses the same membership function the
-- user_leagues read policy above already defined, so there is nothing new to
-- audit for correctness.
create policy league_rank_snapshots_select_member on public.league_rank_snapshots
    for select using (league_id in (select public.current_user_league_ids()));

-- Write: also any member, not just the commissioner. Whoever's browser
-- happens to load the rankings first in a given week is the one that records
-- it -- there is no single writer to designate, and the value being written
-- is a deterministic computed snapshot (the same league data produces the
-- same order for anyone), not a setting one member could use this to
-- misrepresent to the others. Both insert and update are needed: the app
-- upserts, and Postgres can route a single upsert through either path
-- depending on whether the (league_id, week) row already exists.
create policy league_rank_snapshots_insert_member on public.league_rank_snapshots
    for insert with check (league_id in (select public.current_user_league_ids()));

create policy league_rank_snapshots_update_member on public.league_rank_snapshots
    for update using (league_id in (select public.current_user_league_ids()))
    with check (league_id in (select public.current_user_league_ids()));

-- ---------------------------------------------------------------------------
-- 5. profiles.email -- needed to sync a Resend unsubscribe back to the app.
-- ---------------------------------------------------------------------------
-- api/resend-webhook.js only ever gets an email address from Resend (that's
-- all a contact object carries), and has to turn that into "whose
-- newsletter_opt_in do I flip". profiles isn't otherwise queryable by email:
-- auth.users isn't reachable from the client, and matching through the admin
-- API means an extra round trip for every webhook delivery instead of one
-- indexed lookup. New rows are written with this going forward (Login.jsx);
-- this backfills every row that already exists.
alter table public.profiles add column if not exists email text;

update public.profiles p
set email = u.email
from auth.users u
where p.id = u.id and p.email is null;

create index if not exists profiles_email_idx on public.profiles (email);

-- ---------------------------------------------------------------------------
-- 6. Weekly Summaries -- the Pro recap generated every Tuesday.
-- ---------------------------------------------------------------------------
-- One row per league per week, not per user: the recap is the same objective
-- account of what happened in that league's week regardless of which Pro
-- member is reading it, so it's generated once (api/weekly-summary.js) and
-- shared, the same reasoning league_rank_snapshots above already uses.
-- `stats` holds the raw computed facts (matchup scores, blowout/closest
-- call, position MVPs, transactions, etc.) that were handed to the AI to
-- narrate -- kept alongside `narrative` so the app can render its own
-- structured stat cards without re-parsing prose, and so a wrong narrative
-- claim can be checked against the real numbers it was supposed to be
-- grounded in.
create table if not exists public.league_weekly_summaries (
    league_id   uuid not null references public.leagues(id) on delete cascade,
    season      text not null,
    week        integer not null,
    stats       jsonb not null,
    narrative   text not null,
    generated_at timestamptz not null default now(),
    primary key (league_id, season, week)
);

alter table public.league_weekly_summaries enable row level security;

drop policy if exists league_weekly_summaries_select_member on public.league_weekly_summaries;

-- Read: any league member. Whether a given viewer is actually allowed to see
-- the content is a Pro-subscription check the app makes (the same posture
-- Trade Grader and the Managers scouting reports already use -- isPremium is
-- an app-level gate, not an RLS one); RLS's job here is only "not some other
-- league's data".
create policy league_weekly_summaries_select_member on public.league_weekly_summaries
    for select using (league_id in (select public.current_user_league_ids()));

-- Write: nobody via the client, deliberately -- no insert/update policy for
-- `authenticated` at all. Only api/weekly-summary.js writes these, using the
-- service-role key (which bypasses RLS entirely), the same way every other
-- server-only write in this app works.
