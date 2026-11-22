begin;

create table if not exists public.booking_dropoffs (
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  dropoff_location text,
  dropoff_lat double precision,
  dropoff_lng double precision,
  created_at timestamptz not null default now()
);
alter table public.booking_dropoffs enable row level security;
grant select, insert on public.booking_dropoffs to authenticated;

alter table public.bookings add column if not exists dropoff_lat double precision;
alter table public.bookings add column if not exists dropoff_lng double precision;
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'bookings' and column_name = 'dropoff_location'
  ) then
    insert into public.booking_dropoffs(booking_id, user_id, dropoff_location, dropoff_lat, dropoff_lng)
    select id, user_id, dropoff_location, dropoff_lat, dropoff_lng
    from public.bookings
    where dropoff_location is not null
    on conflict (booking_id) do nothing;
  end if;
end
$$;
alter table public.bookings
  drop column if exists dropoff_location,
  drop column if exists dropoff_lat,
  drop column if exists dropoff_lng;

drop policy if exists booking_dropoffs_guest_read on public.booking_dropoffs;
create policy booking_dropoffs_guest_read on public.booking_dropoffs for select to authenticated
  using (user_id = auth.uid());
drop policy if exists booking_dropoffs_guest_insert on public.booking_dropoffs;
create policy booking_dropoffs_guest_insert on public.booking_dropoffs for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.bookings b where b.id = booking_id and b.user_id = auth.uid())
  );

alter table public.profiles
  add column if not exists is_super_admin boolean not null default false;

create table if not exists public.admin_bootstrap_emails (
  email text primary key check (email = lower(trim(email)))
);
insert into public.admin_bootstrap_emails(email)
values ('youngsterpaul254@gmail.com')
on conflict do nothing;

create table if not exists public.admin_page_permissions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  page_key text not null check (page_key in (
    'listings','providers','trips','vehicles','destinations','payouts','countries','cities',
    'regions','airports','dropoffs','host_ids','fees','legal','settings'
  )),
  can_view boolean not null default false,
  can_manage boolean not null default false,
  primary key (user_id, page_key),
  check (not can_manage or can_view)
);

alter table public.admin_bootstrap_emails enable row level security;
alter table public.admin_page_permissions enable row level security;
revoke all on public.admin_bootstrap_emails, public.admin_page_permissions from public, anon, authenticated;

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and is_super_admin
  )
$$;

create or replace function public.admin_can_view(p_page text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.is_admin() or exists (
    select 1
    from public.profiles p
    join public.admin_page_permissions a on a.user_id = p.id
    where p.id = auth.uid() and p.role = 'admin'
      and a.page_key = p_page and (a.can_view or a.can_manage)
  )
$$;

create or replace function public.admin_can_manage(p_page text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.is_admin() or exists (
    select 1
    from public.profiles p
    join public.admin_page_permissions a on a.user_id = p.id
    where p.id = auth.uid() and p.role = 'admin'
      and a.page_key = p_page and a.can_manage
  )
$$;

create or replace function public.admin_current_access()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare access jsonb;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Admin access required';
  end if;
  if public.is_admin() then
    select jsonb_object_agg(page_key, jsonb_build_object('can_view', true, 'can_manage', true))
      into access
      from unnest(array[
        'listings','providers','trips','vehicles','destinations','payouts','countries','cities',
        'regions','airports','dropoffs','host_ids','fees','legal','settings'
      ]) as pages(page_key);
  else
    select coalesce(jsonb_object_agg(page_key, jsonb_build_object('can_view', can_view, 'can_manage', can_manage)), '{}'::jsonb)
      into access
      from public.admin_page_permissions
      where user_id = auth.uid();
  end if;
  return jsonb_build_object('is_super_admin', public.is_admin(), 'permissions', coalesce(access, '{}'::jsonb));
end
$$;

create or replace function public.admin_list_users()
returns jsonb
language plpgsql stable security definer
set search_path = public, auth
as $$
declare users jsonb;
begin
  if not public.is_admin() then raise exception 'Super admin access required'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', p.id,
    'email', u.email,
    'first_name', p.first_name,
    'last_name', p.last_name,
    'is_super_admin', p.is_super_admin,
    'permissions', coalesce((
      select jsonb_object_agg(a.page_key, jsonb_build_object('can_view', a.can_view, 'can_manage', a.can_manage))
      from public.admin_page_permissions a where a.user_id = p.id
    ), '{}'::jsonb)
  ) order by u.email), '[]'::jsonb)
  into users
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.role = 'admin';
  return users;
