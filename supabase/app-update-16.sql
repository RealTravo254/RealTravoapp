-- Meeting/pickup points and pickup capability for guided tours and activities.
alter table public.listings
  add column if not exists meeting_point text,
  add column if not exists meeting_point_lat double precision,
  add column if not exists meeting_point_lng double precision,
  add column if not exists pickup_from_guest_location boolean not null default false;

notify pgrst, 'reload schema';
