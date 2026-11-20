import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Text, Alert, View, TouchableOpacity } from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { Btn, Card, Input, Label, Muted, Chip, Stepper, Loader } from '../components/ui';
import CountryPicker from '../components/CountryPicker';
import DateField from '../components/DateField';
import TimeField from '../components/TimeField';
import PhoneField from '../components/PhoneField';
import RoutePreview from '../components/RoutePreview';
import Img from '../components/Img';
import { pickLocation } from '../lib/pickBus';
import { getPosition, reverseInfo } from '../lib/geo';
import { ymd, scheduleProblem, transferPrice } from '../lib/pricing';
import { addDays } from '../lib/schedule';
import { startPayment } from '../lib/payments';
import { isValidContactPhone } from '../lib/phone';
import { C } from '../lib/theme';

const GAP = 30; // minutes between two activities
const PAGE_SIZE = 8;
const STAY = ['hotel', 'resort', 'campsite', 'airbnb'];

// Remove rows that share the same id, so React never sees two children with the same key.
const uniq = (arr) => { const seen = new Set(); return (arr || []).filter((r) => r && !seen.has(r.id) && seen.add(r.id)); };

// Every category a guest can add to a trip. "all" shows everything in the chosen place.
const ALL_CATS = ['hotel', 'resort', 'campsite', 'attraction', 'airbnb', 'activity', 'guide'];
const CATS = {
  all: { label: '🌍 All', cats: ALL_CATS },
  stay: { label: '🛏️ Accommodation', cats: ['hotel', 'resort', 'campsite', 'attraction', 'airbnb'], stay: true },
  hotel: { label: '🏨 Hotels & resorts', cats: ['hotel', 'resort'] },
  campsite: { label: '🏕️ Campsites', cats: ['campsite'] },
  airbnb: { label: '🏠 Airbnb', cats: ['airbnb'] },
  resort: { label: '🌴 Resorts', cats: ['resort'] },
  attraction: { label: '🏞️ Attractions', cats: ['attraction'] },
  activity: { label: '🎯 Activities', cats: ['activity'] },
  guide: { label: '🧭 Guides', cats: ['guide'] },
  tour: { label: '🚌 Tours & trips', cats: ['activity', 'guide'], tour: true },
};
const CAT_BADGE = {
  hotel: '🏨 Hotel', resort: '🌴 Resort', campsite: '🏕️ Campsite', airbnb: '🏠 Airbnb',
  attraction: '🏞️ Attraction', activity: '🎯 Activity', guide: '🧭 Guide',
};
// The price rows that make up the "main" price of each category
const MAIN_KINDS = {
  resort: ['room'], attraction: ['entrance'],
  activity: ['activity', 'ticket'], guide: ['guide'],
};
const STEPS = ['Where', 'Choose', 'Pickup', 'Pay'];
const ts = (d, t) => new Date(`${d}T${t}:00`).getTime() / 60000;
const isStay = (c) => !!c.stay;
const blk = (c) => { const s = ts(c.date, c.time); return { label: `“${c.l.title}”`, s, e: isStay(c) ? s + c.nights * 1440 - 180 : s + (c.info?.duration_minutes || 120) }; };
const priceQuantity = (p, adults, children, childPriceSelected) => {
  if (p.unit === 'per_group') return 1;
  if (p.audience === 'child') return children;
  return childPriceSelected ? adults : adults + children;
};
const hasChildPrice = (c, p) => {
  const options = c.options?.some((x) => x.id === p.id) ? c.options
    : c.extras?.some((x) => x.id === p.id) ? c.extras : c.items;
  return options.some((x) => x.audience === 'child');
};
const lineTotal = (c, adults, children) => {
  return c.items.reduce((s, p) => s + Number(p.price) * priceQuantity(p, adults, children, hasChildPrice(c, p)) * (['per_night', 'per_day'].includes(p.unit) ? c.nights : 1), 0);
};
const mainPrices = (category, prices, stay = STAY.includes(category)) => {
  const all = uniq(prices);
  const pool = all.filter((p) => (stay ? p.kind === 'room' : (MAIN_KINDS[category] || []).includes(p.kind)));
  return (pool.length ? pool : all).slice().sort((a, b) => Number(a.price) - Number(b.price));
};
const cardFrom = (x) => {
  const stay = STAY.includes(x.category) || !!x.accommodation_available;
  const prices = mainPrices(x.category, x.listing_prices, stay);
  const adult = prices.find((p) => p.audience !== 'child');
  return adult ? Number(adult.price) : prices.length ? Number(prices[0].price) : null;
};
const UNIT_TXT = { per_night: ' / night', per_person: ' / person', per_group: ' / group', per_day: ' / day' };

