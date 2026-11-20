-- Run once in Supabase SQL Editor to allow resort listings.
alter type public.listing_category add value if not exists 'resort';
