-- TravelApp database schema (already applied to Supabase project whtyrqbmbgyospyrlznx).
-- Run in the Supabase SQL editor on a NEW project to recreate it. Order matters.
create extension if not exists pgcrypto;
create extension if not exists pg_trgm with schema extensions;

create type user_role as enum ('user','provider','admin');
create type listing_category as enum ('hotel','resort','campsite','attraction','airbnb','activity','event','guide');
create type review_status as enum ('draft','pending','approved','rejected','hidden');
create type booking_status as enum ('pending','accepted','declined','cancelled','completed');
create type payment_status as enum ('unpaid','paid','refunded');

create table app_settings (
  id int primary key default 1 check (id = 1),
  commission_percent numeric not null default 10, min_age int not null default 16,
  urgent_response_hours int not null default 6, normal_response_hours int not null default 12,
  subscription_price numeric not null default 10, currency text not null default 'USD');
insert into app_settings default values;

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role user_role not null default 'user',
  first_name text, last_name text, gender text, country text, date_of_birth date, phone text, avatar_url text,
  language text not null default 'en', balance numeric not null default 0 check (balance >= 0),
  subscription_until timestamptz, is_bnb_verified boolean not null default false,
  created_at timestamptz not null default now());

create or replace function is_admin() returns boolean language sql stable security definer set search_path = public as
$$ select exists(select 1 from profiles where id = auth.uid() and role = 'admin') $$;

create or replace function check_age() returns trigger language plpgsql set search_path = public as $$
begin
  if new.date_of_birth is not null and new.date_of_birth > (current_date - interval '16 years') then raise exception 'You must be at least 16 years old'; end if;
  return new; end $$;
create trigger profiles_age before insert or update on profiles for each row execute function check_age();

create or replace function handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, first_name, last_name, gender, country, date_of_birth)
  values (new.id, coalesce(new.raw_user_meta_data->>'first_name', split_part(coalesce(new.raw_user_meta_data->>'full_name',''),' ',1)),
    new.raw_user_meta_data->>'last_name', new.raw_user_meta_data->>'gender', new.raw_user_meta_data->>'country',
    nullif(new.raw_user_meta_data->>'date_of_birth','')::date) on conflict do nothing;
  return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

create or replace function protect_profile_fields() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not is_admin() then
    new.role := old.role; new.balance := old.balance; new.is_bnb_verified := old.is_bnb_verified; new.subscription_until := old.subscription_until;
  end if; return new; end $$;
create trigger profiles_protect before update on profiles for each row execute function protect_profile_fields();

create table providers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  category listing_category not null, business_name text not null,
  registration_number text, tra_number text, registration_document_url text,
  country text not null, region text, location_name text, lat double precision, lng double precision,
  contact_email text, contact_phone text, contact_whatsapp text,
  verification review_status not null default 'pending', admin_note text,
  is_prioritized boolean not null default false, priority_until timestamptz, created_at timestamptz not null default now());

