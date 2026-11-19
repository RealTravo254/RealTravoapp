-- Run once in Supabase SQL Editor after app-update-2.sql.
-- Adds a user display-currency preference, an admin-managed KES/USD rate,
-- and single-use QR check-in validation.

alter table profiles
  add column if not exists preferred_currency text
  check (preferred_currency in ('USD', 'KES'));

alter table app_settings
  add column if not exists kes_per_usd numeric not null default 130
  check (kes_per_usd > 0);

create or replace function scan_qr(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  b bookings;
  l listings;
  res jsonb;
begin
  select * into b from bookings where qr_token = p_token for update;
  if b.id is null then raise exception 'Invalid code'; end if;

  select * into l from listings where id = b.listing_id;
  if l.owner_id <> auth.uid() and not is_admin() then raise exception 'Not your booking'; end if;
  if b.status not in ('accepted', 'completed') then raise exception 'Booking is not active'; end if;
  if b.payment_status <> 'paid' then raise exception 'Booking is not paid'; end if;
  if b.checked_in_at is not null then raise exception 'Booking already checked in'; end if;

  update bookings set checked_in_at = now() where id = b.id returning * into b;
  select jsonb_build_object(
    'booking', to_jsonb(b),
    'items', coalesce((select jsonb_agg(to_jsonb(i)) from booking_items i where i.booking_id = b.id), '[]'::jsonb),
    'guest', (select jsonb_build_object('first_name', first_name, 'last_name', last_name, 'country', country) from profiles where id = b.user_id)
  ) into res;
  return res;
end
$$;

grant execute on function scan_qr(uuid) to authenticated;