end
$$;

create or replace function public.admin_set_user_access(p_email text, p_permissions jsonb)
returns void
language plpgsql security definer
set search_path = public, auth
as $$
declare
  target uuid;
  item jsonb;
  page text;
  can_view_page boolean;
  can_manage_page boolean;
begin
  if not public.is_admin() then raise exception 'Super admin access required'; end if;
  if p_email is null or trim(p_email) = '' or jsonb_typeof(p_permissions) is distinct from 'array' then
    raise exception 'Enter an account email and page permissions';
  end if;
  select id into target from auth.users where lower(email) = lower(trim(p_email));
  if target is null then raise exception 'That user must sign up before becoming an admin'; end if;
  if target = auth.uid() then raise exception 'Manage another admin account, not your own'; end if;
  if exists (select 1 from public.profiles where id = target and is_super_admin) then
    raise exception 'A super admin cannot be changed here';
  end if;
  update public.profiles set role = 'admin', is_super_admin = false where id = target;
  if not found then raise exception 'The user profile was not found'; end if;
  delete from public.admin_page_permissions where user_id = target;
  for item in select value from jsonb_array_elements(p_permissions) loop
    page := item->>'page_key';
    can_view_page := coalesce((item->>'can_view')::boolean, false);
    can_manage_page := coalesce((item->>'can_manage')::boolean, false);
    if page is null or page not in (
      'listings','providers','trips','vehicles','destinations','payouts','countries','cities',
      'regions','airports','dropoffs','host_ids','fees','legal','settings'
    ) then
      raise exception 'Invalid admin page permission';
    end if;
    if can_manage_page then can_view_page := true; end if;
    if can_view_page then
      insert into public.admin_page_permissions(user_id, page_key, can_view, can_manage)
      values (target, page, can_view_page, can_manage_page);
    end if;
  end loop;
end
$$;

create or replace function public.admin_remove_user_access(p_email text)
returns void
language plpgsql security definer
set search_path = public, auth
as $$
declare target uuid;
begin
  if not public.is_admin() then raise exception 'Super admin access required'; end if;
  select id into target from auth.users where lower(email) = lower(trim(p_email));
  if target is null then raise exception 'Admin account not found'; end if;
  if target = auth.uid() or exists (select 1 from public.profiles where id = target and is_super_admin) then
    raise exception 'A super admin cannot be removed here';
  end if;
  delete from public.admin_page_permissions where user_id = target;
  update public.profiles
  set role = case
    when exists (select 1 from public.providers where user_id = target and verification = 'approved')
      then 'provider'::public.user_role
    else 'user'::public.user_role
  end
  where id = target and role = 'admin';
end
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare initial_admin boolean;
begin
  select exists (
    select 1 from public.admin_bootstrap_emails where email = lower(new.email)
  ) into initial_admin;
  insert into public.profiles (id, first_name, last_name, gender, country, date_of_birth, role, is_super_admin)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'first_name', split_part(coalesce(new.raw_user_meta_data->>'full_name',''),' ',1)),
    new.raw_user_meta_data->>'last_name',
    new.raw_user_meta_data->>'gender',
    new.raw_user_meta_data->>'country',
    nullif(new.raw_user_meta_data->>'date_of_birth','')::date,
    case when initial_admin then 'admin'::public.user_role else 'user'::public.user_role end,
    initial_admin
  ) on conflict do nothing;
  return new;
end
$$;

update public.profiles p
set role = 'admin', is_super_admin = true
from auth.users u
where u.id = p.id and lower(u.email) = 'youngsterpaul254@gmail.com';

insert into public.admin_page_permissions(user_id, page_key, can_view, can_manage)
select p.id, page_key, true, true
from public.profiles p
cross join unnest(array[
  'listings','providers','trips','vehicles','destinations','payouts','countries','cities',
  'regions','airports','dropoffs','host_ids','fees','legal','settings'
]) as pages(page_key)
where p.role = 'admin' and not p.is_super_admin
on conflict (user_id, page_key) do nothing;