create table listings (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references providers(id) on delete cascade,
  owner_id uuid not null references profiles(id) on delete cascade,
  category listing_category not null, title text not null, description text,
  country text not null, region text, location_name text, google_place_id text, lat double precision, lng double precision,
  photos text[] not null default '{}', facilities text[] not null default '{}',
  accommodation_available boolean not null default false,
  open_days text[] not null default '{mon,tue,wed,thu,fri,sat,sun}', open_time time, close_time time,
  entrance_fee_free boolean not null default false,
  status review_status not null default 'draft', admin_note text,
  is_prioritized boolean not null default false, priority_until timestamptz,
  rating_avg numeric not null default 0, rating_count int not null default 0,
  event_date timestamptz, deleted_at timestamptz,
  daily_limit int check (daily_limit is null or daily_limit > 0),
  verified_once boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create unique index one_listing_per_provider on listings(provider_id, category) where category in ('hotel','campsite','attraction') and deleted_at is null;
create index listings_search on listings(category, country, region, status);
create index listings_title_trgm on listings using gin (title extensions.gin_trgm_ops);

create or replace function enforce_listing_rules() returns trigger language plpgsql security definer set search_path = public as $$
declare p providers; o profiles;
begin
  select * into p from providers where id = new.provider_id; select * into o from profiles where id = new.owner_id;
  if p.user_id <> new.owner_id then raise exception 'Provider mismatch'; end if;
  if not is_admin() then
    if p.verification <> 'approved' then raise exception 'Your provider registration is not verified yet'; end if;
    if new.category in ('hotel','campsite','attraction','guide') and p.category <> new.category then raise exception 'Your registration is for %, not %', p.category, new.category; end if;
    if new.category in ('hotel','campsite','attraction','guide') and (p.tra_number is null or p.registration_number is null or p.registration_document_url is null) then
      raise exception 'TRA number, registration number and registration document are required for %', new.category; end if;
    if new.category in ('airbnb','activity','event') and not o.is_bnb_verified then raise exception 'Only verified hosts can list %', new.category; end if;
  end if;
  new.updated_at := now(); return new; end $$;
create trigger listings_rules before insert or update on listings for each row execute function enforce_listing_rules();

create or replace function lock_listing_core() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not is_admin() then
    if old.verified_once and (new.category is distinct from old.category or new.location_name is distinct from old.location_name
       or new.lat is distinct from old.lat or new.lng is distinct from old.lng or new.google_place_id is distinct from old.google_place_id) then
      raise exception 'Category and location cannot be changed after the listing was verified'; end if;
    if new.provider_id <> old.provider_id or new.owner_id <> old.owner_id then raise exception 'Owner cannot change'; end if;
    new.verified_once := old.verified_once;
    if new.status = 'approved' and (old.status not in ('approved','hidden') or not old.verified_once) then raise exception 'Only admin can approve a listing'; end if;
  elsif is_admin() and new.status = 'approved' then new.verified_once := true; end if;
  return new; end $$;
create trigger listings_lock before update on listings for each row execute function lock_listing_core();

create table listing_contacts (listing_id uuid primary key references listings(id) on delete cascade, email text, phone text, whatsapp text);
create table listing_prices (
  id uuid primary key default gen_random_uuid(), listing_id uuid not null references listings(id) on delete cascade,
  kind text not null check (kind in ('entrance','facility','activity','ticket','room','guide')), label text not null,
  audience text not null default 'adult' check (audience in ('adult','child','foreigner','resident','group','vip','vvip','regular')),
  unit text not null default 'per_person' check (unit in ('per_person','per_group','per_night','per_day')),
  price numeric not null default 0 check (price >= 0), currency text not null default 'USD', is_optional boolean not null default true, capacity int);
create table offers (
  id uuid primary key default gen_random_uuid(), listing_id uuid not null references listings(id) on delete cascade,
  title text not null, percent_off numeric not null check (percent_off between 1 and 90),
  starts_on date not null, ends_on date not null, weekend_only boolean not null default false);
create table vehicles (
  id uuid primary key default gen_random_uuid(), name text not null,
  type text not null check (type in ('car','comfort','safari','van')), max_passengers int not null check (max_passengers > 0),
  base_fee numeric not null default 0, price_per_km numeric not null, active boolean not null default true);
create table destinations (
  id uuid primary key default gen_random_uuid(), name text not null, country text not null, region text, description text, image_url text,
  lat double precision, lng double precision, activities text[] not null default '{}', active boolean not null default true);
create table trip_packages (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id) on delete cascade,
  title text, is_custom boolean not null default false, people int not null default 1, adults int, children int not null default 0, start_date date, end_date date, trip_type text, pickup_time timestamptz,
  dropoff_location text, dropoff_lat double precision, dropoff_lng double precision, return_date date, return_time time, contact_phone text,
  pickup_location text, pickup_lat double precision, pickup_lng double precision,
  vehicle_id uuid references vehicles(id), pickup_people int, distance_km numeric,
  transfer_price numeric not null default 0, total numeric not null default 0,
  payment_status payment_status not null default 'unpaid', created_at timestamptz not null default now());
create table bookings (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id) on delete cascade,
  listing_id uuid not null references listings(id), package_id uuid references trip_packages(id) on delete set null,
  parent_booking_id uuid references bookings(id) on delete set null,
  status booking_status not null default 'pending', payment_status payment_status not null default 'unpaid',
  urgent boolean not null default false, respond_by timestamptz, start_date date, end_date date, start_time time, nights int, trip_type text,
  guests int not null default 1 check (guests > 0), adults int, children int not null default 0, pickup_location text, pickup_lat double precision, pickup_lng double precision,
  pickup_time time, return_date date, return_time time, contact_phone text, meeting_point text, note text,
  subtotal numeric not null default 0, discount numeric not null default 0, total numeric not null default 0, commission numeric not null default 0,
  qr_token uuid not null default gen_random_uuid(), checked_in_at timestamptz, decline_reason text, created_at timestamptz not null default now());
create index bookings_user on bookings(user_id); create index bookings_listing on bookings(listing_id);
create table booking_items (
  id uuid primary key default gen_random_uuid(), booking_id uuid not null references bookings(id) on delete cascade,
  price_id uuid references listing_prices(id), label text not null, quantity int not null default 1, unit_price numeric not null, amount numeric not null);

create or replace function booking_set_defaults() returns trigger language plpgsql security definer set search_path = public as $$
declare s app_settings;
begin select * into s from app_settings where id = 1;
  new.respond_by := now() + make_interval(hours => case when new.urgent then s.urgent_response_hours else s.normal_response_hours end);
  new.commission := round(new.total * s.commission_percent / 100, 2); return new; end $$;
