-- Repair the booking contact-phone column and refresh Supabase's schema cache.
alter table public.bookings
  add column if not exists contact_phone text;

notify pgrst, 'reload schema';
