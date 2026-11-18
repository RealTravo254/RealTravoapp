-- Run once in Supabase > SQL Editor. Safe to run again.

-- 1) New columns
alter table listings add column if not exists duration_minutes int;
alter table bookings
  add column if not exists trip_type text, add column if not exists pickup_lat double precision, add column if not exists pickup_lng double precision,
  add column if not exists dropoff_location text, add column if not exists dropoff_lat double precision, add column if not exists dropoff_lng double precision,
  add column if not exists return_date date, add column if not exists return_time time;
alter table trip_packages
  add column if not exists trip_type text, add column if not exists dropoff_location text, add column if not exists dropoff_lat double precision,
  add column if not exists dropoff_lng double precision, add column if not exists return_date date, add column if not exists return_time time;

-- 2) Fix: the capacity check read new.passengers on trip_packages, which has no such column
create or replace function public.check_vehicle_capacity() returns trigger language plpgsql set search_path to 'public' as $function$
declare cap int;
begin
  select max_passengers into cap from vehicles where id = new.vehicle_id;
  if tg_table_name = 'airport_transfers' then
    if new.passengers > cap then raise exception 'Vehicle seats only % passengers', cap; end if;
  elsif tg_table_name = 'trip_packages' then
    if new.vehicle_id is not null and new.pickup_people > cap then raise exception 'Vehicle seats only % passengers', cap; end if;
  end if;
  return new;
end $function$;

-- 3) Let guests edit their OWN bookings while they are unpaid and pending (Edit booking screen)
drop policy if exists bookings_edit_unpaid on bookings;
create policy bookings_edit_unpaid on bookings for update
  using (user_id = auth.uid() and payment_status = 'unpaid' and status = 'pending')
  with check (user_id = auth.uid() and payment_status = 'unpaid' and status = 'pending');

drop policy if exists items_edit_unpaid on booking_items;
create policy items_edit_unpaid on booking_items for delete
  using (exists (select 1 from bookings b where b.id = booking_id and b.user_id = auth.uid() and b.payment_status = 'unpaid' and b.status = 'pending'));