create or replace function public.protect_profile_fields()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if public.admin_can_manage('providers') and old.role <> 'admin' then
      new.role := case when new.role = 'provider' then 'provider'::public.user_role else old.role end;
      new.first_name := old.first_name; new.last_name := old.last_name; new.gender := old.gender;
      new.country := old.country; new.date_of_birth := old.date_of_birth; new.phone := old.phone;
      new.avatar_url := old.avatar_url; new.language := old.language; new.created_at := old.created_at;
    else
      new.role := old.role;
      new.is_bnb_verified := old.is_bnb_verified;
    end if;
    new.is_super_admin := old.is_super_admin;
    new.balance := old.balance;
    new.subscription_until := old.subscription_until;
  end if;
  return new;
end
$$;

create or replace function public.enforce_listing_rules()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare p public.providers; o public.profiles;
begin
  select * into p from public.providers where id = new.provider_id;
  select * into o from public.profiles where id = new.owner_id;
  if p.user_id <> new.owner_id then raise exception 'Provider mismatch'; end if;
  if not public.admin_can_manage('listings') then
    if p.verification <> 'approved' then raise exception 'Your provider registration is not verified yet'; end if;
    if new.category in ('hotel','campsite','attraction','guide') and p.category <> new.category then raise exception 'Your registration is for %, not %', p.category, new.category; end if;
    if new.category in ('hotel','campsite','attraction','guide') and (p.tra_number is null or p.registration_number is null or p.registration_document_url is null) then
      raise exception 'TRA number, registration number and registration document are required for %', new.category; end if;
    if new.category in ('airbnb','activity','event') and not o.is_bnb_verified then raise exception 'Only verified hosts can list %', new.category; end if;
  end if;
  new.updated_at := now();
  return new;
end
$$;

create or replace function public.lock_listing_core()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.admin_can_manage('listings') then
    if old.verified_once and (
      new.category is distinct from old.category
      or new.location_name is distinct from old.location_name
      or new.lat is distinct from old.lat
      or new.lng is distinct from old.lng
      or new.google_place_id is distinct from old.google_place_id
    ) then
      raise exception 'Category and location cannot be changed after the listing was verified';
    end if;
    if new.provider_id <> old.provider_id or new.owner_id <> old.owner_id then raise exception 'Owner cannot change'; end if;
    new.verified_once := old.verified_once;
    if new.status = 'approved' and (old.status not in ('approved','hidden') or not old.verified_once) then
      raise exception 'Only admin can approve a listing';
    end if;
  elsif public.admin_can_manage('listings') and new.status = 'approved' then
    new.verified_once := true;
  end if;
  return new;
end
$$;

