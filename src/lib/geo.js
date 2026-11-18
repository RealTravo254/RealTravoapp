import * as Location from 'expo-location';
import { Alert, Linking, Platform } from 'react-native';
import { CONFIG } from './config';

export const haversineKm = (a, b) => {
  const R = 6371, rad = (x) => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
export function decodePolyline(str) {
  let i = 0, lat = 0, lng = 0; const out = [];
  while (i < str.length) {
    for (const k of [0, 1]) {
      let shift = 0, result = 0, b;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 31) << shift; shift += 5; } while (b >= 32);
      const d = (result & 1) ? ~(result >> 1) : (result >> 1);
      if (k === 0) lat += d; else lng += d;
    }
    out.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return out;
}

// Real road routes (every bend). Uses Google Directions when a key is set; otherwise (or if Google refuses) the free OpenStreetMap road router.
async function googleRoute(from, to, mode, key) {
  const u = `https://maps.googleapis.com/maps/api/directions/json?origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}&mode=${mode}&key=${key}`;
  const r = await fetch(u).then((x) => x.json());
  const route = r.routes?.[0]; if (!route) throw new Error(r.error_message || r.status || 'No route found');
  const leg = route.legs[0];
  return { coords: decodePolyline(route.overview_polyline.points), distanceText: leg.distance.text, km: leg.distance.value / 1000, durationText: leg.duration.text, source: 'google',
    steps: leg.steps.map((s) => ({ text: s.html_instructions.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), dist: s.distance.text })) };
}
const OSRM = { driving: 'routed-car', transit: 'routed-car', walking: 'routed-foot', bicycling: 'routed-bike' };
const VERB = { turn: 'Turn', depart: 'Head', arrive: 'Arrive', continue: 'Continue', 'new name': 'Continue', merge: 'Merge', roundabout: 'At the roundabout', rotary: 'At the roundabout', 'end of road': 'Turn', fork: 'Keep', 'on ramp': 'Take the ramp', 'off ramp': 'Take the exit' };
async function osmRoute(from, to, mode) {
  const u = `https://routing.openstreetmap.de/${OSRM[mode] || 'routed-car'}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=polyline&steps=true`;
  const j = await fetch(u).then((x) => x.json());
  const r = j.routes?.[0]; if (!r) throw new Error(j.message || j.code || 'No route found');
  const mins = Math.round(r.duration / 60);
  return { coords: decodePolyline(r.geometry), km: r.distance / 1000, distanceText: `${(r.distance / 1000).toFixed(1)} km`, durationText: mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`, source: 'openstreetmap',
    steps: (r.legs?.[0]?.steps || []).map((s) => { const m = s.maneuver || {}; return { text: `${VERB[m.type] || 'Continue'}${m.modifier ? ' ' + m.modifier : ''}${s.name ? ' onto ' + s.name : ''}`, dist: s.distance >= 1000 ? `${(s.distance / 1000).toFixed(1)} km` : `${Math.round(s.distance)} m` }; }) };
}
export async function getRoute(from, to, mode = 'driving') {
  const key = CONFIG.googleKey;
  if (key && !String(key).startsWith('YOUR_')) { try { return await googleRoute(from, to, mode, key); } catch (e) { /* fall through to the free router */ } }
  return osmRoute(from, to, mode);
}
export async function getDistanceKm(from, to) {
  try { const r = await getRoute(from, to, 'driving'); return { km: Math.round(r.km * 10) / 10, durationText: r.durationText, source: 'route' }; }
  catch (e) { return { km: Math.round(haversineKm(from, to) * 1.3 * 10) / 10, durationText: null, source: 'estimate' }; }
}

// Safe "where am I": never throws. Asks for permission, asks Android to switch location on, falls back to the last known position.
export async function getPosition({ silent = false } = {}) {
  try {
    let { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') { if (silent) return null; ({ status } = await Location.requestForegroundPermissionsAsync()); }
    if (status !== 'granted') { if (!silent) Alert.alert('Location needed', 'Allow location for this app in your phone settings, or choose the place on the map.'); return null; }
    if (!(await Location.hasServicesEnabledAsync())) { try { await Location.enableNetworkProviderAsync(); } catch (e) {} }
    try {
      const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      return { lat: p.coords.latitude, lng: p.coords.longitude };
    } catch (e) {
      const last = await Location.getLastKnownPositionAsync();
      if (last) return { lat: last.coords.latitude, lng: last.coords.longitude };
      throw e;
    }
  } catch (e) {
    if (!silent) Alert.alert('Location is off', 'Turn on location (GPS) on your phone, or choose the place on the map.', [{ text: 'Cancel', style: 'cancel' },
      { text: 'Open settings', onPress: () => (Platform.OS === 'android' ? Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS').catch(() => Linking.openSettings()) : Linking.openSettings()) }]);
    return null;
  }
}
// Address text and region names for a point
export async function reverseInfo(lat, lng) {
  const fallback = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  try {
    const r = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng }); const a = r[0] || {};
    const label = [a.name, a.street, a.city || a.subregion, a.region].filter(Boolean).filter((x, i, arr) => arr.indexOf(x) === i).join(', ');
    return { label: label || fallback, parts: [a.region, a.subregion, a.city, a.district].filter(Boolean), country: a.country || null };
  } catch (e) { return { label: fallback, parts: [], country: null }; }
}
// Pick the admin-set region that matches the geocoded names
export const matchRegion = (parts, regions) => {
  const low = parts.map((p) => p.toLowerCase());
  return regions.find((r) => low.some((p) => p.includes(r.toLowerCase()) || r.toLowerCase().includes(p))) || null;
};
