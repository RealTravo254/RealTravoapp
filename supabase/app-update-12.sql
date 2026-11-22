begin;

create or replace function public.admin_can_view_listing(p_listing uuid)
returns boolean
language sql stable security definer
set search_path = public, auth
as $$
  select public.admin_can_view('listings')
    or (public.admin_can_view('trips') and exists (
      select 1 from public.bookings b
      where b.listing_id = p_listing and b.no_show_resolution = 'pending'
    ))
    or (public.admin_can_view('dropoffs') and exists (
      select 1 from public.bookings b
      join public.booking_dropoffs d on d.booking_id = b.id
      where b.listing_id = p_listing
    ))
$$;

create or replace function public.admin_can_view_provider(p_provider uuid)
returns boolean
language sql stable security definer
set search_path = public, auth
as $$
  select public.admin_can_view('providers')
    or (public.admin_can_view('listings') and exists (
      select 1 from public.listings l where l.provider_id = p_provider
    ))
    or (public.admin_can_view('trips') and exists (
      select 1 from public.listings l
      join public.bookings b on b.listing_id = l.id
      where l.provider_id = p_provider and b.no_show_resolution = 'pending'
    ))
    or (public.admin_can_view('dropoffs') and exists (
      select 1 from public.listings l
      join public.bookings b on b.listing_id = l.id
      join public.booking_dropoffs d on d.booking_id = b.id
      where l.provider_id = p_provider
    ))
$$;

revoke all on function public.admin_can_view_listing(uuid), public.admin_can_view_provider(uuid) from public, anon;
grant execute on function public.admin_can_view_listing(uuid), public.admin_can_view_provider(uuid) to authenticated;

drop policy if exists listings_admin_page_read on public.listings;
create policy listings_admin_page_read on public.listings for select to authenticated
  using (public.admin_can_view_listing(id));

drop policy if exists providers_admin_page_read on public.providers;
create policy providers_admin_page_read on public.providers for select to authenticated
  using (public.admin_can_view_provider(id));

notify pgrst, 'reload schema';
commit;