create or replace function public.resolve_booking_no_show(p_booking uuid, p_resolution text, p_note text default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare b public.bookings; host_user uuid;
begin
  if not public.admin_can_manage('trips') then raise exception 'Not allowed'; end if;
  if p_resolution is null or p_resolution not in ('refund_guest','pay_host') then raise exception 'Choose a valid no-show outcome'; end if;
  select * into b from public.bookings where id = p_booking for update;
  if b.id is null or b.no_show_resolution is distinct from 'pending' then raise exception 'No pending no-show review exists'; end if;
  if b.payment_status <> 'paid' then raise exception 'Booking payment has already changed'; end if;
  select owner_id into host_user from public.listings where id = b.listing_id;
  if p_resolution = 'refund_guest' then
    update public.profiles set balance = balance + b.total where id = b.user_id;
    update public.bookings set payment_status = 'refunded', no_show_resolution = 'refund_guest',
      no_show_reviewed_at = now(), no_show_admin_note = nullif(trim(p_note), '') where id = b.id;
    insert into public.notifications(user_id,title,body,data) values
      (b.user_id,'No-show review resolved','Admin confirmed a refund. The booking total was added to your account balance.',jsonb_build_object('type','booking_no_show_resolved','booking_id',b.id,'resolution',p_resolution)),
      (host_user,'No-show review resolved','Admin contacted the guest and confirmed a refund to their account balance.',jsonb_build_object('type','booking_no_show_resolved','booking_id',b.id,'resolution',p_resolution));
  else
    update public.bookings set status = 'completed', no_show_resolution = 'pay_host',
      no_show_reviewed_at = now(), no_show_admin_note = nullif(trim(p_note), '') where id = b.id;
    insert into public.notifications(user_id,title,body,data) values
      (b.user_id,'No-show review resolved','Admin contacted you and confirmed that the booking earnings will be released to the host.',jsonb_build_object('type','booking_no_show_resolved','booking_id',b.id,'resolution',p_resolution)),
      (host_user,'No-show review resolved','Admin contacted the guest and confirmed the booking earnings will be included in your host balance.',jsonb_build_object('type','booking_no_show_resolved','booking_id',b.id,'resolution',p_resolution));
  end if;
end
$$;

create or replace function public.admin_provider_identity_status(p_user uuid)
returns text
language plpgsql stable security definer
set search_path = public
as $$
declare result text;
begin
  if not public.admin_can_manage('providers') then raise exception 'Provider management permission required'; end if;
  select status::text into result from public.host_verifications where user_id = p_user;
  return result;
end
$$;

create or replace function public.admin_publish_legal(p_kind text, p_url text, p_content text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.admin_can_manage('legal') then raise exception 'Legal document management permission required'; end if;
  if p_kind not in ('terms','privacy') then raise exception 'Invalid legal document'; end if;
  if nullif(trim(coalesce(p_url,'')), '') is null and nullif(trim(coalesce(p_content,'')), '') is null then
    raise exception 'Add the page address or the text first';
  end if;
  update public.legal_documents
  set url = nullif(trim(coalesce(p_url,'')), ''),
      content = nullif(trim(coalesce(p_content,'')), ''),
      published = true,
      version = version + 1
  where kind = p_kind;
  if not found then raise exception 'Legal document was not found'; end if;
end
$$;

revoke all on function public.admin_can_view(text), public.admin_can_manage(text),
  public.admin_current_access(), public.admin_list_users(),
  public.admin_set_user_access(text,jsonb), public.admin_remove_user_access(text),
  public.admin_provider_identity_status(uuid), public.admin_publish_legal(text,text,text)
from public, anon;
grant execute on function public.admin_can_view(text), public.admin_can_manage(text),
  public.admin_current_access(), public.admin_list_users(),
  public.admin_set_user_access(text,jsonb), public.admin_remove_user_access(text),
  public.admin_provider_identity_status(uuid), public.admin_publish_legal(text,text,text)
to authenticated;
grant execute on function public.is_admin() to authenticated;

do $$
declare existing_policy record;
begin
  for existing_policy in
    select * from (values
      ('settings_page_manage', 'app_settings'),
      ('profiles_admin_listing_read', 'profiles'),
      ('profiles_admin_provider_read', 'profiles'),
      ('profiles_admin_trip_read', 'profiles'),
      ('profiles_provider_admin_update', 'profiles'),
      ('providers_admin_page_read', 'providers'),
      ('providers_admin_page_manage', 'providers'),
      ('listings_admin_page_read', 'listings'),
      ('listings_admin_page_update', 'listings'),
      ('listings_admin_page_delete', 'listings'),
      ('listing_contacts_admin_read', 'listing_contacts'),
      ('listing_prices_admin_read', 'listing_prices'),
      ('vehicles_admin_page_read', 'vehicles'),
      ('vehicles_admin_page_manage', 'vehicles'),
      ('destinations_admin_page_read', 'destinations'),
      ('destinations_admin_page_manage', 'destinations'),
      ('bookings_admin_trip_read', 'bookings'),
      ('bookings_admin_trip_update', 'bookings'),
      ('bookings_admin_dropoffs_read', 'bookings'),
      ('booking_items_admin_trip_read', 'booking_items'),
      ('custom_trips_admin_page_read', 'custom_trip_requests'),
      ('custom_trips_admin_page_update', 'custom_trip_requests'),
      ('messages_admin_trip_read', 'messages'),
      ('payment_methods_admin_page_read', 'payment_methods'),
      ('payment_methods_admin_page_manage', 'payment_methods'),
      ('countries_admin_page_read', 'countries'),
      ('countries_admin_page_manage', 'countries'),
      ('country_divisions_admin_page_read', 'country_divisions'),
      ('country_divisions_admin_page_manage', 'country_divisions'),
      ('cities_admin_page_read', 'cities'),
      ('cities_admin_page_manage', 'cities'),
      ('airports_admin_page_read', 'airports'),
      ('airports_admin_page_manage', 'airports'),
      ('dropoffs_admin_page_read', 'booking_dropoffs'),
      ('host_ids_admin_page_read', 'host_verifications'),
      ('host_ids_admin_page_manage', 'host_verifications'),
      ('fees_admin_page_read', 'category_fees'),
      ('fees_admin_page_manage', 'category_fees'),
      ('legal_admin_page_read', 'legal_documents')
    ) as policies(policy_name, table_name)
  loop
    execute format('drop policy if exists %I on public.%I', existing_policy.policy_name, existing_policy.table_name);
  end loop;

  execute 'drop policy if exists destination_images_admin_page_manage on storage.objects';
  execute 'drop policy if exists provider_docs_admin_page_read on storage.objects';
  execute 'drop policy if exists host_ids_files_admin_page_read on storage.objects';
end
$$;

create policy settings_page_manage on public.app_settings for update to authenticated
  using (public.admin_can_manage('settings')) with check (public.admin_can_manage('settings'));
create policy profiles_admin_listing_read on public.profiles for select to authenticated using (
  public.admin_can_view('listings') and exists (select 1 from public.listings l where l.owner_id = profiles.id)
);
create policy profiles_admin_provider_read on public.profiles for select to authenticated using (
  public.admin_can_view('providers') and exists (select 1 from public.providers p where p.user_id = profiles.id)
);
create policy profiles_admin_trip_read on public.profiles for select to authenticated using (
  public.admin_can_view('trips') and (
    exists (select 1 from public.bookings b where b.user_id = profiles.id)
    or exists (select 1 from public.listings l where l.owner_id = profiles.id)
  )
);
create policy profiles_provider_admin_update on public.profiles for update to authenticated
  using (public.admin_can_manage('providers') and role <> 'admin' and exists (select 1 from public.providers p where p.user_id = profiles.id))
  with check (public.admin_can_manage('providers') and role in ('user','provider') and exists (select 1 from public.providers p where p.user_id = profiles.id));

create policy providers_admin_page_read on public.providers for select to authenticated
  using (public.admin_can_view('providers') or public.admin_can_view('listings')
    or (public.admin_can_view('trips') and exists (
      select 1 from public.listings l join public.bookings b on b.listing_id = l.id
      where l.provider_id = providers.id and b.no_show_resolution = 'pending'
    )));
create policy providers_admin_page_manage on public.providers for update to authenticated
  using (public.admin_can_manage('providers')) with check (public.admin_can_manage('providers'));
create policy listings_admin_page_read on public.listings for select to authenticated
  using (public.admin_can_view('listings') or (public.admin_can_view('trips') and exists (
    select 1 from public.bookings b where b.listing_id = listings.id and b.no_show_resolution = 'pending'
  )) or (public.admin_can_view('dropoffs') and exists (
    select 1 from public.bookings b join public.booking_dropoffs d on d.booking_id = b.id
    where b.listing_id = listings.id
  )));
create policy listings_admin_page_update on public.listings for update to authenticated
  using (public.admin_can_manage('listings')) with check (public.admin_can_manage('listings'));
create policy listings_admin_page_delete on public.listings for delete to authenticated
  using (public.admin_can_manage('listings'));
create policy listing_contacts_admin_read on public.listing_contacts for select to authenticated
  using (public.admin_can_view('listings') and exists (select 1 from public.listings l where l.id = listing_id));
create policy listing_prices_admin_read on public.listing_prices for select to authenticated
  using (public.admin_can_view('listings') and exists (select 1 from public.listings l where l.id = listing_id));

create policy vehicles_admin_page_read on public.vehicles for select to authenticated using (public.admin_can_view('vehicles'));
create policy vehicles_admin_page_manage on public.vehicles for all to authenticated
  using (public.admin_can_manage('vehicles')) with check (public.admin_can_manage('vehicles'));
create policy destinations_admin_page_read on public.destinations for select to authenticated using (public.admin_can_view('destinations'));
create policy destinations_admin_page_manage on public.destinations for all to authenticated
  using (public.admin_can_manage('destinations')) with check (public.admin_can_manage('destinations'));
create policy bookings_admin_trip_read on public.bookings for select to authenticated using (public.admin_can_view('trips'));
create policy bookings_admin_trip_update on public.bookings for update to authenticated
  using (public.admin_can_manage('trips')) with check (public.admin_can_manage('trips'));
create policy bookings_admin_dropoffs_read on public.bookings for select to authenticated
  using (public.admin_can_view('dropoffs') and exists (select 1 from public.booking_dropoffs d where d.booking_id = bookings.id));
create policy booking_items_admin_trip_read on public.booking_items for select to authenticated
  using (public.admin_can_view('trips') and exists (select 1 from public.bookings b where b.id = booking_id));
create policy custom_trips_admin_page_read on public.custom_trip_requests for select to authenticated
  using (public.admin_can_view('trips'));
create policy custom_trips_admin_page_update on public.custom_trip_requests for update to authenticated
  using (public.admin_can_manage('trips')) with check (public.admin_can_manage('trips'));
create policy messages_admin_trip_read on public.messages for select to authenticated using (public.admin_can_view('trips'));
create policy payment_methods_admin_page_read on public.payment_methods for select to authenticated using (public.admin_can_view('payouts'));
create policy payment_methods_admin_page_manage on public.payment_methods for all to authenticated
  using (public.admin_can_manage('payouts')) with check (public.admin_can_manage('payouts'));
create policy countries_admin_page_read on public.countries for select to authenticated using (public.admin_can_view('countries'));
create policy countries_admin_page_manage on public.countries for all to authenticated
  using (public.admin_can_manage('countries')) with check (public.admin_can_manage('countries'));

alter table public.country_divisions enable row level security;
alter table public.cities enable row level security;
alter table public.airports enable row level security;
alter table public.booking_dropoffs enable row level security;
alter table public.host_verifications enable row level security;
alter table public.category_fees enable row level security;
alter table public.legal_documents enable row level security;

create policy country_divisions_admin_page_read on public.country_divisions for select to authenticated using (public.admin_can_view('regions'));
create policy country_divisions_admin_page_manage on public.country_divisions for all to authenticated
  using (public.admin_can_manage('regions')) with check (public.admin_can_manage('regions'));
create policy cities_admin_page_read on public.cities for select to authenticated using (public.admin_can_view('cities'));
create policy cities_admin_page_manage on public.cities for all to authenticated
  using (public.admin_can_manage('cities')) with check (public.admin_can_manage('cities'));
create policy airports_admin_page_read on public.airports for select to authenticated using (public.admin_can_view('airports'));
create policy airports_admin_page_manage on public.airports for all to authenticated
  using (public.admin_can_manage('airports')) with check (public.admin_can_manage('airports'));
create policy dropoffs_admin_page_read on public.booking_dropoffs for select to authenticated using (public.admin_can_view('dropoffs'));
create policy host_ids_admin_page_read on public.host_verifications for select to authenticated using (public.admin_can_view('host_ids'));
create policy host_ids_admin_page_manage on public.host_verifications for update to authenticated
  using (public.admin_can_manage('host_ids')) with check (public.admin_can_manage('host_ids'));
create policy fees_admin_page_read on public.category_fees for select to authenticated using (public.admin_can_view('fees'));
create policy fees_admin_page_manage on public.category_fees for update to authenticated
  using (public.admin_can_manage('fees')) with check (public.admin_can_manage('fees'));
create policy legal_admin_page_read on public.legal_documents for select to authenticated using (public.admin_can_view('legal'));

create policy destination_images_admin_page_manage on storage.objects for all to authenticated
  using (bucket_id = 'destination-images' and public.admin_can_manage('destinations'))
  with check (bucket_id = 'destination-images' and public.admin_can_manage('destinations'));
create policy provider_docs_admin_page_read on storage.objects for select to authenticated
  using (bucket_id = 'provider-docs' and (
    public.admin_can_view('providers') or public.admin_can_view('listings') or public.admin_can_view('host_ids')
  ));
create policy host_ids_files_admin_page_read on storage.objects for select to authenticated
  using (bucket_id = 'host-verification' and public.admin_can_view('host_ids'));

notify pgrst, 'reload schema';
commit;