create trigger bookings_defaults before insert on bookings for each row execute function booking_set_defaults();

create or replace function check_capacity() returns trigger language plpgsql security definer set search_path = public as $$
declare lim int; d date; used int;
begin
  select daily_limit into lim from listings where id = new.listing_id;
  if lim is null or new.start_date is null then return new; end if;
  for d in select generate_series(new.start_date, coalesce(new.end_date, new.start_date), interval '1 day')::date loop
    select coalesce(sum(guests),0) into used from bookings where listing_id = new.listing_id and status in ('pending','accepted','completed') and start_date <= d and coalesce(end_date, start_date) >= d;
    if used + new.guests > lim then raise exception 'Fully booked on % (only % left)', d, greatest(lim - used, 0); end if;
  end loop; return new; end $$;
create trigger bookings_capacity before insert on bookings for each row execute function check_capacity();

create table airport_transfers (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id) on delete cascade,
  vehicle_id uuid not null references vehicles(id), booking_id uuid references bookings(id) on delete set null,
  pickup text not null, dropoff text not null, pickup_time timestamptz not null, passengers int not null, adults int, children int not null default 0, distance_km numeric not null, price numeric not null, contact_phone text,
  status booking_status not null default 'pending', payment_status payment_status not null default 'unpaid', created_at timestamptz not null default now());
create or replace function check_vehicle_capacity() returns trigger language plpgsql set search_path = public as $$
declare cap int;
begin select max_passengers into cap from vehicles where id = new.vehicle_id;
  if tg_table_name = 'airport_transfers' and new.passengers > cap then raise exception 'Vehicle seats only % passengers', cap; end if;
  if tg_table_name = 'trip_packages' and new.vehicle_id is not null and new.pickup_people > cap then raise exception 'Vehicle seats only % passengers', cap; end if;
  return new; end $$;
create trigger transfers_cap before insert or update on airport_transfers for each row execute function check_vehicle_capacity();
create trigger packages_cap before insert or update on trip_packages for each row execute function check_vehicle_capacity();

create table custom_trip_requests (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id) on delete cascade,
  host_listing_id uuid references listings(id), is_company boolean not null default false,
  destination_ids uuid[] not null default '{}', people int not null, days int not null, activities text[] not null default '{}', note text,
  offered_price numeric, status text not null default 'pending' check (status in ('pending','accepted','rejected','countered')),
  admin_note text, created_at timestamptz not null default now());
create table reviews (
  id uuid primary key default gen_random_uuid(), booking_id uuid not null unique references bookings(id) on delete cascade,
  listing_id uuid not null references listings(id) on delete cascade, user_id uuid not null references profiles(id) on delete cascade,
  rating int not null check (rating between 1 and 5), comment text, created_at timestamptz not null default now());
create or replace function refresh_rating() returns trigger language plpgsql security definer set search_path = public as $$
begin update listings set rating_avg = coalesce((select round(avg(rating),2) from reviews where listing_id = new.listing_id),0),
  rating_count = (select count(*) from reviews where listing_id = new.listing_id) where id = new.listing_id; return new; end $$;
create trigger reviews_refresh after insert or update on reviews for each row execute function refresh_rating();
create or replace function review_requires_booking() returns trigger language plpgsql security definer set search_path = public as $$
begin if not exists (select 1 from bookings where id = new.booking_id and user_id = new.user_id and status in ('accepted','completed') and payment_status = 'paid') then
  raise exception 'Only guests with a paid, accepted booking can review'; end if; return new; end $$;
create trigger reviews_guard before insert on reviews for each row execute function review_requires_booking();

create table messages (id uuid primary key default gen_random_uuid(), booking_id uuid not null references bookings(id) on delete cascade,
  sender_id uuid not null references profiles(id) on delete cascade, body text not null, created_at timestamptz not null default now());
create table notifications (id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id) on delete cascade,
  title text not null, body text, urgent boolean not null default false, channel text[] not null default '{in_app}', read boolean not null default false, data jsonb, created_at timestamptz not null default now());
create table payments (id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id),
  booking_id uuid references bookings(id), package_id uuid references trip_packages(id),
  purpose text not null check (purpose in ('booking','package','subscription','prioritization','transfer')),
  provider text not null default 'paystack', reference text unique, amount numeric not null, currency text not null default 'USD',
  status text not null default 'pending', created_at timestamptz not null default now());
create table provider_payment_settings (provider_user_id uuid primary key references profiles(id) on delete cascade,
  paystack_public_key text, paystack_subaccount text, flutterwave_public_key text, mpesa_shortcode text,
  payout_bank_name text, payout_account_name text, payout_account_number text);
create table provider_booking_forms (id uuid primary key default gen_random_uuid(), listing_id uuid not null references listings(id) on delete cascade,
  owner_id uuid not null references profiles(id) on delete cascade, title text not null, slug text unique not null, price numeric not null,
  direct_to_bank boolean not null default false, active boolean not null default true, created_at timestamptz not null default now());
