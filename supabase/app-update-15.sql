-- Allow providers to publish multiple listings in the same category.
drop index if exists public.one_listing_per_provider;
create index if not exists listings_provider_category_active_idx
  on public.listings(provider_id, category) where deleted_at is null;

-- Permit company/activity hosts to publish guided tours while retaining registration checks.
create or replace function public.enforce_listing_rules()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare p public.providers; o public.profiles;
begin
  select * into p from public.providers where id = new.provider_id;
  select * into o from public.profiles where id = new.owner_id;
  if new.category = 'attraction' then raise exception 'Attraction listings are no longer available'; end if;
  if p.user_id <> new.owner_id then raise exception 'Provider mismatch'; end if;
  if not public.admin_can_manage('listings') then
    if p.verification <> 'approved' then raise exception 'Your provider registration is not verified yet'; end if;
    if new.category = 'event' and p.category = 'airbnb' then raise exception 'Airbnb hosts cannot list events'; end if;
    if new.category in ('hotel','resort') and p.category <> 'hotel' then raise exception 'Your registration is for %, not %', p.category, new.category; end if;
    if new.category = 'campsite' and p.category <> new.category then raise exception 'Your registration is for %, not %', p.category, new.category; end if;
    if new.category = 'guide' and p.category not in ('activity','guide') then raise exception 'Your registration is for %, not %', p.category, new.category; end if;
    if new.category in ('hotel','resort','campsite') and (p.tra_number is null or p.registration_number is null or p.registration_document_url is null) then
      raise exception 'TRA number, registration number and registration document are required for %', new.category; end if;
    if new.category = 'guide' and p.category = 'guide' and (p.tra_number is null or p.registration_number is null or p.registration_document_url is null) then
      raise exception 'TRA number, registration number and registration document are required for %', new.category; end if;
    if new.category = 'guide' and p.category = 'activity' and (p.registration_number is null or p.registration_document_url is null) then
      raise exception 'A business registration number and document are required for guided tours'; end if;
    if new.category in ('airbnb','activity','guide') and not o.is_bnb_verified then raise exception 'Only verified hosts can list %', new.category; end if;
  end if;
  new.updated_at := now();
  return new;
end
$$;

-- Keep categories fixed after approval, but allow hosts to correct a listing's location.
create or replace function public.lock_listing_core()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.admin_can_manage('listings') then
    if old.verified_once and new.category is distinct from old.category then
      raise exception 'Category cannot be changed after the listing was verified';
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

-- Cast CASE branches to the enum so PostgreSQL accepts visibility changes.
create or replace function public.set_listing_visibility(p_listing uuid, p_visible boolean)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  update public.listings
  set status = case when p_visible then 'approved'::public.review_status else 'hidden'::public.review_status end
  where id = p_listing and owner_id = auth.uid() and status in ('approved','hidden');
end
$$;

notify pgrst, 'reload schema';
