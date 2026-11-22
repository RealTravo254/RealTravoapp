begin;

alter table public.app_settings
  add column if not exists host_payout_delay_hours int not null default 24,
  add column if not exists host_payout_tracking_started_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'app_settings_host_payout_delay_hours_check'
      and conrelid = 'public.app_settings'::regclass
  ) then
    alter table public.app_settings
      add constraint app_settings_host_payout_delay_hours_check
      check (host_payout_delay_hours between 24 and 48);
  end if;
end
$$;

alter table public.bookings
  add column if not exists trip_completed_at timestamptz;

create or replace function public.set_trip_completed_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'completed' then
      new.trip_completed_at := coalesce(new.trip_completed_at, now());
    end if;
  elsif new.status = 'completed' and old.status is distinct from 'completed' then
    new.trip_completed_at := now();
  else
    new.trip_completed_at := old.trip_completed_at;
  end if;
  return new;
end
$$;

drop trigger if exists bookings_set_trip_completed_at on public.bookings;
create trigger bookings_set_trip_completed_at
before insert or update on public.bookings
for each row execute function public.set_trip_completed_at();

create table if not exists public.host_payout_batches (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'pending' check (status in ('pending','paid')),
  country text,
  category text,
  search_query text,
  date_from date,
  date_to date,
  booking_count int not null default 0,
  total_amount numeric not null default 0,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  paid_by uuid references public.profiles(id),
  paid_at timestamptz
);

create table if not exists public.host_payout_batch_items (
  batch_id uuid not null references public.host_payout_batches(id) on delete cascade,
  booking_id uuid not null unique references public.bookings(id),
  host_id uuid not null references public.profiles(id),
  host_name text,
  country text,
  host_category text,
  listing_category text,
  listing_title text,
  scheduled_date date not null,
  start_time time,
  gross_amount numeric not null,
  platform_fee numeric not null,
  net_amount numeric not null check (net_amount >= 0),
  primary key (batch_id, booking_id)
);

alter table public.host_payout_batches enable row level security;
alter table public.host_payout_batch_items enable row level security;
revoke all on public.host_payout_batches, public.host_payout_batch_items from public, anon, authenticated;

alter table public.admin_page_permissions
  drop constraint if exists admin_page_permissions_page_key_check;
alter table public.admin_page_permissions
  add constraint admin_page_permissions_page_key_check
  check (page_key in (
    'listings','providers','trips','vehicles','destinations','payouts','countries','cities',
    'regions','airports','dropoffs','host_ids','fees','legal','settings','host_balances'
  ));

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
      'regions','airports','dropoffs','host_ids','fees','legal','settings','host_balances'
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