create table payment_methods (id uuid primary key default gen_random_uuid(), country text not null default '*',
  type text not null check (type in ('bank','paypal','mobile_money','wise','other')), name text not null, bank_code text, swift_code text, branch_code text,
  currency text, instructions text, active boolean not null default true);
create table provider_payout_accounts (id uuid primary key default gen_random_uuid(), user_id uuid not null references profiles(id) on delete cascade,
  payment_method_id uuid not null references payment_methods(id), account_name text not null, account_number text, paypal_email text, mobile_number text,
  is_default boolean not null default false, created_at timestamptz not null default now());

-- ===== Functions (RPC) =====
create or replace function respond_booking(p_booking uuid, p_accept boolean, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare b bookings; l listings;
begin
  select * into b from bookings where id = p_booking for update; select * into l from listings where id = b.listing_id;
  if l.owner_id <> auth.uid() and not is_admin() then raise exception 'Not allowed'; end if;
  if b.status <> 'pending' then raise exception 'Booking already handled'; end if;
  if p_accept then update bookings set status = 'accepted' where id = p_booking;
  else update bookings set status = 'declined', decline_reason = p_reason, payment_status = case when payment_status = 'paid' then 'refunded' else payment_status end where id = p_booking;
    if b.payment_status = 'paid' then update profiles set balance = balance + b.total where id = b.user_id; end if;
  end if;
  insert into notifications(user_id,title,body,urgent,channel,data) values (b.user_id, case when p_accept then 'Booking accepted' else 'Booking declined' end,
    case when p_accept then 'Your host accepted your booking.' else coalesce(p_reason,'Refunded to your account balance.') end, b.urgent, '{in_app,email,sms,whatsapp}', jsonb_build_object('booking_id',p_booking));
end $$;

create or replace function cancel_booking(p_booking uuid) returns void language plpgsql security definer set search_path = public as $$
declare b bookings;
begin select * into b from bookings where id = p_booking and user_id = auth.uid() for update;
  if b.id is null then raise exception 'Not found'; end if;
  if b.status in ('cancelled','declined','completed') then raise exception 'Cannot cancel'; end if;
  update bookings set status = 'cancelled', payment_status = case when payment_status = 'paid' then 'refunded' else payment_status end where id = p_booking;
  if b.payment_status = 'paid' then update profiles set balance = balance + b.total where id = b.user_id; end if; end $$;

create or replace function scan_qr(p_token uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare b bookings; l listings; res jsonb;
begin select * into b from bookings where qr_token = p_token or id = p_token for update; if b.id is null then raise exception 'Invalid booking code'; end if;
  select * into l from listings where id = b.listing_id;
  if l.owner_id <> auth.uid() and not is_admin() then raise exception 'Not your booking'; end if;
  if b.status not in ('accepted','completed') then raise exception 'Booking is not active'; end if;
  if b.payment_status <> 'paid' then raise exception 'Booking is not paid'; end if;
  if b.checked_in_at is not null then raise exception 'Booking already checked in'; end if;
  update bookings set checked_in_at = now() where id = b.id returning * into b;
  select jsonb_build_object('booking', to_jsonb(b), 'items', coalesce((select jsonb_agg(to_jsonb(i)) from booking_items i where i.booking_id = b.id),'[]'::jsonb),
    'guest', (select jsonb_build_object('first_name',first_name,'last_name',last_name,'country',country) from profiles where id = b.user_id)) into res;
  return res; end $$;

create or replace function get_listing_contact(p_listing uuid) returns listing_contacts language plpgsql security definer set search_path = public as $$
declare c listing_contacts; ok boolean;
begin select (exists(select 1 from bookings where listing_id = p_listing and user_id = auth.uid() and status in ('accepted','completed'))
    or exists(select 1 from profiles where id = auth.uid() and subscription_until > now())
    or exists(select 1 from listings where id = p_listing and owner_id = auth.uid()) or is_admin()) into ok;
  if not ok then raise exception 'Book or subscribe to see contact details'; end if;
  select * into c from listing_contacts where listing_id = p_listing; return c; end $$;

create or replace function set_listing_visibility(p_listing uuid, p_visible boolean) returns void language plpgsql security definer set search_path = public as $$
begin update listings set status = case when p_visible then 'approved' else 'hidden' end where id = p_listing and owner_id = auth.uid() and status in ('approved','hidden'); end $$;

create or replace function get_availability(p_listing uuid, p_start date, p_end date) returns int language plpgsql stable security definer set search_path = public as $$
declare lim int; d date; used int; worst int;
begin select daily_limit into lim from listings where id = p_listing and status = 'approved'; if lim is null then return null; end if; worst := lim;
  for d in select generate_series(p_start, coalesce(p_end, p_start), interval '1 day')::date loop
    select coalesce(sum(guests),0) into used from bookings where listing_id = p_listing and status in ('pending','accepted','completed') and start_date <= d and coalesce(end_date, start_date) >= d;
    worst := least(worst, lim - used); end loop;
  return greatest(worst, 0); end $$;

create or replace function nearby_listings(p_lat float8, p_lng float8, p_radius_km float8, p_exclude listing_category, p_categories listing_category[], lim int default 20)
returns table(id uuid, category listing_category, title text, region text, lat float8, lng float8, cover text, rating_avg numeric, from_price numeric, distance_km float8)
language sql stable set search_path = public as $$
  select * from (select l.id, l.category, l.title, l.region, l.lat, l.lng, l.photos[1], l.rating_avg, (select min(price) from listing_prices p where p.listing_id = l.id),
      6371 * 2 * asin(sqrt(power(sin(radians(l.lat - p_lat)/2),2) + cos(radians(p_lat)) * cos(radians(l.lat)) * power(sin(radians(l.lng - p_lng)/2),2))) as d
    from listings l where l.status = 'approved' and l.deleted_at is null and l.lat is not null
      and (p_exclude is null or l.category <> p_exclude) and (p_categories is null or l.category = any(p_categories))) t
  where d <= p_radius_km order by d limit lim; $$;

create or replace function attach_booking_to_package(p_booking uuid, p_package uuid) returns void language sql security definer set search_path = public as $$
  update bookings set package_id = p_package where id = p_booking and user_id = auth.uid() and payment_status = 'unpaid'
    and exists (select 1 from trip_packages where id = p_package and user_id = auth.uid()); $$;

create or replace function search_suggestions(q text, lim int default 8) returns table(kind text, label text, category listing_category, listing_id uuid)
language sql stable security invoker set search_path = public, extensions as $$
  select * from (select 'listing'::text, l.title, l.category, l.id from listings l where l.status = 'approved' and l.deleted_at is null and l.title ilike '%' || q || '%'
      order by l.is_prioritized desc, similarity(l.title, q) desc limit lim) a
  union all select * from (select distinct 'place'::text, coalesce(l.region, l.country), null::listing_category, null::uuid from listings l
      where l.status = 'approved' and l.deleted_at is null and (l.region ilike '%' || q || '%' or l.country ilike '%' || q || '%') limit 4) b
  union all select * from (select 'destination'::text, d.name, null::listing_category, null::uuid from destinations d where d.active and d.name ilike '%' || q || '%' limit 3) c
  limit lim; $$;

create or replace function expire_pending_bookings() returns int language plpgsql security definer set search_path = public as $$
declare b bookings; n int := 0;
begin for b in select * from bookings where status = 'pending' and respond_by < now() for update skip locked loop
    update bookings set status = 'declined', decline_reason = 'Host did not respond in time', payment_status = case when payment_status = 'paid' then 'refunded' else payment_status end where id = b.id;
    if b.payment_status = 'paid' then update profiles set balance = balance + b.total where id = b.user_id; end if;
    insert into notifications(user_id,title,body,urgent,channel) values (b.user_id,'Booking expired','The host did not respond in time. Refunded to your balance.', b.urgent,'{in_app,email,sms,whatsapp}');
    n := n + 1; end loop; return n; end $$;
create or replace function request_reviews() returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin with done as (update bookings set status = 'completed' where status = 'accepted' and payment_status = 'paid' and end_date < current_date returning user_id, id)
  insert into notifications(user_id,title,body,channel,data) select user_id,'How was your trip?','Please rate your experience.','{in_app,email}', jsonb_build_object('booking_id',id,'type','review_request') from done;
  get diagnostics n = row_count; return n; end $$;

-- Public cards for search / map (approved listings only, no contact details)
create or replace view listing_cards with (security_invoker = true) as
select l.id, l.category, l.title, l.country, l.region, l.location_name, l.lat, l.lng, l.photos[1] as cover, l.rating_avg, l.rating_count, l.is_prioritized, l.event_date,
       (select min(price) from listing_prices p where p.listing_id = l.id) as from_price
from listings l where l.status = 'approved' and l.deleted_at is null;

-- ===== Row level security =====
do $$ declare t text; begin
  foreach t in array array['app_settings','profiles','providers','listings','listing_contacts','listing_prices','offers','vehicles','destinations','trip_packages','bookings','booking_items',
    'airport_transfers','custom_trip_requests','reviews','messages','notifications','payments','provider_payment_settings','provider_booking_forms','payment_methods','provider_payout_accounts']
  loop execute format('alter table %I enable row level security', t); end loop; end $$;

create policy settings_read on app_settings for select using (true);
create policy settings_admin on app_settings for update using (is_admin());
create policy profiles_self_read on profiles for select using (id = auth.uid() or is_admin());
create policy profiles_self_update on profiles for update using (id = auth.uid() or is_admin());
create policy providers_read on providers for select using (user_id = auth.uid() or is_admin() or verification = 'approved');
create policy providers_insert on providers for insert with check (user_id = auth.uid());
create policy providers_update on providers for update using (user_id = auth.uid() or is_admin());
create policy listings_read on listings for select using ((status = 'approved' and deleted_at is null) or owner_id = auth.uid() or is_admin());
create policy listings_insert on listings for insert with check (owner_id = auth.uid() and status in ('draft','pending'));
create policy listings_update on listings for update using (owner_id = auth.uid() or is_admin())
  with check (is_admin() or (owner_id = auth.uid() and status in ('draft','pending','hidden','approved')));
create policy listings_delete on listings for delete using (owner_id = auth.uid() or is_admin());
create policy contacts_owner on listing_contacts for all using (exists(select 1 from listings l where l.id = listing_id and (l.owner_id = auth.uid() or is_admin())))
  with check (exists(select 1 from listings l where l.id = listing_id and (l.owner_id = auth.uid() or is_admin())));
create policy prices_read on listing_prices for select using (exists(select 1 from listings l where l.id = listing_id and ((l.status='approved' and l.deleted_at is null) or l.owner_id = auth.uid() or is_admin())));
create policy prices_write on listing_prices for all using (exists(select 1 from listings l where l.id = listing_id and (l.owner_id = auth.uid() or is_admin())))
  with check (exists(select 1 from listings l where l.id = listing_id and (l.owner_id = auth.uid() or is_admin())));
create policy offers_read on offers for select using (true);
create policy offers_write on offers for all using (exists(select 1 from listings l where l.id = listing_id and (l.owner_id = auth.uid() or is_admin())))
  with check (exists(select 1 from listings l where l.id = listing_id and (l.owner_id = auth.uid() or is_admin())));
create policy vehicles_read on vehicles for select using (active or is_admin());
create policy vehicles_admin on vehicles for all using (is_admin()) with check (is_admin());
create policy destinations_read on destinations for select using (active or is_admin());
create policy destinations_admin on destinations for all using (is_admin()) with check (is_admin());
create policy packages_own on trip_packages for all using (user_id = auth.uid() or is_admin()) with check (user_id = auth.uid() or is_admin());
create policy bookings_read on bookings for select using (user_id = auth.uid() or is_admin() or exists(select 1 from listings l where l.id = listing_id and l.owner_id = auth.uid()));
create policy bookings_insert on bookings for insert with check (user_id = auth.uid() and status = 'pending');
create policy bookings_admin_update on bookings for update using (is_admin());
create policy items_read on booking_items for select using (exists(select 1 from bookings b where b.id = booking_id and (b.user_id = auth.uid() or is_admin() or exists(select 1 from listings l where l.id = b.listing_id and l.owner_id = auth.uid()))));
create policy items_insert on booking_items for insert with check (exists(select 1 from bookings b where b.id = booking_id and b.user_id = auth.uid()));
create policy transfers_own on airport_transfers for all using (user_id = auth.uid() or is_admin()) with check (user_id = auth.uid() or is_admin());
create policy custom_read on custom_trip_requests for select using (user_id = auth.uid() or is_admin() or exists(select 1 from listings l where l.id = host_listing_id and l.owner_id = auth.uid()));
create policy custom_insert on custom_trip_requests for insert with check (user_id = auth.uid());
create policy custom_update on custom_trip_requests for update using (is_admin() or exists(select 1 from listings l where l.id = host_listing_id and l.owner_id = auth.uid()));
create policy reviews_read on reviews for select using (true);
create policy reviews_insert on reviews for insert with check (user_id = auth.uid());
create policy messages_read on messages for select using (exists(select 1 from bookings b where b.id = booking_id and (b.user_id = auth.uid() or exists(select 1 from listings l where l.id = b.listing_id and l.owner_id = auth.uid()))) or is_admin());
create policy messages_insert on messages for insert with check (sender_id = auth.uid() and exists(select 1 from bookings b where b.id = booking_id and b.status in ('accepted','completed')
  and (b.user_id = auth.uid() or exists(select 1 from listings l where l.id = b.listing_id and l.owner_id = auth.uid()))));
create policy notif_own on notifications for select using (user_id = auth.uid());
create policy notif_update on notifications for update using (user_id = auth.uid());
create policy payments_read on payments for select using (user_id = auth.uid() or is_admin());
create policy pps_own on provider_payment_settings for all using (provider_user_id = auth.uid()) with check (provider_user_id = auth.uid());
create policy forms_read on provider_booking_forms for select using (active or owner_id = auth.uid());
create policy forms_write on provider_booking_forms for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy pm_read on payment_methods for select using (active or is_admin());
create policy pm_admin on payment_methods for all using (is_admin()) with check (is_admin());
create policy ppa_own on provider_payout_accounts for all using (user_id = auth.uid() or is_admin()) with check (user_id = auth.uid());

-- ===== Function permissions =====
revoke execute on all functions in schema public from public, anon;
grant execute on function is_admin() to anon, authenticated;
grant execute on function get_availability(uuid,date,date), nearby_listings(float8,float8,float8,listing_category,listing_category[],int), search_suggestions(text,int) to anon, authenticated;
grant execute on function cancel_booking(uuid), get_listing_contact(uuid), respond_booking(uuid,boolean,text), scan_qr(uuid), set_listing_visibility(uuid,boolean), attach_booking_to_package(uuid,uuid) to authenticated;
grant select on listing_cards to anon, authenticated;

-- ===== Storage buckets =====
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
 ('listing-photos','listing-photos', true, 5242880, array['image/jpeg','image/png','image/webp']),
 ('destination-images','destination-images', true, 5242880, array['image/jpeg','image/png','image/webp']),
 ('avatars','avatars', true, 2097152, array['image/jpeg','image/png','image/webp']),
 ('provider-docs','provider-docs', false, null, null) on conflict (id) do nothing;
create policy photos_read on storage.objects for select using (bucket_id = 'listing-photos');
create policy photos_write on storage.objects for insert to authenticated with check (bucket_id = 'listing-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy photos_delete_own on storage.objects for delete to authenticated using (bucket_id = 'listing-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy dest_img_read on storage.objects for select using (bucket_id = 'destination-images');
create policy dest_img_admin on storage.objects for all to authenticated using (bucket_id = 'destination-images' and is_admin()) with check (bucket_id = 'destination-images' and is_admin());
create policy avatars_read on storage.objects for select using (bucket_id = 'avatars');
create policy avatars_own on storage.objects for all to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text) with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy docs_own on storage.objects for all to authenticated using (bucket_id = 'provider-docs' and ((storage.foldername(name))[1] = auth.uid()::text or is_admin()))
  with check (bucket_id = 'provider-docs' and (storage.foldername(name))[1] = auth.uid()::text);

-- ===== Starter data =====
insert into vehicles (name,type,max_passengers,base_fee,price_per_km) values
 ('Standard Car','car',3,5,0.8),('Comfort Sedan','comfort',3,8,1.1),('Safari Land Cruiser','safari',7,15,1.8),('Passenger Van','van',12,12,1.5);
insert into payment_methods (country, type, name, swift_code, currency) values
 ('Tanzania','bank','NMB Bank','NMIBTZTZ','TZS'), ('Tanzania','bank','CRDB Bank','CORUTZTZ','TZS'), ('Tanzania','mobile_money','M-Pesa Tanzania',null,'TZS'), ('Tanzania','mobile_money','Tigo Pesa',null,'TZS'),
 ('Kenya','bank','KCB Bank','KCBLKENX','KES'), ('Kenya','bank','Equity Bank','EQBLKENA','KES'), ('Kenya','mobile_money','M-Pesa Kenya',null,'KES'),
 ('*','paypal','PayPal',null,'USD'), ('*','wise','Wise',null,'USD');

-- ===== Scheduled jobs (enable pg_cron first) =====
create extension if not exists pg_cron;
select cron.schedule('expire-pending-bookings', '*/10 * * * *', $$select public.expire_pending_bookings()$$);
select cron.schedule('request-reviews', '0 * * * *', $$select public.request_reviews()$$);

-- ===== Make yourself admin (after signing up in the app) =====
-- update profiles set role='admin' where id = (select id from auth.users where email='YOU@EMAIL');

-- ===== v2/v3 additions (already applied to the connected project) =====
create table wishlist (
  user_id uuid not null references profiles(id) on delete cascade,
  listing_id uuid not null references listings(id) on delete cascade,
  created_at timestamptz not null default now(), primary key (user_id, listing_id));
alter table wishlist enable row level security;
create policy wishlist_own on wishlist for all using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table listings add column if not exists opening_hours jsonb;   -- {"mon":{"open":"08:00","close":"18:00"},"tue":{"closed":true},...}
alter table listing_prices add column if not exists description text;
alter table listing_prices add column if not exists photo_url text;

create table countries (id uuid primary key default gen_random_uuid(), name text unique not null, code text, dial_code text, active boolean not null default true);
alter table countries enable row level security;
create policy countries_read on countries for select using (active or is_admin());
create policy countries_admin on countries for all using (is_admin()) with check (is_admin());
insert into countries (name, code, dial_code) values
 ('Tanzania','TZ','+255'),('Kenya','KE','+254'),('Uganda','UG','+256'),('Rwanda','RW','+250'),('Burundi','BI','+257'),('Ethiopia','ET','+251'),
 ('South Africa','ZA','+27'),('Namibia','NA','+264'),('Botswana','BW','+267'),('Zambia','ZM','+260'),('Zimbabwe','ZW','+263'),('Mozambique','MZ','+258'),
 ('Malawi','MW','+265'),('Egypt','EG','+20'),('Morocco','MA','+212'),('Nigeria','NG','+234'),('Ghana','GH','+233'),('Senegal','SN','+221'),
 ('United States','US','+1'),('Canada','CA','+1'),('United Kingdom','GB','+44'),('Germany','DE','+49'),('France','FR','+33'),('Spain','ES','+34'),
 ('Italy','IT','+39'),('Netherlands','NL','+31'),('China','CN','+86'),('India','IN','+91'),('United Arab Emirates','AE','+971'),('Australia','AU','+61');

create table search_terms (term text primary key, hits int not null default 1, updated_at timestamptz not null default now());
alter table search_terms enable row level security;
create or replace function log_search(p_term text) returns void language plpgsql security definer set search_path = public as $$
declare t text := lower(trim(p_term));
begin if length(t) < 2 or length(t) > 60 then return; end if;
  insert into search_terms(term) values (t) on conflict (term) do update set hits = search_terms.hits + 1, updated_at = now(); end $$;
create or replace function popular_searches(lim int default 6) returns table(term text) language sql stable security definer set search_path = public as $$
  select term from search_terms order by hits desc, updated_at desc limit lim; $$;
create or replace function popular_locations(lim int default 8) returns table(label text, n bigint) language sql stable set search_path = public as $$
  select coalesce(l.region, l.country) as label, count(*) as n from listings l where l.status = 'approved' and l.deleted_at is null group by 1 order by 2 desc limit lim; $$;
create or replace function top_rated_near(p_lat float8, p_lng float8, p_radius_km float8, lim int default 10)
returns table(id uuid, category listing_category, title text, region text, country text, location_name text, lat float8, lng float8, cover text, rating_avg numeric, rating_count int, from_price numeric, distance_km float8)
language sql stable set search_path = public as $$
  select * from (select l.id, l.category, l.title, l.region, l.country, l.location_name, l.lat, l.lng, l.photos[1], l.rating_avg, l.rating_count,
      (select min(price) from listing_prices p where p.listing_id = l.id),
      6371 * 2 * asin(sqrt(power(sin(radians(l.lat - p_lat)/2),2) + cos(radians(p_lat)) * cos(radians(l.lat)) * power(sin(radians(l.lng - p_lng)/2),2))) as d
    from listings l where l.status = 'approved' and l.deleted_at is null and l.lat is not null) t
  where d <= p_radius_km order by rating_avg desc, rating_count desc, d limit lim; $$;
grant execute on function log_search(text), popular_searches(int), popular_locations(int), top_rated_near(float8,float8,float8,int) to anon, authenticated;

-- ===== v4 additions (already applied to the connected project) =====
-- airports, country_divisions, host_verifications, inquiries, pay-later columns, reminders and image-storage rules.
-- See the migration history in the Supabase dashboard (Database -> Migrations) for the exact statements:
--   v4_airports_verification_inquiries_reminders_images
-- Key objects: airports, country_divisions, host_verifications (private bucket host-verification), inquiries + respond_inquiry(),
-- bookings.start_time / pay_by, trip_packages.pickup_time, airport_transfers.pickup_lat/lng/dropoff_lat/lng,
-- send_trip_reminders() (cron every 15 min), expire_pending_bookings() (cancels unpaid after pay_by), triggers that reject non-storage image links.

-- ===== v5: admin-managed Terms & Privacy with user confirmation (already applied) =====
-- legal_documents (kind terms|privacy, url, content, version, published), legal_acceptances (user, kind, version),
-- publish_legal() admin-only, pending_legal(), accept_legal().

-- ===== v6 (already applied): all countries with dial codes, cities, M-Pesa host subscription price (KES), chat opens once paid =====
-- Edge functions mpesa-stk + mpesa-callback (secrets: MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_SHORTCODE, MPESA_PASSKEY, MPESA_ENV)

-- ===== v7 (already applied): unpaid hold (app_settings.unpaid_hold_hours, default 5), check_schedule() (open days/hours/event date),
-- cancel_booking() (paid = never, unpaid = until 6h before), providers.tra_image_path (TRA certificate photo), realtime on notifications + messages =====

-- ===== v8 (already applied): category_fees, host_payouts + host_summary()/admin_host_balances(), form_plans + form_subscriptions + create_booking_form(),
-- host_request_cancel()/respond_cancel_request(), bookings.pickup_time/booking_form_id/cancel_*, notify_host_paid trigger, experiences rule (airbnb/activity/event/guide) =====

-- ===== v10 (already applied): listings.schedule_type (always | range | tour | one_time), starts_on, ends_on; listing_is_live() hides finished listings;
-- check_schedule() enforces range / tour start / one-time date; listing_cards, nearby_listings, top_rated_near use listing_is_live =====
