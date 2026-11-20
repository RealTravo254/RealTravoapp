-- Run once in Supabase SQL Editor to store custom-trip return details and contact phones.
alter table public.trip_packages
  add column if not exists trip_type text,
  add column if not exists pickup_time timestamptz,
  add column if not exists dropoff_location text,
  add column if not exists dropoff_lat double precision,
  add column if not exists dropoff_lng double precision,
  add column if not exists return_date date,
  add column if not exists return_time time,
  add column if not exists contact_phone text;

alter table public.bookings
  add column if not exists trip_type text,
  add column if not exists pickup_lat double precision,
  add column if not exists pickup_lng double precision,
  add column if not exists pickup_time time,
  add column if not exists return_date date,
  add column if not exists return_time time,
  add column if not exists contact_phone text;

alter table public.airport_transfers
  add column if not exists contact_phone text;

update public.trip_packages p
set contact_phone = pr.phone
from public.profiles pr
where p.user_id = pr.id and p.contact_phone is null and nullif(pr.phone, '') is not null;

update public.bookings b
set contact_phone = pr.phone
from public.profiles pr
where b.user_id = pr.id and b.contact_phone is null and nullif(pr.phone, '') is not null;

update public.airport_transfers a
set contact_phone = pr.phone
from public.profiles pr
where a.user_id = pr.id and a.contact_phone is null and nullif(pr.phone, '') is not null;

notify pgrst, 'reload schema';