create or replace function public.admin_host_balances_page(
  p_country text default null,
  p_category text default null,
  p_search text default null,
  p_limit int default 11,
  p_offset int default 0
)
returns table (
  host_id uuid,
  name text,
  gross numeric,
  platform_fee numeric,
  net numeric,
  paid_out numeric,
  balance numeric,
  country text,
  category text,
  business_name text,
  oldest_pending_date date
)
language plpgsql stable security definer
set search_path = public, auth
as $$
begin
  if not public.admin_can_view('host_balances') then raise exception 'Host payout access required'; end if;
  if p_limit < 1 or p_limit > 100 or p_offset < 0 then raise exception 'Invalid pagination'; end if;
  return query
  with provider_meta as (
    select distinct on (pr.user_id)
      pr.user_id, pr.country, pr.category::text as category, pr.business_name
    from public.providers pr
    order by pr.user_id, (pr.verification = 'approved') desc, pr.created_at desc
  ),
  booking_totals as (
    select l.owner_id as host_id,
      coalesce(sum(b.total) filter (where b.payment_status = 'paid' and b.status in ('accepted','completed')), 0)::numeric as gross,
      coalesce(sum(b.commission) filter (where b.payment_status = 'paid' and b.status in ('accepted','completed')), 0)::numeric as platform_fee
    from public.listings l
    join public.bookings b on b.listing_id = l.id
    group by l.owner_id
  ),
  payout_totals as (
    select payout_rows.host_id, sum(payout_rows.amount)::numeric as paid_out
    from (
      select hp.host_id, hp.amount
      from public.host_payouts hp
      union all
      select i.host_id, sum(i.net_amount) as amount
      from public.host_payout_batch_items i
      join public.host_payout_batches pb on pb.id = i.batch_id
      where pb.status = 'paid'
      group by i.host_id
    ) payout_rows
    group by payout_rows.host_id
  ),
  oldest_pending as (
    select l.owner_id as host_id, min(coalesce(b.end_date, b.start_date)) as oldest_pending_date
    from public.bookings b
    join public.listings l on l.id = b.listing_id
    cross join public.app_settings s
    where b.payment_status = 'paid'
      and b.status in ('accepted','completed')
      and coalesce(b.end_date, b.start_date) >= s.host_payout_tracking_started_at::date
      and not exists (
        select 1
        from public.host_payout_batch_items i
        join public.host_payout_batches pb on pb.id = i.batch_id
        where i.booking_id = b.id and pb.status = 'paid'
      )
    group by l.owner_id
  ),
  host_rows as (
    select p.id as host_id,
      coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), pm.business_name, 'Host') as name,
      coalesce(bt.gross, 0)::numeric as gross,
      coalesce(bt.platform_fee, 0)::numeric as platform_fee,
      (coalesce(bt.gross, 0) - coalesce(bt.platform_fee, 0))::numeric as net,
      coalesce(pt.paid_out, 0)::numeric as paid_out,
      greatest(coalesce(bt.gross, 0) - coalesce(bt.platform_fee, 0) - coalesce(pt.paid_out, 0), 0)::numeric as balance,
      coalesce(pm.country, p.country, '')::text as country,
      coalesce(pm.category, '')::text as category,
      coalesce(pm.business_name, '')::text as business_name,
      op.oldest_pending_date,
      u.email
    from public.profiles p
    left join provider_meta pm on pm.user_id = p.id
    left join booking_totals bt on bt.host_id = p.id
    left join payout_totals pt on pt.host_id = p.id
    left join oldest_pending op on op.host_id = p.id
    left join auth.users u on u.id = p.id
    where pm.user_id is not null or bt.host_id is not null or pt.host_id is not null
  )
  select h.host_id, h.name, h.gross, h.platform_fee, h.net, h.paid_out, h.balance,
    h.country, h.category, h.business_name, h.oldest_pending_date
  from host_rows h
  where (nullif(trim(p_country), '') is null or lower(h.country) = lower(trim(p_country)))
    and (nullif(trim(p_category), '') is null or lower(h.category) = lower(trim(p_category)))
    and (nullif(trim(p_search), '') is null or
      concat_ws(' ', h.name, h.business_name, h.email, h.host_id::text) ilike '%' || trim(p_search) || '%')
  order by h.oldest_pending_date asc nulls last, h.name
  limit p_limit offset p_offset;
end
$$;

create or replace function public.admin_payout_queue(
  p_country text default null,
  p_category text default null,
  p_search text default null,
  p_from date default null,
  p_to date default null,
  p_limit int default 11,
  p_offset int default 0
)
returns table (
  booking_id uuid,
  host_id uuid,
  host_name text,
  country text,
  host_category text,
  listing_category text,
  listing_title text,
  scheduled_date date,
  start_time time,
  booking_status text,
  net_amount numeric,
  eligible_at timestamptz,
  payout_state text
)
language plpgsql stable security definer
set search_path = public, auth
as $$
begin
  if not public.admin_can_view('host_balances') then raise exception 'Host payout access required'; end if;
  if p_limit < 1 or p_limit > 100 or p_offset < 0 then raise exception 'Invalid pagination'; end if;
  return query
  with provider_meta as (
    select distinct on (pr.user_id)
      pr.user_id, pr.country, pr.category::text as category, pr.business_name
    from public.providers pr
    order by pr.user_id, (pr.verification = 'approved') desc, pr.created_at desc
  ),
  queue_rows as (
    select b.id as booking_id, l.owner_id as host_id,
      coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), pm.business_name, 'Host') as host_name,
      coalesce(pm.country, p.country, l.country, '')::text as country,
      coalesce(pm.category, '')::text as host_category,
      l.category::text as listing_category,
      l.title as listing_title,
      coalesce(b.end_date, b.start_date) as scheduled_date,
      b.start_time,
      b.status::text as booking_status,
      greatest(b.total - b.commission, 0)::numeric as net_amount,
      coalesce(b.trip_completed_at, (coalesce(b.end_date, b.start_date) + 1)::timestamptz)
        + make_interval(hours => s.host_payout_delay_hours) as eligible_at,
      p.first_name, p.last_name, pm.business_name, u.email
    from public.bookings b
    join public.listings l on l.id = b.listing_id
    join public.profiles p on p.id = l.owner_id
    left join provider_meta pm on pm.user_id = p.id
    left join auth.users u on u.id = p.id
    cross join public.app_settings s
    where b.payment_status = 'paid'
      and b.status in ('accepted','completed')
      and coalesce(b.end_date, b.start_date) >= s.host_payout_tracking_started_at::date
      and (nullif(trim(p_country), '') is null or lower(coalesce(pm.country, p.country, l.country, '')) = lower(trim(p_country)))
      and (nullif(trim(p_category), '') is null or lower(coalesce(pm.category, '')) = lower(trim(p_category)))
      and (p_from is null or coalesce(b.end_date, b.start_date) >= p_from)
      and (p_to is null or coalesce(b.end_date, b.start_date) <= p_to)
      and (nullif(trim(p_search), '') is null or
        concat_ws(' ', p.first_name, p.last_name, pm.business_name, u.email, p.id::text) ilike '%' || trim(p_search) || '%')
      and not exists (select 1 from public.host_payout_batch_items i where i.booking_id = b.id)
  )
  select q.booking_id, q.host_id, q.host_name, q.country, q.host_category, q.listing_category,
    q.listing_title, q.scheduled_date, q.start_time, q.booking_status, q.net_amount, q.eligible_at,
    case when q.booking_status <> 'completed' then 'scheduled'
      when now() >= q.eligible_at then 'eligible' else 'waiting' end::text as payout_state
  from queue_rows q
  order by q.scheduled_date asc, q.start_time asc nulls first, q.booking_id
  limit p_limit offset p_offset;
