-- Run once in Supabase SQL Editor to save the custom-trip booking contact email.

alter table public.trip_packages
  add column if not exists contact_email text;

alter table public.bookings
  add column if not exists contact_email text;

notify pgrst, 'reload schema';
