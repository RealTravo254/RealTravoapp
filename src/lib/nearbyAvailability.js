import { supabase } from './supabase';
import { ymd } from './pricing';

export async function nearbyAvailableListings({ listing, categories, date, guests, page, pageSize, group }) {
  const firstPageCount = (page + 1) * pageSize + 1;
  let limit = Math.max(firstPageCount, pageSize * 2);
  let listings = [];
  const available = [];
  const checked = new Set();

  while (true) {
    const { data, error } = await supabase.rpc('nearby_listings', {
      p_lat: listing.lat,
      p_lng: listing.lng,
      p_radius_km: 40,
      p_exclude: listing.category,
      p_categories: categories.filter((category) => category !== listing.category),
      lim: limit,
    });
    if (error) throw error;

    listings = data || [];
    const newListings = listings.filter((item) => !checked.has(item.id));
    newListings.forEach((item) => checked.add(item.id));

    if (newListings.length) {
      const { data: metadata, error: metadataError } = await supabase
        .from('listings')
        .select('id,event_date,schedule_type,accommodation_available')
        .in('id', newListings.map((item) => item.id));
      if (metadataError) throw metadataError;
      let facilityListingIds = null;
      if (group === 'facilities') {
        const { data: prices, error: pricesError } = await supabase
          .from('listing_prices')
          .select('listing_id')
          .in('listing_id', newListings.map((item) => item.id))
          .in('kind', ['facility', 'activity']);
        if (pricesError) throw pricesError;
        facilityListingIds = new Set((prices || []).map((price) => price.listing_id));
      }
      const metadataById = new Map((metadata || []).map((item) => [item.id, item]));
      const candidates = newListings
        .filter((item) => metadataById.has(item.id))
        .map((item) => ({ ...item, ...metadataById.get(item.id) }));
      const eligible = candidates.filter((item) => {
        const isStay = ['hotel', 'resort', 'campsite', 'airbnb'].includes(item.category) || item.accommodation_available;
        if (group === 'stay' && !isStay) return false;
        if (group === 'facilities' && !facilityListingIds.has(item.id)) return false;

        const eventDate = item.event_date ? ymd(new Date(item.event_date)) : null;
        return !((item.category === 'event' || item.schedule_type === 'one_time') && eventDate && eventDate !== date);
      });

      for (let index = 0; index < eligible.length; index += 20) {
        const capacityResults = await Promise.all(eligible.slice(index, index + 20).map(async (item) => {
          const { data: left, error: availabilityError } = await supabase.rpc('get_availability', {
            p_listing: item.id,
            p_start: date,
            p_end: date,
          });
          if (availabilityError) throw availabilityError;
          return typeof left !== 'number' || left >= guests ? item : null;
        }));
        available.push(...capacityResults.filter(Boolean));
      }
    }

    if (available.length >= firstPageCount || listings.length < limit) break;
    limit *= 2;
  }

  const start = page * pageSize;
  return {
    listings: available.slice(start, start + pageSize),
    hasMore: available.length > start + pageSize,
  };
}