end
$$;

create or replace function public.admin_get_payout_batch(p_batch uuid)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  batch_data jsonb;
  item_data jsonb;
begin
  if not public.admin_can_view('host_balances') then raise exception 'Host payout access required'; end if;
  select to_jsonb(pb) into batch_data from public.host_payout_batches pb where pb.id = p_batch;
  if batch_data is null then raise exception 'Payout batch not found'; end if;
  select coalesce(jsonb_agg(to_jsonb(i) - 'batch_id' order by i.scheduled_date, i.start_time nulls first), '[]'::jsonb)
    into item_data from public.host_payout_batch_items i where i.batch_id = p_batch;
  return jsonb_build_object('batch', batch_data, 'items', item_data);
end
$$;

create or replace function public.admin_create_payout_batch(
  p_country text default null,
  p_category text default null,
  p_search text default null,
  p_from date default null,
  p_to date default null
)
returns jsonb
language plpgsql security definer
set search_path = public, auth
as $$
declare
  v_batch_id uuid;
  inserted_count int;
begin
  if not public.admin_can_manage('host_balances') then raise exception 'Host payout management permission required'; end if;
  if p_from is not null and p_to is not null and p_from > p_to then raise exception 'Start date must be before end date'; end if;
  insert into public.host_payout_batches(country, category, search_query, date_from, date_to, created_by)
  values (nullif(trim(p_country), ''), nullif(trim(p_category), ''), nullif(trim(p_search), ''), p_from, p_to, auth.uid())
  returning id into v_batch_id;

  with provider_meta as (
    select distinct on (pr.user_id)
      pr.user_id, pr.country, pr.category::text as category, pr.business_name
    from public.providers pr
    order by pr.user_id, (pr.verification = 'approved') desc, pr.created_at desc
  )
  insert into public.host_payout_batch_items(
    batch_id, booking_id, host_id, host_name, country, host_category,
    listing_category, listing_title, scheduled_date, start_time,
    gross_amount, platform_fee, net_amount
  )
  select v_batch_id, b.id, l.owner_id,
    coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), pm.business_name, 'Host'),
    coalesce(pm.country, p.country, l.country, ''),
    coalesce(pm.category, ''),
    l.category::text, l.title, coalesce(b.end_date, b.start_date), b.start_time,
    b.total, b.commission, greatest(b.total - b.commission, 0)
  from public.bookings b
  join public.listings l on l.id = b.listing_id
  join public.profiles p on p.id = l.owner_id
  left join provider_meta pm on pm.user_id = p.id
  left join auth.users u on u.id = p.id
  cross join public.app_settings s
  where b.payment_status = 'paid'
    and b.status = 'completed'
    and coalesce(b.end_date, b.start_date) >= s.host_payout_tracking_started_at::date
    and now() >= coalesce(b.trip_completed_at, (coalesce(b.end_date, b.start_date) + 1)::timestamptz)
      + make_interval(hours => s.host_payout_delay_hours)
    and (nullif(trim(p_country), '') is null or lower(coalesce(pm.country, p.country, l.country, '')) = lower(trim(p_country)))
    and (nullif(trim(p_category), '') is null or lower(coalesce(pm.category, '')) = lower(trim(p_category)))
    and (p_from is null or coalesce(b.end_date, b.start_date) >= p_from)
    and (p_to is null or coalesce(b.end_date, b.start_date) <= p_to)
    and (nullif(trim(p_search), '') is null or
      concat_ws(' ', p.first_name, p.last_name, pm.business_name, u.email, p.id::text) ilike '%' || trim(p_search) || '%')
    and greatest(b.total - b.commission, 0) > 0
    and not exists (select 1 from public.host_payout_batch_items i where i.booking_id = b.id)
  order by coalesce(b.end_date, b.start_date), b.start_time nulls first, b.id
  limit 100;

  get diagnostics inserted_count = row_count;
  if inserted_count = 0 then
    delete from public.host_payout_batches where id = v_batch_id;
    raise exception 'No completed, eligible bookings match these filters';
  end if;
  update public.host_payout_batches pb
  set booking_count = inserted_count,
      total_amount = (select sum(i.net_amount) from public.host_payout_batch_items i where i.batch_id = v_batch_id)
  where pb.id = v_batch_id;
  return public.admin_get_payout_batch(v_batch_id);
