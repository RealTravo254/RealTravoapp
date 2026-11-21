-- Queue pending-booking emails and make email delivery retryable.
alter table public.bookings
  add column if not exists contact_phone text,
  add column if not exists contact_email text;

alter table public.notifications
  add column if not exists email_claimed_at timestamptz,
  add column if not exists email_sent_at timestamptz,
  add column if not exists email_error text;

-- Do not send old notifications again when email delivery is first enabled.
update public.notifications
set email_sent_at = created_at
where email_sent_at is null
  and 'email' = any(channel)
  and coalesce(data->>'type', '') <> 'booking_pending_payment';

create or replace function public.protect_notification_email_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('postgres', 'supabase_admin', 'service_role')
    and (new.email_claimed_at is distinct from old.email_claimed_at
      or new.email_sent_at is distinct from old.email_sent_at
      or new.email_error is distinct from old.email_error) then
    raise exception 'Email delivery status is managed by the server';
  end if;
  return new;
end;
$$;

drop trigger if exists notifications_protect_email_status on public.notifications;
create trigger notifications_protect_email_status
before update on public.notifications
for each row execute function public.protect_notification_email_status();

create or replace function public.claim_email_notifications(batch_size integer default 50)
returns setof public.notifications
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with queued as (
    select id
    from public.notifications
    where 'email' = any(channel)
      and email_sent_at is null
      and (email_claimed_at is null or email_claimed_at < now() - interval '10 minutes')
    order by created_at
    limit greatest(1, least(coalesce(batch_size, 50), 100))
    for update skip locked
  ),
  claimed as (
    update public.notifications n
    set email_claimed_at = now()
    from queued q
    where n.id = q.id
    returning n.*
  )
  select * from claimed;
end;
$$;

revoke all on function public.claim_email_notifications(integer) from public, anon, authenticated;
grant execute on function public.claim_email_notifications(integer) to service_role;

create or replace function public.notify_pending_booking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  listing_title text;
begin
  if new.parent_booking_id is not null then return new; end if;
  if new.package_id is not null and exists (
    select 1 from public.bookings
    where package_id = new.package_id and id <> new.id
  ) then return new; end if;

  select title into listing_title from public.listings where id = new.listing_id;
  insert into public.notifications(user_id, title, body, channel, data)
  values (
    new.user_id,
    'Booking saved — payment needed',
    format('Your booking for %s on %s is pending. Open RealTravo → My bookings → Pending, then choose Pay now to complete it.',
      coalesce(listing_title, 'your selected place'),
      coalesce(to_char(new.start_date, 'Mon DD, YYYY'), 'your selected date')),
    array['in_app', 'email'],
    jsonb_build_object('type', 'booking_pending_payment', 'booking_id', new.id, 'package_id', new.package_id, 'email', new.contact_email)
  );
  return new;
end;
$$;

drop trigger if exists bookings_pending_notification on public.bookings;
create trigger bookings_pending_notification
after insert on public.bookings
for each row execute function public.notify_pending_booking();

-- Queue email for existing unpaid pending bookings that have not already been notified.
insert into public.notifications(user_id, title, body, channel, data)
select b.user_id,
  'Booking saved — payment needed',
  format('Your booking for %s on %s is pending. Open RealTravo → My bookings → Pending, then choose Pay now to complete it.',
    coalesce(l.title, 'your selected place'),
    coalesce(to_char(b.start_date, 'Mon DD, YYYY'), 'your selected date')),
  array['in_app', 'email'],
  jsonb_build_object('type', 'booking_pending_payment', 'booking_id', b.id, 'package_id', b.package_id, 'email', b.contact_email)
from public.bookings b
left join public.listings l on l.id = b.listing_id
where b.status = 'pending'
  and b.payment_status = 'unpaid'
  and b.created_at >= now() - interval '30 days'
  and not exists (
    select 1 from public.notifications n
    where n.data->>'type' = 'booking_pending_payment'
      and n.data->>'booking_id' = b.id::text
  );

notify pgrst, 'reload schema';
