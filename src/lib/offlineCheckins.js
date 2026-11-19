import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

const cacheKey = (userId) => `checkin-cache:${userId}`;
const queueKey = (userId) => `checkin-queue:${userId}`;
const CHECKIN_CATEGORIES = ['hotel', 'campsite', 'event', 'attraction'];

const readJson = async (key, fallback) => {
  const raw = await AsyncStorage.getItem(key);
  return raw ? JSON.parse(raw) : fallback;
};

export async function readCheckinCache(userId) {
  return readJson(cacheKey(userId), []);
}

export async function pendingCheckinCount(userId) {
  const queue = await readJson(queueKey(userId), []);
  return queue.length;
}

export async function refreshCheckinCache(userId) {
  const { data: listings, error: listingsError } = await supabase
    .from('listings')
    .select('id')
    .eq('owner_id', userId);
  if (listingsError) throw listingsError;

  const listingIds = (listings || []).map((listing) => listing.id);
  if (!listingIds.length) {
    await AsyncStorage.setItem(cacheKey(userId), '[]');
    return [];
  }

  const { data, error } = await supabase
    .from('bookings')
    .select('id,qr_token,status,payment_status,checked_in_at,start_date,end_date,start_time,guests,total,listing_id,booking_items(id,label,quantity,unit_price,amount),listings!inner(id,title,category,owner_id)')
    .in('listing_id', listingIds)
    .in('status', ['accepted', 'completed'])
    .eq('payment_status', 'paid')
    .is('checked_in_at', null)
    .order('start_date')
    .order('id');
  if (error) throw error;

  const bookings = (data || []).filter((booking) => CHECKIN_CATEGORIES.includes(booking.listings?.category));
  await AsyncStorage.setItem(cacheKey(userId), JSON.stringify(bookings));
  return bookings;
}

export async function markCheckinUsed(userId, token, queueForSync = false) {
  const bookings = await readCheckinCache(userId);
  const booking = bookings.find((item) => item.qr_token === token);
  if (!booking) return null;

  const queue = await readJson(queueKey(userId), []);
  const nextQueue = queueForSync && !queue.some((item) => item.token === token)
    ? [...queue, { token, bookingId: booking.id, scannedAt: new Date().toISOString() }]
    : queue;
  await AsyncStorage.multiSet([
    [cacheKey(userId), JSON.stringify(bookings.filter((item) => item.qr_token !== token))],
    [queueKey(userId), JSON.stringify(nextQueue)],
  ]);
  return booking;
}

export async function syncPendingCheckins(userId) {
  const queue = await readJson(queueKey(userId), []);
  let remaining = [...queue];
  for (const item of queue) {
    const { error } = await supabase.rpc('scan_qr', { p_token: item.token });
    if (error && !String(error.message).toLowerCase().includes('already checked in')) throw error;
    remaining = remaining.filter((queued) => queued.token !== item.token);
    await AsyncStorage.setItem(queueKey(userId), JSON.stringify(remaining));
  }
  if (queue.length) await refreshCheckinCache(userId);
  return remaining.length;
}

export const isNetworkError = (error) => /network|fetch failed|failed to fetch|timeout|timed out|offline/i
  .test(String(error?.message || error || ''));
