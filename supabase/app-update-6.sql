-- Run once in Supabase SQL Editor to enable accommodation discovery and age-based trip pricing.

alter table public.listings
  add column if not exists accommodation_available boolean not null default false;

update public.listings
set accommodation_available = true
where category in ('hotel', 'resort', 'campsite', 'airbnb')
  and accommodation_available = false;

alter table public.trip_packages
  add column if not exists is_custom boolean not null default false,
  add column if not exists adults integer,
  add column if not exists children integer not null default 0;

alter table public.bookings
  add column if not exists start_time time,
  add column if not exists adults integer,
  add column if not exists children integer not null default 0;

alter table public.airport_transfers
  add column if not exists adults integer,
  add column if not exists children integer not null default 0;

update public.trip_packages
set adults = coalesce(adults, people), children = coalesce(children, 0)
where adults is null or children is null;

update public.bookings
set adults = coalesce(adults, guests), children = coalesce(children, 0)
where adults is null or children is null;

update public.airport_transfers
set adults = coalesce(adults, passengers), children = coalesce(children, 0)
where adults is null or children is null;

create or replace function public.scan_qr(p_token uuid)
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
  select * into b from bookings where qr_token = p_token or id = p_token for update;
  if b.id is null then raise exception 'Invalid booking code'; end if;

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

grant execute on function public.scan_qr(uuid) to authenticated;

notify pgrst, 'reload schema';
