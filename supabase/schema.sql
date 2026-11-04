-- ============================================================================
-- MAS WALL — Supabase schema (hosted deployment variant)
--
-- Run this FIRST in the Supabase SQL Editor, then run supabase/seed.sql.
-- Both files are safe to re-run.
--
-- What this creates
--   public.cards  one row per poster: id (the card id) + data (the full card
--                 JSON object exactly as CONTRACT.md section 3 describes it).
--                 One row per card is deliberate: two people editing different
--                 posters touch different rows, so edits cannot clobber each other.
--   public.board  exactly one row (id = 1) holding the course header object
--                 {title, subtitle, term}.
--
-- Access model
--   This is an intentionally open, no-login board: anyone with the deployed URL
--   can read and write. RLS is enabled (so the anon key cannot reach anything
--   outside these tables) and then explicitly opened with permissive policies.
--   Read DEPLOY-SUPABASE.md > "Security" before sharing the link.
--
-- Realtime
--   Both tables are added to the supabase_realtime publication so open tabs see
--   card.upsert / card.delete / course.update style changes without polling.
--   REPLICA IDENTITY FULL makes UPDATE/DELETE payloads carry the whole row,
--   which is what a JSON-in-a-column board needs to re-render.
-- ============================================================================

-- ---------------------------------------------------------------- tables

create table if not exists public.cards (
  id         text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.board (
  id         integer primary key default 1 check (id = 1),
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

comment on table public.cards is
  'One row per poster. data is the full card object from CONTRACT.md section 3; id is the card id.';
comment on column public.cards.data is
  'Complete card JSON (title, type, course, due, requirements, x/y/w/rot/z, color, ...).';
comment on table public.board is
  'Single-row table (id = 1) holding the course header: {title, subtitle, term}.';

-- Keep updated_at honest even when a client forgets to send it.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists cards_set_updated_at on public.cards;
create trigger cards_set_updated_at
  before update on public.cards
  for each row execute function public.set_updated_at();

drop trigger if exists board_set_updated_at on public.board;
create trigger board_set_updated_at
  before update on public.board
  for each row execute function public.set_updated_at();

-- Full row images in realtime change events (needed for UPDATE/DELETE payloads).
alter table public.cards replica identity full;
alter table public.board replica identity full;

-- ---------------------------------------------------------------- row level security

alter table public.cards enable row level security;
alter table public.board enable row level security;

-- Deliberately permissive: the board is open by design (no accounts, no login).
-- Anyone holding the anon key — i.e. anyone with the deployed link — may edit.
-- Drop-then-create keeps this file re-runnable.
drop policy if exists cards_select_public on public.cards;
create policy cards_select_public on public.cards
  for select to anon, authenticated using (true);

drop policy if exists cards_insert_public on public.cards;
create policy cards_insert_public on public.cards
  for insert to anon, authenticated with check (true);

drop policy if exists cards_update_public on public.cards;
create policy cards_update_public on public.cards
  for update to anon, authenticated using (true) with check (true);

drop policy if exists cards_delete_public on public.cards;
create policy cards_delete_public on public.cards
  for delete to anon, authenticated using (true);

drop policy if exists board_select_public on public.board;
create policy board_select_public on public.board
  for select to anon, authenticated using (true);

drop policy if exists board_insert_public on public.board;
create policy board_insert_public on public.board
  for insert to anon, authenticated with check (true);

drop policy if exists board_update_public on public.board;
create policy board_update_public on public.board
  for update to anon, authenticated using (true) with check (true);

drop policy if exists board_delete_public on public.board;
create policy board_delete_public on public.board
  for delete to anon, authenticated using (true);

-- Table privileges for the browser roles (Supabase normally grants these by
-- default; stating them explicitly keeps the file self-contained).
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.cards to anon, authenticated;
grant select, insert, update, delete on public.board to anon, authenticated;

-- ---------------------------------------------------------------- realtime

-- supabase_realtime exists on every new Supabase project. Add each table only
-- once: ALTER PUBLICATION ... ADD TABLE errors if the table is already in it,
-- so the membership is checked in pg_publication_tables first.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cards'
    ) then
      execute 'alter publication supabase_realtime add table public.cards';
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'board'
    ) then
      execute 'alter publication supabase_realtime add table public.board';
    end if;
  else
    -- Very old / custom projects may not have the publication: create it.
    execute 'create publication supabase_realtime for table public.cards, public.board';
  end if;
end
$$;

-- ---------------------------------------------------------------- sanity output

select 'cards' as table_name, count(*) as rows from public.cards
union all
select 'board' as table_name, count(*) as rows from public.board;