end
$$;

create or replace function public.admin_mark_payout_batch_paid(p_batch uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  payout_batch public.host_payout_batches;
  delay_hours int;
begin
  if not public.admin_can_manage('host_balances') then raise exception 'Host payout management permission required'; end if;
  select * into payout_batch from public.host_payout_batches where id = p_batch for update;
  if payout_batch.id is null then raise exception 'Payout batch not found'; end if;
  if payout_batch.status <> 'pending' then raise exception 'This payout batch is already paid'; end if;
  perform b.id
  from public.bookings b
  join public.host_payout_batch_items i on i.booking_id = b.id
  where i.batch_id = p_batch
  for update of b;
  select host_payout_delay_hours into delay_hours from public.app_settings where id = 1;
  if exists (
    select 1
    from public.host_payout_batch_items i
    join public.bookings b on b.id = i.booking_id
    where i.batch_id = p_batch
      and (b.payment_status <> 'paid' or b.status <> 'completed'
        or now() < coalesce(b.trip_completed_at, (coalesce(b.end_date, b.start_date) + 1)::timestamptz)
          + make_interval(hours => delay_hours))
  ) then
    raise exception 'A booking in this batch is no longer eligible for payout';
  end if;
  update public.host_payout_batches
  set status = 'paid', paid_by = auth.uid(), paid_at = now()
  where id = p_batch;
end
$$;

create or replace function public.admin_list_payout_batches(p_limit int default 11, p_offset int default 0)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare batches jsonb;
begin
  if not public.admin_can_view('host_balances') then raise exception 'Host payout access required'; end if;
  if p_limit < 1 or p_limit > 100 or p_offset < 0 then raise exception 'Invalid pagination'; end if;
  select coalesce(jsonb_agg(to_jsonb(page_rows) order by page_rows.created_at desc), '[]'::jsonb)
  into batches
  from (
    select pb.*
    from public.host_payout_batches pb
    order by pb.created_at desc
    limit p_limit offset p_offset
  ) page_rows;
  return batches;
end
$$;

create or replace function public.admin_set_host_payout_delay(p_hours int)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.admin_can_manage('host_balances') then raise exception 'Host payout management permission required'; end if;
  if p_hours is null or p_hours < 24 or p_hours > 48 then raise exception 'Payout delay must be between 24 and 48 hours'; end if;
  update public.app_settings set host_payout_delay_hours = p_hours where id = 1;
end
$$;

create or replace function public.wallet_finance_overview()
returns jsonb
language plpgsql stable security definer
set search_path = public, auth
as $$
declare
  current_profile public.profiles;
  result jsonb;
  gross_total numeric;
  fee_total numeric;
  net_total numeric;
  payouts_total numeric;
begin
  if auth.uid() is null then raise exception 'Sign in to view your wallet'; end if;
  select * into current_profile from public.profiles where id = auth.uid();
  if current_profile.id is null then raise exception 'Profile not found'; end if;

  if current_profile.role = 'provider' or exists (select 1 from public.providers where user_id = auth.uid()) then
    select coalesce(sum(b.total), 0), coalesce(sum(b.commission), 0)
      into gross_total, fee_total
    from public.bookings b
    join public.listings l on l.id = b.listing_id
    where l.owner_id = auth.uid()
      and b.payment_status = 'paid'
      and b.status in ('accepted','completed');
    select coalesce(sum(hp.amount), 0) into payouts_total
      from public.host_payouts hp where hp.host_id = auth.uid();
    payouts_total := payouts_total + coalesce((
      select sum(i.net_amount)
      from public.host_payout_batch_items i
      join public.host_payout_batches pb on pb.id = i.batch_id
      where i.host_id = auth.uid() and pb.status = 'paid'
    ), 0);
    net_total := gross_total - fee_total;
    select jsonb_build_object(
      'role', 'host',
      'balance', greatest(net_total - payouts_total, 0),
      'gross', gross_total,
      'platform_fee', fee_total,
      'net', net_total,
      'paid_out', payouts_total,
      'pending_trip_net', coalesce((
        select sum(greatest(b.total - b.commission, 0))
        from public.bookings b join public.listings l on l.id = b.listing_id
        cross join public.app_settings s
        where l.owner_id = auth.uid() and b.payment_status = 'paid'
          and (b.status = 'accepted' or (b.status = 'completed' and now() < coalesce(
            b.trip_completed_at, (coalesce(b.end_date, b.start_date) + 1)::timestamptz
          ) + make_interval(hours => s.host_payout_delay_hours)))
      ), 0),
      'categories', coalesce((
        select jsonb_agg(jsonb_build_object('category', totals.category, 'gross', totals.gross, 'net', totals.net, 'booking_count', totals.booking_count))
        from (
          select l.category::text as category, sum(b.total)::numeric as gross,
            sum(greatest(b.total - b.commission, 0))::numeric as net, count(*)::int as booking_count
          from public.bookings b join public.listings l on l.id = b.listing_id
          where l.owner_id = auth.uid() and b.payment_status = 'paid' and b.status in ('accepted','completed')
          group by l.category
        ) totals
      ), '[]'::jsonb),
      'recent_bookings', coalesce((
        select jsonb_agg(to_jsonb(recent) order by recent.created_at desc)
        from (
          select b.id, b.created_at, b.start_date, b.end_date, b.status, b.payment_status, b.total, b.commission,
            l.title, l.category::text as category
          from public.bookings b join public.listings l on l.id = b.listing_id
          where l.owner_id = auth.uid()
          order by b.created_at desc limit 10
        ) recent
      ), '[]'::jsonb),
      'recent_payouts', coalesce((
        select jsonb_agg(to_jsonb(recent) order by recent.created_at desc)
        from (
          select sum(i.net_amount)::numeric as amount, 'Payout batch ' || pb.id::text as note,
            pb.paid_at as created_at
          from public.host_payout_batches pb
          join public.host_payout_batch_items i on i.batch_id = pb.id
          where pb.status = 'paid' and i.host_id = auth.uid()
          group by pb.id, pb.paid_at
          order by pb.paid_at desc limit 10
        ) recent
      ), '[]'::jsonb)
    ) into result;
  else
    select jsonb_build_object(
      'role', 'traveller',
      'balance', current_profile.balance,
      'spent', coalesce(sum(b.total) filter (where b.payment_status = 'paid'), 0),
      'pending_payment', coalesce(sum(b.total) filter (where b.payment_status = 'unpaid' and b.status in ('pending','accepted')), 0),
      'refunded', coalesce(sum(b.total) filter (where b.payment_status = 'refunded'), 0),
      'booking_count', count(*)::int,
      'paid_count', count(*) filter (where b.payment_status = 'paid')::int,
      'recent_bookings', coalesce((
        select jsonb_agg(to_jsonb(recent) order by recent.created_at desc)
        from (
          select b.id, b.created_at, b.start_date, b.end_date, b.status, b.payment_status, b.total,
            l.title, l.category::text as category
          from public.bookings b left join public.listings l on l.id = b.listing_id
          where b.user_id = auth.uid()
          order by b.created_at desc limit 10
        ) recent
      ), '[]'::jsonb)
    ) into result
    from public.bookings b where b.user_id = auth.uid();
  end if;
  return result;
end
$$;

revoke all on function public.admin_host_balances_page(text,text,text,int,int),
  public.admin_payout_queue(text,text,text,date,date,int,int), public.admin_get_payout_batch(uuid),
  public.admin_create_payout_batch(text,text,text,date,date), public.admin_mark_payout_batch_paid(uuid),
  public.admin_list_payout_batches(int,int), public.admin_set_host_payout_delay(int),
  public.wallet_finance_overview() from public, anon;
grant execute on function public.admin_host_balances_page(text,text,text,int,int),
  public.admin_payout_queue(text,text,text,date,date,int,int), public.admin_get_payout_batch(uuid),
  public.admin_create_payout_batch(text,text,text,date,date), public.admin_mark_payout_batch_paid(uuid),
  public.admin_list_payout_batches(int,int), public.admin_set_host_payout_delay(int),
  public.wallet_finance_overview() to authenticated;

notify pgrst, 'reload schema';
commit;
