-- Ensure package contact phones exist for booking creation.
alter table public.trip_packages
  add column if not exists contact_phone text;

notify pgrst, 'reload schema';
