-- Add compact listing video and multiple facility/activity photos.
alter table public.listings
  add column if not exists video_url text;

alter table public.listing_prices
  add column if not exists photo_urls text[] not null default '{}';

update public.listing_prices
set photo_urls = array[photo_url]
where photo_url is not null
  and cardinality(photo_urls) = 0;

update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'video/mp4']
where id = 'listing-photos';

-- Save existing and future guest email addresses so hosts and Admin can follow up.
alter table public.bookings
  add column if not exists contact_email text;

update public.bookings b
set contact_email = u.email
from auth.users u
where u.id = b.user_id
  and b.contact_email is null
  and u.email is not null;

alter table public.bookings
  add column if not exists no_show_reported_at timestamptz,
  add column if not exists no_show_reported_by uuid references public.profiles(id),
  add column if not exists no_show_resolution text
    check (no_show_resolution is null or no_show_resolution in ('pending', 'refund_guest', 'pay_host')),
  add column if not exists no_show_reviewed_at timestamptz,
  add column if not exists no_show_admin_note text;

create or replace function public.report_booking_no_show(p_booking uuid, p_time_zone text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
  l public.listings;
begin
  select * into b from public.bookings where id = p_booking for update;
  if b.id is null then raise exception 'Booking not found'; end if;

  select * into l from public.listings where id = b.listing_id;
  if auth.uid() is null or l.owner_id is distinct from auth.uid() then raise exception 'Not allowed'; end if;
  if l.category not in ('activity', 'guide') then raise exception 'No-show reporting is only available for activities and guided trips'; end if;
  if b.status not in ('accepted', 'completed') or b.payment_status <> 'paid' then raise exception 'This booking is not eligible for no-show reporting'; end if;
  if b.checked_in_at is not null then raise exception 'This guest has already checked in'; end if;
  if b.no_show_reported_at is not null or b.no_show_resolution is not null then raise exception 'A no-show report already exists'; end if;
  if p_time_zone is null or not exists (select 1 from pg_timezone_names where name = p_time_zone) then
    raise exception 'Invalid host time zone';
  end if;
  if b.start_date is null or (b.start_date + coalesce(b.start_time, time '23:59:59')) at time zone p_time_zone > now() then
    raise exception 'The scheduled booking time has not passed';
  end if;

  update public.bookings
  set status = 'cancelled',
      no_show_reported_at = now(),
      no_show_reported_by = auth.uid(),
      no_show_resolution = 'pending'
  where id = b.id;

  insert into public.notifications(user_id, title, body, data)
  values (
    b.user_id,
    'No-show report under review',
    'Your host reported that you did not arrive for this booking. Admin will contact you before deciding whether to refund your balance or release the booking earnings to the host.',
    jsonb_build_object('type', 'booking_no_show_reported', 'booking_id', b.id)
  );
end;
$$;

create or replace function public.resolve_booking_no_show(
  p_booking uuid,
  p_resolution text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
  host_user uuid;
begin
  if not is_admin() then raise exception 'Not allowed'; end if;
  if p_resolution is null or p_resolution not in ('refund_guest', 'pay_host') then raise exception 'Choose a valid no-show outcome'; end if;

  select * into b from public.bookings where id = p_booking for update;
  if b.id is null or b.no_show_resolution is distinct from 'pending' then raise exception 'No pending no-show review exists'; end if;
  if b.payment_status <> 'paid' then raise exception 'Booking payment has already changed'; end if;

  select owner_id into host_user from public.listings where id = b.listing_id;
  if p_resolution = 'refund_guest' then
    update public.profiles set balance = balance + b.total where id = b.user_id;
    update public.bookings
    set payment_status = 'refunded',
        no_show_resolution = 'refund_guest',
        no_show_reviewed_at = now(),
        no_show_admin_note = nullif(trim(p_note), '')
    where id = b.id;
    insert into public.notifications(user_id, title, body, data)
    values
      (b.user_id, 'No-show review resolved', 'Admin confirmed a refund. The booking total was added to your account balance.', jsonb_build_object('type', 'booking_no_show_resolved', 'booking_id', b.id, 'resolution', p_resolution)),
      (host_user, 'No-show review resolved', 'Admin contacted the guest and confirmed a refund to their account balance.', jsonb_build_object('type', 'booking_no_show_resolved', 'booking_id', b.id, 'resolution', p_resolution));
  else
    update public.bookings
    set status = 'completed',
        no_show_resolution = 'pay_host',
        no_show_reviewed_at = now(),
        no_show_admin_note = nullif(trim(p_note), '')
    where id = b.id;
    insert into public.notifications(user_id, title, body, data)
    values
      (b.user_id, 'No-show review resolved', 'Admin contacted you and confirmed that the booking earnings will be released to the host.', jsonb_build_object('type', 'booking_no_show_resolved', 'booking_id', b.id, 'resolution', p_resolution)),
      (host_user, 'No-show review resolved', 'Admin contacted the guest and confirmed the booking earnings will be included in your host balance.', jsonb_build_object('type', 'booking_no_show_resolved', 'booking_id', b.id, 'resolution', p_resolution));
  end if;
end;
$$;

revoke all on function public.report_booking_no_show(uuid, text) from public, anon;
revoke all on function public.resolve_booking_no_show(uuid, text, text) from public, anon;
grant execute on function public.report_booking_no_show(uuid, text) to authenticated;
grant execute on function public.resolve_booking_no_show(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';