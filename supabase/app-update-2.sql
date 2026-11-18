-- Run once in Supabase > SQL Editor, AFTER app-update.sql. Safe to run again.
-- BEFORE running: save your current rule function so you can restore it if needed:
--   select pg_get_functiondef('public.enforce_listing_rules'::regproc);

-- 1) Fixed pickup times offered by a guide / trip / tour / activity (e.g. {06:00,09:00})
alter table listings add column if not exists pickup_times text[] not null default '{}';

-- 2) Drop-off places are private: only the guest and the admin can read them (the host cannot)
create table if not exists booking_dropoffs (
  booking_id uuid primary key references bookings(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  dropoff_location text, dropoff_lat double precision, dropoff_lng double precision,
  created_at timestamptz not null default now());
alter table booking_dropoffs enable row level security;
grant select, insert on booking_dropoffs to authenticated;
drop policy if exists dropoffs_read on booking_dropoffs;
create policy dropoffs_read on booking_dropoffs for select using (user_id = auth.uid() or is_admin());
drop policy if exists dropoffs_insert on booking_dropoffs;
create policy dropoffs_insert on booking_dropoffs for insert
  with check (user_id = auth.uid() and exists (select 1 from bookings b where b.id = booking_id and b.user_id = auth.uid()));
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bookings' and column_name = 'dropoff_location') then
    insert into booking_dropoffs (booking_id, user_id, dropoff_location, dropoff_lat, dropoff_lng)
      select id, user_id, dropoff_location, dropoff_lat, dropoff_lng from bookings where dropoff_location is not null on conflict do nothing;
    alter table bookings drop column dropoff_location, drop column dropoff_lat, drop column dropoff_lng;   -- hosts read bookings, so the columns must go
  end if;
end $$;

-- 3) Who may list what. Verification happens once, on the registration (hotel, campsite, attraction, or company / business = category 'activity').
--    Guides, trips, tours, activities, Airbnbs and events need no separate verification of their own.
create or replace function enforce_listing_rules() returns trigger language plpgsql security definer set search_path = public as $$
declare p providers;
begin
  select * into p from providers where id = new.provider_id;
  if p.user_id <> new.owner_id then raise exception 'Provider mismatch'; end if;
  if not is_admin() then
    if p.verification <> 'approved' then raise exception 'Your registration is not verified yet'; end if;
    if p.category = 'hotel' and new.category <> 'hotel' then raise exception 'A hotel host can only list a hotel'; end if;
    if p.category = 'campsite' and new.category not in ('campsite', 'event') then raise exception 'A campsite host can only list a campsite and events'; end if;
    if p.category = 'attraction' and new.category <> 'attraction' then raise exception 'An attraction host can only list an attraction'; end if;
    if p.category = 'activity' and new.category not in ('airbnb', 'activity', 'event', 'guide') then raise exception 'A company can list Airbnbs, activities, events, tours and guides'; end if;
    if p.category in ('hotel', 'campsite', 'attraction') and new.category = p.category
       and (p.tra_number is null or p.registration_number is null or p.registration_document_url is null) then
      raise exception 'TRA number, registration number and registration document are required'; end if;
  end if;
  new.updated_at := now(); return new; end $$;

-- 4) One registration per type per person (skipped with a notice if you already have duplicates)
do $$ begin
  create unique index if not exists one_provider_per_category on providers (user_id, category) where verification <> 'rejected';
exception when others then raise notice 'one_provider_per_category skipped: %', sqlerrm; end $$;