// Same-kind items may not overlap: no two stays at the same time, no two activities at the same time.
function clashes(list) {
  const out = [];
  [[true, 0], [false, GAP]].forEach(([stay, gap]) => {
    const b = list.filter((c) => isStay(c) === stay).map(blk).sort((a, c) => a.s - c.s);
    let prev = null;
    b.forEach((x) => {
      if (prev && x.s < prev.e + gap) out.push(stay ? `${prev.label} and ${x.label} overlap. You cannot book two stays at the same time.` : `${prev.label} and ${x.label} are too close. Leave ${GAP} minutes between activities.`);
      if (!prev || x.e > prev.e) prev = x;
    });
  });
  return out;
}

export default function CustomTrip({ navigation }) {
  const { session, profile, formatMoney } = useAuth();
  const scrollRef = useRef(null); const listY = useRef(0); const reqId = useRef(0); const keyRef = useRef('');
  const [step, setStep] = useState(0); const [busy, setBusy] = useState(false); const [feePct, setFeePct] = useState(20);
  // 1 where
  const [country, setCountry] = useState(''); const [region, setRegion] = useState(''); const [regions, setRegions] = useState([]); const [mine, setMine] = useState(null);
  // 2 choose
  const [adults, setAdults] = useState(2); const [children, setChildren] = useState(0); const people = adults + children;
  const [days, setDays] = useState(3); const [start, setStart] = useState(new Date(Date.now() + 86400000));
  const [cat, setCat] = useState('all'); const [list, setList] = useState(null); const [listError, setListError] = useState(''); const [total, setTotal] = useState(0); const [page, setPage] = useState(0); const [chosen, setChosen] = useState({}); const [reload, setReload] = useState(0);
  const [stayAvailability, setStayAvailability] = useState(null);
  // 3 pickup
  const [mode, setMode] = useState('none'); // none | oneway | return
  const [pickup, setPickup] = useState(null); const [pickupTime, setPickupTime] = useState('08:00'); const [vehicles, setVehicles] = useState([]); const [vid, setVid] = useState(null); const [km, setKm] = useState(null);
  const [pickupDate, setPickupDate] = useState(null); const [returnDate, setReturnDate] = useState(null); const [returnTime, setReturnTime] = useState('17:00'); const [returnKm, setReturnKm] = useState(null);
  const [contactPhone, setContactPhone] = useState('');

  const startDay = ymd(start); const endDay = addDays(startDay, days - 1);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  useEffect(() => {
    supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle().then(({ data }) => { if (data) { setMine({ country: data.country, region: data.region || data.city }); if (data.country) setCountry((c) => c || data.country); } });
    supabase.from('vehicles').select('*').eq('active', true).order('max_passengers').order('id').then(({ data }) => setVehicles(uniq(data)));
    supabase.from('app_settings').select('custom_cancel_fee_percent').eq('id', 1).maybeSingle().then(({ data }) => data && setFeePct(Number(data.custom_cancel_fee_percent ?? 20)));
  }, []);
  useEffect(() => { if (!contactPhone && profile?.phone) setContactPhone(profile.phone); }, [profile?.phone]);

  useEffect(() => { setRegion(''); if (!country) return setRegions([]);
    supabase.from('country_divisions').select('id,name, countries!inner(name)').eq('countries.name', country).eq('active', true).order('name').order('id').then(({ data }) => setRegions(uniq(data))); }, [country]);

  // load one page of listings (filters change -> back to page 1)
  useEffect(() => {
    if (step !== 1) return;
    const key = [cat, country, region].join('|');
    if (keyRef.current !== key) { keyRef.current = key; if (page !== 0) { setPage(0); return; } }
    const id = ++reqId.current; setList(null); setListError('');
    const g = CATS[cat];
    let q = supabase.from('listings')
      .select('id,title,category,region,country,location_name,lat,lng,photos,facilities,accommodation_available,rating_avg,rating_count,entrance_fee_free,schedule_type,listing_prices(id,kind,label,price,unit,audience,is_optional)', { count: 'exact' })
      .eq('status', 'approved').is('deleted_at', null).in('category', g.cats);
    if (g.tour) q = q.eq('schedule_type', 'tour');
    if (g.stay) q = q.or('category.in.(hotel,resort,campsite,airbnb),accommodation_available.eq.true');
    if (country) q = q.eq('country', country);
    if (region) q = q.eq('region', region);
    // "id" is the tie-breaker so listings with the same title keep a stable order between pages
    q.order('title').order('id').range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1).then(({ data, count, error }) => {
      if (id !== reqId.current) return; // an older request finished late
      if (error) { setList([]); setTotal(0); setListError(error.message); return; }
      setList(uniq(data)); setTotal(count || 0);
    });
  }, [step, cat, country, region, page, reload]);

  useEffect(() => {
    if (step !== 1 || list === null) return undefined;
    const stays = list.filter((x) => STAY.includes(x.category) || x.accommodation_available);
    if (!stays.length) { setStayAvailability({}); return undefined; }
    let active = true;
    setStayAvailability(null);
    Promise.all(stays.map(async (x) => {
      const { data, error } = await supabase.rpc('get_availability', { p_listing: x.id, p_start: startDay, p_end: endDay });
      if (error) throw error;
      return [x.id, typeof data !== 'number' || data >= people];
    })).then((entries) => { if (active) setStayAvailability(Object.fromEntries(entries)); })
      .catch((error) => { if (active) { setListError(error.message); setStayAvailability({}); } });
    return () => { active = false; };
  }, [step, list, startDay, endDay, people]);

  const goPage = (n) => { setPage(n); scrollRef.current?.scrollTo({ y: Math.max(0, listY.current - 8), animated: true }); };

  const items = Object.values(chosen).sort((a, b) => ts(a.date, a.time) - ts(b.date, b.time));
  const visibleList = list && stayAvailability
    ? list.filter((x) => !(STAY.includes(x.category) || x.accommodation_available) || stayAvailability[x.id] !== false)
    : list;
  const first = items[0]; const last = items[items.length - 1];
  const pickupDay = ymd(pickupDate || start);
  const returnDay = returnDate ? ymd(returnDate) : endDay;
  const isReturn = mode === 'return';
  const v = vehicles.find((x) => x.id === vid && x.max_passengers >= people);
  const returnPrice = isReturn && v && returnKm != null ? transferPrice(v, returnKm) : 0;
  const tprice = mode !== 'none' && v && km != null ? transferPrice(v, km) + returnPrice : 0;
  const itemsTotal = items.reduce((s, c) => s + lineTotal(c, adults, children), 0);
  const grand = itemsTotal + tprice;
  const clash = useMemo(() => clashes(items), [chosen]);
  useEffect(() => { setKm(null); setReturnKm(null); }, [mode, pickup?.lat, pickup?.lng, first?.l.id, last?.l.id]);
  useEffect(() => {
    if (pickupDate && (ymd(pickupDate) < startDay || ymd(pickupDate) > endDay)) setPickupDate(null);
    if (returnDate && (ymd(returnDate) < startDay || ymd(returnDate) > endDay)) setReturnDate(null);
  }, [startDay, endDay, pickupDate, returnDate]);

  const toggle = async (x) => {
    if (chosen[x.id]) return setChosen(({ [x.id]: _, ...r }) => r);
    const [{ data: pr }, { data: info }] = await Promise.all([
      supabase.from('listing_prices').select('*').eq('listing_id', x.id),
      supabase.from('listings').select('id,title,category,opening_hours,event_date,schedule_type,starts_on,ends_on,open_time,duration_minutes').eq('id', x.id).single()]);
    const stay = STAY.includes(x.category) || !!x.accommodation_available;
    const options = mainPrices(x.category, pr, stay);
    const required = options.filter((p) => !p.is_optional);
    const adultOption = options.find((p) => p.audience !== 'child');
    const childOption = children > 0 ? options.find((p) => p.audience === 'child') : null;
    const picked = required.length ? required : [adultOption, childOption].filter(Boolean);
    if (!picked.length && options.length) picked.push(options[0]);
    const extras = (pr || []).filter((p) => p.is_optional && ['facility', 'activity'].includes(p.kind));
    const fixedDate = info?.schedule_type === 'one_time' && info.event_date ? new Date(info.event_date) : null;
    let slot = fixedDate ? { date: ymd(fixedDate), time: `${String(fixedDate.getHours()).padStart(2, '0')}:${String(fixedDate.getMinutes()).padStart(2, '0')}` } : { date: startDay, time: stay ? '14:00' : '09:00' };
    if (!fixedDate) { // find the first free slot inside the trip dates
      outer: for (let d = 0; d < days; d++) for (let h = stay ? 14 : 8; h <= (stay ? 14 : 17); h++) {
        const cand = { l: x, info, items: picked, stay, date: addDays(startDay, d), time: `${String(h).padStart(2, '0')}:00`, nights: 1 };
        if (!clashes([...Object.values(chosen), cand]).length) { slot = { date: cand.date, time: cand.time }; break outer; }
      }
    }
    setChosen((c) => ({ ...c, [x.id]: { l: x, info, options, extras, items: picked, stay, date: slot.date, time: slot.time, nights: 1, fixed: !!fixedDate } }));
  };
  const setField = (id, patch) => setChosen((c) => ({ ...c, [id]: { ...c[id], ...patch } }));
  const pickPrice = (id, p) => setChosen((current) => {
    const item = current[id];
    if (!item) return current;
    const main = item.options.some((x) => x.id === p.id);
    if (!main) {
      const selected = item.items.some((x) => x.id === p.id);
      return { ...current, [id]: { ...item, items: selected ? item.items.filter((x) => x.id !== p.id) : [...item.items, p] } };
    }
    const items = item.stay
      ? [...item.items.filter((x) => !item.options.some((o) => o.id === x.id)), p]
      : [...item.items.filter((x) => !item.options.some((o) => o.id === x.id) || (x.audience === 'child') !== (p.audience === 'child')), p];
    return { ...current, [id]: { ...item, items } };
  });

  const problems = [...clash];
  items.forEach((c) => {
    const p = c.info ? scheduleProblem(c.info, c.date, c.time) : null; if (p) problems.push(`${c.l.title}: ${p}`);
    if (c.date < startDay || c.date > endDay) problems.push(`${c.l.title}: choose a date between ${startDay} and ${endDay}.`);
    if (isStay(c) && addDays(c.date, c.nights) > addDays(endDay, 1)) problems.push(`${c.l.title}: the stay goes past the end of your trip.`);
  });
  const pickupProblems = [];
  if (mode !== 'none') {
    if (!pickup) pickupProblems.push('Choose your pickup place.');
    if (!v) pickupProblems.push('Choose a vehicle that fits your group.');
    if (pickup && v && km == null) pickupProblems.push('Calculating the route, please wait.');
    if (first && (first.l.lat == null || first.l.lng == null)) pickupProblems.push('The first place in your trip needs a map location to calculate pickup transport.');
    if (pickupDay < startDay || pickupDay > endDay) pickupProblems.push('Choose a pickup date within your trip dates.');
    if (first && ts(pickupDay, pickupTime) >= ts(first.date, first.time)) pickupProblems.push('Pickup must be before your first booking starts.');
    if (new Date(`${pickupDay}T${pickupTime}:00`).getTime() < Date.now() + 3600000) pickupProblems.push('Pickup must be at least 1 hour from now.');
    if (isReturn) {
      if (!last || last.l.lat == null || last.l.lng == null) pickupProblems.push('The last place in your trip needs a map location to calculate return transport.');
      if (last && ts(returnDay, returnTime) < blk(last).e) pickupProblems.push('Return pickup must be after your last booking ends.');
      if (last && pickup && v && returnKm == null) pickupProblems.push('Calculating the return route, please wait.');
      if (new Date(`${returnDay}T${returnTime}:00`).getTime() < Date.now() + 3600000) pickupProblems.push('Return pickup must be at least 1 hour from now.');
    }
  }

  const next = () => {
    if (step === 0 && !country) return Alert.alert('Where do you want to go?', 'Pick a country to find available places.');
    if (step === 1) {
      if (!isValidContactPhone(contactPhone)) return Alert.alert('Phone number', 'Enter a valid phone number to continue.');
      if (!items.length) return Alert.alert('Add at least one stay, tour or activity');
      if (problems.length) return Alert.alert('Please check', problems.join('\n'));
    }
    if (step === 2 && pickupProblems.length) return Alert.alert('Pickup', pickupProblems.join('\n'));
    setStep(step + 1);
  };

  const useMine = async () => { const p = await getPosition(); if (!p) return; const i = await reverseInfo(p.lat, p.lng); setPickup({ lat: p.lat, lng: p.lng, label: i.label }); };
  const onMap = async () => { const r = await pickLocation(navigation, 'Choose your pickup location'); if (r) setPickup(r); };

  const pay = async () => {
    if (!isValidContactPhone(contactPhone)) return Alert.alert('Phone number', 'Enter a valid phone number to continue.');
    if (problems.length || pickupProblems.length) return Alert.alert('Please check', [...problems, ...pickupProblems].join('\n'));
    setBusy(true); let pkgId = null;
    try {
      for (const c of items) {
        const { data: left, error: availabilityError } = await supabase.rpc('get_availability', { p_listing: c.l.id, p_start: c.date, p_end: isStay(c) ? addDays(c.date, c.nights - 1) : c.date });
        if (availabilityError) throw availabilityError;
        if (typeof left === 'number' && left < people) throw new Error(`${c.l.title} has only ${left} places left for that date.`);
      }
      const pickAt = mode !== 'none' ? new Date(`${pickupDay}T${pickupTime}:00`).toISOString() : null;
      const r = await supabase.from('trip_packages').insert({ user_id: session.user.id, is_custom: true, people, adults, children, start_date: startDay, end_date: endDay, trip_type: mode === 'none' ? null : mode,
        pickup_location: pickup?.label || null, pickup_lat: pickup?.lat || null, pickup_lng: pickup?.lng || null, pickup_time: pickAt,
        dropoff_location: isReturn ? pickup?.label || null : null, dropoff_lat: isReturn ? pickup?.lat || null : null, dropoff_lng: isReturn ? pickup?.lng || null : null,
        return_date: isReturn ? returnDay : null, return_time: isReturn ? returnTime + ':00' : null,
        contact_phone: contactPhone, vehicle_id: mode !== 'none' ? v.id : null,
        pickup_people: mode !== 'none' ? people : null, distance_km: mode !== 'none' ? km : null, transfer_price: tprice, total: grand }).select().single();
      if (r.error) throw r.error; pkgId = r.data.id;
      for (const c of items) {
        const total = lineTotal(c, adults, children); const stay = isStay(c);
        const b = await supabase.from('bookings').insert({ user_id: session.user.id, listing_id: c.l.id, package_id: pkgId, guests: people, start_date: c.date, end_date: stay ? addDays(c.date, c.nights - 1) : c.date,
          adults, children, nights: stay ? c.nights : 1, start_time: c.time + ':00', contact_phone: contactPhone, trip_type: mode === 'none' ? null : mode,
          pickup_location: pickup?.label || null, pickup_lat: pickup?.lat || null, pickup_lng: pickup?.lng || null, pickup_time: mode !== 'none' ? pickupTime + ':00' : null,
          return_date: isReturn ? returnDay : null, return_time: isReturn ? returnTime + ':00' : null, subtotal: total, total }).select().single();
        if (b.error) throw b.error;
        if (c.items.length) {
          const bi = await supabase.from('booking_items').insert(c.items.map((p) => {
            const quantity = priceQuantity(p, adults, children, hasChildPrice(c, p));
            return { booking_id: b.data.id, price_id: p.id, label: p.label, quantity, unit_price: p.price,
              amount: Number(p.price) * quantity * (['per_night', 'per_day'].includes(p.unit) ? c.nights : 1) };
          }));
          if (bi.error) throw bi.error;
        }
      }
      const p = await startPayment({ purpose: 'package', packageId: pkgId });
      navigation.replace('Pay', { url: p.authorization_url });
    } catch (e) {
      if (pkgId) { await supabase.from('bookings').delete().eq('package_id', pkgId); await supabase.from('trip_packages').delete().eq('id', pkgId); }
      Alert.alert('Could not book', e.message);
    } finally { setBusy(false); }
  };

  const optLabel = (p) => `${p.label && p.label !== p.kind ? p.label : p.audience}${p.label && p.label !== p.kind ? ` · ${p.audience}` : ''} · ${Number(p.price) === 0 ? 'Free' : formatMoney(p.price)}${UNIT_TXT[p.unit] || ''}`;

  return (
    <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" style={{ backgroundColor: '#F6F7F5' }}>
      <View style={{ backgroundColor: C.primary, padding: 18, paddingTop: 22, paddingBottom: 26, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 }}>
        <Text style={{ color: '#fff', fontSize: 24, fontWeight: '800' }}>Plan your trip</Text>
        <Text style={{ color: '#fff', opacity: 0.85, marginTop: 4 }}>Choose your days, accommodation, tours and activities. Leave any day free if you like.</Text>
        <View style={{ flexDirection: 'row', marginTop: 16 }}>
          {STEPS.map((s, i) => (<View key={s} style={{ flex: 1, alignItems: 'center' }}>
            <View style={{ height: 4, alignSelf: 'stretch', borderRadius: 2, marginHorizontal: 3, backgroundColor: i <= step ? '#fff' : 'rgba(255,255,255,0.3)' }} />
            <Text style={{ color: '#fff', fontSize: 11, marginTop: 4, fontWeight: i === step ? '800' : '400', opacity: i <= step ? 1 : 0.6 }}>{i + 1}. {s}</Text></View>))}
        </View>
      </View>

      <View style={{ padding: 12 }}>
        {/* ---------------- STEP 1: WHERE ---------------- */}
        {step === 0 && <>
          <Text style={{ fontSize: 18, fontWeight: '800', marginTop: 8 }}>Where do you want to go?</Text>
          {mine?.country ? <Card onPress={() => { setCountry(mine.country); if (mine.region) setRegion(mine.region); }} style={{ marginHorizontal: 0, backgroundColor: '#EAF3EE' }}>
            <Text style={{ fontWeight: '800' }}>⭐ Suggested for you</Text><Muted>{mine.region ? `${mine.region}, ` : ''}{mine.country} (from your profile). Tap to use.</Muted></Card> : null}
          <Label>Country</Label><CountryPicker value={country} onChange={setCountry} />
          {regions.length > 0 && <><Label>Region (optional)</Label>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              <View style={{ marginBottom: 6 }}><Chip label="All regions" active={!region} onPress={() => setRegion('')} /></View>
              {regions.map((r) => <View key={r.id} style={{ marginBottom: 6 }}><Chip label={r.name} active={region === r.name} onPress={() => setRegion(r.name)} /></View>)}
            </View></>}
        </>}

        {/* ---------------- STEP 2: CHOOSE ---------------- */}
        {step === 1 && <>
          <Card style={{ marginHorizontal: 0 }}>
            <Text style={{ fontWeight: '800', marginBottom: 6 }}>Your trip</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}><DateField style={{ flex: 1 }} value={start} minimumDate={new Date()} onChange={(d) => { setStart(d); setChosen({}); }} /></View>
            <Stepper label="Days" value={days} onChange={(n) => { setDays(n); setChosen({}); }} min={1} max={60} />
            <Stepper label="Adults" value={adults} onChange={setAdults} min={1} max={500} />
            <Stepper label="Children" value={children} onChange={setChildren} min={0} max={500} />
            <Muted>{people} travelers total · daily activities are optional</Muted>
            <Label>Contact phone number</Label><PhoneField country={profile?.country || ''} value={contactPhone} onChange={setContactPhone} />
            <Muted>{startDay} → {endDay}{country ? ` · ${region ? region + ', ' : ''}${country}` : ''}</Muted>
          </Card>

          <View onLayout={(e) => { listY.current = e.nativeEvent.layout.y; }}>
            <Text style={{ fontSize: 18, fontWeight: '800', marginTop: 8 }}>What do you want to book?</Text>
            <Muted>Choose cards to add them to a day. You can skip any day and book without opening a listing detail page.</Muted>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8, marginBottom: 4 }}>
              {Object.entries(CATS).map(([k, g]) => <Chip key={k} label={g.label} active={cat === k} onPress={() => setCat(k)} />)}
            </ScrollView>
            {list !== null && <Muted style={{ marginBottom: 4 }}>{total} {total === 1 ? 'place' : 'places'} found</Muted>}
          </View>

          {list === null || (list.some((x) => STAY.includes(x.category) || x.accommodation_available) && stayAvailability === null) ? <Loader /> : listError ? <Card style={{ marginHorizontal: 0 }}><Muted>{listError}</Muted><Btn kind="ghost" title="Try again" onPress={() => setReload((n) => n + 1)} /></Card> : !visibleList?.length ? <Muted style={{ textAlign: 'center', margin: 24 }}>{list.length ? 'No accommodation is available for these dates and group size.' : 'Nothing here yet. Try another region or category.'}</Muted> :
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>{visibleList.map((x) => { const c = chosen[x.id]; const from = cardFrom(x); const freeEntry = x.entrance_fee_free && x.category === 'attraction'; const cover = x.photos?.[0] || null; return (
              <Card key={x.id} onPress={() => toggle(x)} style={{ width: '49%', marginHorizontal: 0, padding: 0, overflow: 'hidden', borderWidth: 2, borderColor: c ? C.primary : '#E5E7EB', backgroundColor: c ? '#F3F9F5' : '#fff' }}>
                <View>
                  <Img uri={cover} category={x.category} style={{ height: 105 }} />
                  <View style={{ position: 'absolute', left: 10, top: 10, backgroundColor: 'rgba(16,34,46,0.78)', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 }}>
                    <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{CAT_BADGE[x.category] || x.category}</Text></View>
                  <View style={{ position: 'absolute', right: 10, top: 10, width: 28, height: 28, borderRadius: 14, backgroundColor: c ? C.primary : 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: c ? '#fff' : C.muted, fontWeight: '800' }}>{c ? '✓' : '+'}</Text></View>
                </View>
                <View style={{ padding: 12 }}>
                  <Text numberOfLines={2} style={{ fontWeight: '800', fontSize: 15 }}>{x.title}</Text>
                  <Muted numberOfLines={2}>📍 {x.location_name || x.region}, {x.country}</Muted>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
                    <Text style={{ color: C.muted }}>⭐ {Number(x.rating_avg || 0).toFixed(1)} ({x.rating_count || 0})</Text>
                    <Text style={{ fontWeight: '800', color: C.primary }}>{freeEntry || from === 0 ? 'Free' : from != null ? `From ${formatMoney(from)}${(STAY.includes(x.category) || x.accommodation_available) ? ' / night' : ''}` : 'On request'}</Text>
                  </View>
                    {!!x.accommodation_available && !STAY.includes(x.category) && <Muted>🛏️ Accommodation available at this place</Muted>}
                    {!!x.facilities?.length && <Muted numberOfLines={2}>Amenities: {x.facilities.join(' · ')}</Muted>}
                  {c && <>
                    <View style={{ height: 1, backgroundColor: '#E5E7EB', marginVertical: 10 }} />
                    {c.options?.length > 1 && <>
                        <Text style={{ fontWeight: '700', marginBottom: 4 }}>{c.stay ? 'Room / stay option' : 'Choose adult and child prices'}</Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                          {c.options.map((p) => <View key={p.id} style={{ marginBottom: 6 }}><Chip label={optLabel(p)} active={c.items.some((i) => i.id === p.id)} onPress={() => pickPrice(x.id, p)} /></View>)}
                      </View></>}
                      {!!c.extras?.length && <>
                        <Text style={{ fontWeight: '700', marginTop: 4 }}>On-site facilities and activities</Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                          {c.extras.map((p) => <View key={p.id} style={{ marginBottom: 6 }}><Chip label={`${c.items.some((i) => i.id === p.id) ? '✓ ' : '+ '}${optLabel(p)}`} active={c.items.some((i) => i.id === p.id)} onPress={() => pickPrice(x.id, p)} /></View>)}
                        </View>
                        {c.items.filter((p) => c.extras.some((extra) => extra.id === p.id) && p.description).map((p) => <Muted key={`detail-${p.id}`}>{p.label}: {p.description}</Muted>)}
                      </>}
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                      <DateField style={{ flex: 1, marginRight: 8 }} value={new Date(c.date + 'T12:00:00')} disabled={c.fixed} suffix={c.fixed ? ' (fixed date)' : ''}
                        minimumDate={new Date(startDay + 'T00:00:00')} maximumDate={new Date(endDay + 'T23:00:00')} onChange={(d) => setField(x.id, { date: ymd(d) })} />
                      {c.fixed ? <Text style={{ fontWeight: '700' }}>🕒 {c.time}</Text> : <TimeField value={c.time} onChange={(t) => setField(x.id, { time: t })} />}
                    </View>
                    {c.stay && <Stepper label="Nights" value={c.nights} onChange={(n) => setField(x.id, { nights: n })} min={1} max={30} />}
                    <Text style={{ fontWeight: '800', color: C.primary, marginTop: 4 }}>{formatMoney(lineTotal(c, adults, children))} for {adults} adults{children ? ` + ${children} children` : ''}</Text>
                    <TouchableOpacity onPress={() => toggle(x)}><Text style={{ color: C.danger, fontWeight: '700', marginTop: 6 }}>Remove from trip</Text></TouchableOpacity>
                  </>}
                </View>
              </Card>); })}</View>}

          {/* pagination */}
          {total > PAGE_SIZE && <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 10 }}>
            <Btn style={{ flex: 1 }} kind="ghost" title="← Previous" disabled={page === 0 || list === null} onPress={() => goPage(page - 1)} />
            <View style={{ paddingHorizontal: 12, alignItems: 'center' }}>
              <Text style={{ fontWeight: '800' }}>Page {page + 1} of {totalPages}</Text></View>
            <Btn style={{ flex: 1 }} kind="ghost" title="Next →" disabled={page + 1 >= totalPages || list === null} onPress={() => goPage(page + 1)} />
          </View>}

          {items.length > 0 && <Card style={{ marginHorizontal: 0, backgroundColor: '#EAF3EE' }}>
            <Text style={{ fontWeight: '800' }}>Your list ({items.length})</Text>
            {items.map((c) => <Muted key={c.l.id}>{c.date} {c.time} · {c.l.title}{isStay(c) ? ` · ${c.nights} night(s)` : ''}</Muted>)}
            <Text style={{ fontWeight: '800', marginTop: 4 }}>Total so far: {formatMoney(itemsTotal)}</Text></Card>}
          {problems.map((p, i) => <Text key={i} style={{ color: C.danger, fontWeight: '700', marginTop: 4 }}>⚠️ {p}</Text>)}
        </>}

        {/* ---------------- STEP 3: PICKUP ---------------- */}
        {step === 2 && <>
          <Text style={{ fontSize: 18, fontWeight: '800', marginTop: 8 }}>Do you need transport?</Text>
          <Muted>Choose one-way pickup or a return ride from your last stop to your pickup place.</Muted>
          {[['none', '🚶 No pickup', 'I will get there myself'], ['oneway', '🚐 Pickup only', 'Pick me up before my first booking'], ['return', '🚐 Pickup and return', 'Return from your last stop to your pickup place']].map(([k, t, s]) => (
            <Card key={k} onPress={() => setMode(k)} style={{ marginHorizontal: 0, borderWidth: 2, borderColor: mode === k ? C.primary : '#E5E7EB' }}><Text style={{ fontWeight: '800' }}>{t}</Text><Muted>{s}</Muted></Card>))}
          {mode !== 'none' && <>
            <Label>Pickup place</Label>
            <View style={{ flexDirection: 'row' }}>
              <Btn style={{ flex: 1, marginRight: 4 }} kind="ghost" title="📍 My location" onPress={useMine} />
              <Btn style={{ flex: 1, marginLeft: 4 }} kind="ghost" title="🗺️ Search / map" onPress={onMap} />
            </View>
            {pickup ? <Muted>📍 {pickup.label}</Muted> : null}
            <Label>Pickup date and time</Label>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <DateField style={{ flex: 1, marginRight: 8 }} value={pickupDate || start}
                minimumDate={new Date(startDay + 'T00:00:00')} maximumDate={new Date(endDay + 'T23:00:00')} onChange={setPickupDate} />
              <TimeField value={pickupTime} onChange={setPickupTime} />
            </View>
            <RoutePreview from={pickup} to={first && first.l.lat != null && first.l.lng != null ? { lat: first.l.lat, lng: first.l.lng } : null} onKm={setKm} />
            {isReturn && <>
              <Label>Return pickup date and time</Label>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <DateField style={{ flex: 1, marginRight: 8 }} value={returnDate || new Date(endDay + 'T12:00:00')}
                  minimumDate={new Date((last ? (isStay(last) ? addDays(last.date, last.nights - 1) : last.date) : startDay) + 'T00:00:00')}
                  maximumDate={new Date(endDay + 'T23:00:00')} onChange={setReturnDate} />
                <TimeField value={returnTime} onChange={setReturnTime} />
              </View>
              {last?.l.lat != null && last?.l.lng != null && pickup && <RoutePreview from={{ lat: last.l.lat, lng: last.l.lng }} to={pickup} onKm={setReturnKm} />}
            </>}
            <Label>Vehicle</Label>
            {vehicles.map((x) => { const fits = x.max_passengers >= people; const price = km != null && (!isReturn || returnKm != null) ? transferPrice(x, km) + (isReturn ? transferPrice(x, returnKm) : 0) : null; return (
              <Card key={x.id} onPress={() => fits && setVid(x.id)} style={{ marginHorizontal: 0, opacity: fits ? 1 : 0.4, borderWidth: 2, borderColor: vid === x.id ? C.primary : '#E5E7EB', flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ flex: 1 }}><Text style={{ fontWeight: '800' }}>{x.name}</Text><Muted>Up to {x.max_passengers} passengers</Muted></View>
                <Text style={{ fontWeight: '800', color: C.primary }}>{price != null ? formatMoney(price) : '—'}</Text></Card>); })}
            <Muted>{isReturn ? `Pickup: ${pickupDay} ${pickupTime} · Return: ${returnDay} ${returnTime}` : `Pickup: ${pickupDay} ${pickupTime}`}</Muted>
            {pickupProblems.map((p, i) => <Text key={i} style={{ color: C.danger, fontWeight: '700', marginTop: 4 }}>⚠️ {p}</Text>)}
          </>}
        </>}

        {/* ---------------- STEP 4: REVIEW & PAY ---------------- */}
        {step === 3 && <>
          <Text style={{ fontSize: 18, fontWeight: '800', marginTop: 8 }}>Review and pay</Text>
          <Muted>{startDay} → {endDay} · {adults} adults{children ? ` · ${children} children` : ''} · {people} travelers</Muted>
          {items.map((c) => <Card key={c.l.id} style={{ marginHorizontal: 0 }}><View style={{ flexDirection: 'row' }}>
            <View style={{ flex: 1 }}><Text style={{ fontWeight: '700' }}>{c.l.title}</Text><Muted>{CAT_BADGE[c.l.category] || c.l.category} · {c.date} · {c.time}{isStay(c) ? ` · ${c.nights} night(s)` : ''}</Muted>
              {c.items.map((p) => <Muted key={p.id}>{p.label} · {p.audience}</Muted>)}</View>
            <Text style={{ fontWeight: '800' }}>{formatMoney(lineTotal(c, adults, children))}</Text></View></Card>)}
          {mode !== 'none' && <Card style={{ marginHorizontal: 0 }}><View style={{ flexDirection: 'row' }}>
            <View style={{ flex: 1 }}><Text style={{ fontWeight: '700' }}>🚐 {isReturn ? 'Pickup and return' : 'Pickup only'} · {v?.name}</Text><Muted>{pickup?.label} · {pickupDay} {pickupTime}{isReturn ? ` · Return ${returnDay} ${returnTime}` : ''}</Muted></View>
            <Text style={{ fontWeight: '800' }}>{formatMoney(tprice)}</Text></View></Card>}
          <View style={{ marginVertical: 10, padding: 14, borderRadius: 14, backgroundColor: C.primary }}>
            <Text style={{ color: '#fff', opacity: 0.9 }}>Total</Text><Text style={{ color: '#fff', fontSize: 28, fontWeight: '800' }}>{formatMoney(grand)}</Text></View>
          <Card style={{ marginHorizontal: 0, backgroundColor: '#FFF8E6' }}>
            <Text style={{ fontWeight: '800' }}>About cancelling</Text>
            <Muted>The whole booking cannot be cancelled. You can cancel single items later in My trips; a {feePct}% cancellation fee applies to each item you cancel.</Muted></Card>
          <Btn title={busy ? 'Please wait…' : `Pay ${formatMoney(grand)}`} onPress={pay} disabled={busy} />
        </>}

        <View style={{ flexDirection: 'row', marginTop: 12 }}>
          {step > 0 && <Btn style={{ flex: 1, marginRight: 4 }} kind="ghost" title="Back" onPress={() => setStep(step - 1)} />}
          {step < 3 && <Btn style={{ flex: 1, marginLeft: step > 0 ? 4 : 0 }} title="Continue" onPress={next} />}
        </View>
      </View>
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}