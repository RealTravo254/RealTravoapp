import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Text, Alert, View, TouchableOpacity } from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { Btn, Card, Input, Label, Muted, Chip, Stepper, Loader } from '../components/ui';
import CountryPicker from '../components/CountryPicker';
import DateField from '../components/DateField';
import TimeField from '../components/TimeField';
import RoutePreview from '../components/RoutePreview';
import Img from '../components/Img';
import { pickLocation } from '../lib/pickBus';
import { getPosition, reverseInfo } from '../lib/geo';
import { ymd, scheduleProblem, transferPrice } from '../lib/pricing';
import { addDays } from '../lib/schedule';
import { startPayment } from '../lib/payments';
import { C } from '../lib/theme';

const GAP = 30; // minutes between two activities
const PAGE_SIZE = 8;
const STAY = ['hotel', 'resort', 'campsite', 'airbnb'];

// Remove rows that share the same id, so React never sees two children with the same key.
const uniq = (arr) => { const seen = new Set(); return (arr || []).filter((r) => r && !seen.has(r.id) && seen.add(r.id)); };

// Every category a guest can add to a trip. "all" shows everything in the chosen place.
const ALL_CATS = ['hotel', 'resort', 'campsite', 'airbnb', 'attraction', 'activity', 'guide', 'event'];
const CATS = {
  all: { label: '🌍 All', cats: ALL_CATS },
  hotel: { label: '🏨 Hotels & resorts', cats: ['hotel', 'resort'] },
  campsite: { label: '⛺ Campsites', cats: ['campsite'] },
  airbnb: { label: '🏡 Airbnb', cats: ['airbnb'] },
  attraction: { label: '🏞️ Attractions', cats: ['attraction'] },
  activity: { label: '🎯 Activities', cats: ['activity'] },
  guide: { label: '🧭 Guides', cats: ['guide'] },
  tour: { label: '🚌 Tours & trips', cats: ['activity', 'guide'], tour: true },
  event: { label: '🎟️ Events', cats: ['event'] },
};
const CAT_BADGE = {
  hotel: '🏨 Hotel', resort: '🌴 Resort', campsite: '⛺ Campsite', airbnb: '🏡 Airbnb',
  attraction: '🏞️ Attraction', activity: '🎯 Activity', guide: '🧭 Guide', event: '🎟️ Event',
};
// The price rows that make up the "main" price of each category
const MAIN_KINDS = {
  hotel: ['room'], resort: ['room'], airbnb: ['room'], campsite: ['entrance'], attraction: ['entrance'],
  activity: ['activity', 'ticket'], guide: ['guide'], event: ['ticket'],
};
const STEPS = ['Where', 'Choose', 'Pickup', 'Pay'];
const ts = (d, t) => new Date(`${d}T${t}:00`).getTime() / 60000;
const isStay = (c) => STAY.includes(c.l.category);
const blk = (c) => { const s = ts(c.date, c.time); return { label: `“${c.l.title}”`, s, e: isStay(c) ? s + c.nights * 1440 - 180 : s + (c.info?.duration_minutes || 120) }; };
const lineTotal = (c, people) => c.items.reduce((s, p) => s + Number(p.price) * (p.unit === 'per_group' ? 1 : people) * (['per_night', 'per_day'].includes(p.unit) ? c.nights : 1), 0);
const mainPrices = (category, prices) => {
  const all = uniq(prices);
  const pool = all.filter((p) => (MAIN_KINDS[category] || []).includes(p.kind));
  return (pool.length ? pool : all).slice().sort((a, b) => Number(a.price) - Number(b.price));
};
const cardFrom = (x) => { const p = mainPrices(x.category, x.listing_prices); return p.length ? Number(p[0].price) : null; };
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
  const { session } = useAuth();
  const scrollRef = useRef(null); const listY = useRef(0); const reqId = useRef(0); const keyRef = useRef('');
  const [step, setStep] = useState(0); const [busy, setBusy] = useState(false); const [feePct, setFeePct] = useState(20);
  // 1 where
  const [country, setCountry] = useState(''); const [region, setRegion] = useState(''); const [regions, setRegions] = useState([]); const [search, setSearch] = useState(''); const [searchQ, setSearchQ] = useState(''); const [mine, setMine] = useState(null);
  // 2 choose
  const [people, setPeople] = useState(2); const [days, setDays] = useState(3); const [start, setStart] = useState(new Date(Date.now() + 86400000));
  const [cat, setCat] = useState('all'); const [list, setList] = useState(null); const [total, setTotal] = useState(0); const [page, setPage] = useState(0); const [chosen, setChosen] = useState({});
  // 3 pickup
  const [mode, setMode] = useState('none'); // none | oneway | round
  const [pickup, setPickup] = useState(null); const [pickupTime, setPickupTime] = useState('08:00'); const [vehicles, setVehicles] = useState([]); const [vid, setVid] = useState(null); const [km, setKm] = useState(null);

  const startDay = ymd(start); const endDay = addDays(startDay, days - 1);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  useEffect(() => {
    supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle().then(({ data }) => { if (data) { setMine({ country: data.country, region: data.region || data.city }); if (data.country) setCountry((c) => c || data.country); } });
    supabase.from('vehicles').select('*').eq('active', true).order('max_passengers').order('id').then(({ data }) => setVehicles(uniq(data)));
    supabase.from('app_settings').select('custom_cancel_fee_percent').eq('id', 1).maybeSingle().then(({ data }) => data && setFeePct(Number(data.custom_cancel_fee_percent ?? 20)));
  }, []);

  useEffect(() => { setRegion(''); if (!country) return setRegions([]);
    supabase.from('country_divisions').select('id,name, countries!inner(name)').eq('countries.name', country).eq('active', true).order('name').order('id').then(({ data }) => setRegions(uniq(data))); }, [country]);

  // wait until the guest stops typing before searching
  useEffect(() => { const t = setTimeout(() => setSearchQ(search.trim().replace(/[,%()]/g, ' ')), 350); return () => clearTimeout(t); }, [search]);

  // load one page of listings (filters change -> back to page 1)
  useEffect(() => {
    if (step !== 1) return;
    const key = [cat, country, region, searchQ].join('|');
    if (keyRef.current !== key) { keyRef.current = key; if (page !== 0) { setPage(0); return; } }
    const id = ++reqId.current; setList(null);
    const g = CATS[cat];
    let q = supabase.from('listings')
      .select('id,title,category,region,country,location_name,lat,lng,photos,rating_avg,rating_count,entrance_fee_free,schedule_type,listing_prices(id,kind,price,unit)', { count: 'exact' })
      .eq('status', 'approved').is('deleted_at', null).in('category', g.cats);
    if (g.tour) q = q.eq('schedule_type', 'tour');
    if (country) q = q.eq('country', country);
    if (region) q = q.eq('region', region);
    if (searchQ) q = q.or(`title.ilike.%${searchQ}%,location_name.ilike.%${searchQ}%`);
    // "id" is the tie-breaker so listings with the same title keep a stable order between pages
    q.order('title').order('id').range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1).then(({ data, count }) => {
      if (id !== reqId.current) return; // an older request finished late
      setList(uniq(data)); setTotal(count || 0);
    });
  }, [step, cat, country, region, searchQ, page]);

  const goPage = (n) => { setPage(n); scrollRef.current?.scrollTo({ y: Math.max(0, listY.current - 8), animated: true }); };

  const items = Object.values(chosen).sort((a, b) => ts(a.date, a.time) - ts(b.date, b.time));
  const first = items[0];
  const v = vehicles.find((x) => x.id === vid && x.max_passengers >= people);
  const tprice = mode !== 'none' && v && km != null ? transferPrice(v, km) * (mode === 'round' ? 2 : 1) : 0;
  const itemsTotal = items.reduce((s, c) => s + lineTotal(c, people), 0);
  const grand = itemsTotal + tprice;
  const clash = useMemo(() => clashes(items), [chosen]);

  const toggle = async (x) => {
    if (chosen[x.id]) return setChosen(({ [x.id]: _, ...r }) => r);
    const [{ data: pr }, { data: info }] = await Promise.all([
      supabase.from('listing_prices').select('*').eq('listing_id', x.id),
      supabase.from('listings').select('id,title,category,opening_hours,event_date,schedule_type,starts_on,ends_on,open_time,duration_minutes').eq('id', x.id).single()]);
    const options = mainPrices(x.category, pr); // room types / entrance prices / guide fee ...
    const picked = options.length ? [options[0]] : []; // cheapest by default, the guest can change it
    const ev = info && (info.category === 'event' || info.schedule_type === 'one_time') && info.event_date ? new Date(info.event_date) : null;
    const stay = STAY.includes(x.category);
    let slot = ev ? { date: ymd(ev), time: `${String(ev.getHours()).padStart(2, '0')}:${String(ev.getMinutes()).padStart(2, '0')}` } : { date: startDay, time: stay ? '14:00' : '09:00' };
    if (!ev) { // find the first free slot inside the trip dates
      outer: for (let d = 0; d < days; d++) for (let h = stay ? 14 : 8; h <= (stay ? 14 : 17); h++) {
        const cand = { l: x, info, items: picked, date: addDays(startDay, d), time: `${String(h).padStart(2, '0')}:00`, nights: 1 };
        if (!clashes([...Object.values(chosen), cand]).length) { slot = { date: cand.date, time: cand.time }; break outer; }
      }
    }
    setChosen((c) => ({ ...c, [x.id]: { l: x, info, options, items: picked, date: slot.date, time: slot.time, nights: 1, fixed: !!ev } }));
  };
  const setField = (id, patch) => setChosen((c) => ({ ...c, [id]: { ...c[id], ...patch } }));

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
    if (first && pickupTime >= first.time && startDay === first.date) pickupProblems.push('Pickup must be before your first booking starts.');
    if (new Date(`${first?.date || startDay}T${pickupTime}:00`).getTime() < Date.now() + 3600000) pickupProblems.push('Pickup must be at least 1 hour from now.');
  }

  const next = () => {
    if (step === 0 && !country && !search.trim()) return Alert.alert('Where do you want to go?', 'Pick a country or search for a place.');
    if (step === 1) { if (!items.length) return Alert.alert('Add at least one stay, tour or activity'); if (problems.length) return Alert.alert('Please check', problems.join('\n')); }
    if (step === 2 && pickupProblems.length) return Alert.alert('Pickup', pickupProblems.join('\n'));
    setStep(step + 1);
  };

  const useMine = async () => { const p = await getPosition(); if (!p) return; const i = await reverseInfo(p.lat, p.lng); setPickup({ lat: p.lat, lng: p.lng, label: i.label }); };
  const onMap = async () => { const r = await pickLocation(navigation, 'Choose your pickup location'); if (r) setPickup(r); };

  const pay = async () => {
    if (problems.length || pickupProblems.length) return Alert.alert('Please check', [...problems, ...pickupProblems].join('\n'));
    setBusy(true); let pkgId = null;
    try {
      for (const c of items) {
        const { data: left } = await supabase.rpc('get_availability', { p_listing: c.l.id, p_start: c.date, p_end: isStay(c) ? addDays(c.date, c.nights - 1) : c.date });
        if (typeof left === 'number' && left < people) throw new Error(`${c.l.title} has only ${left} places left for that date.`);
      }
      const pickAt = mode !== 'none' ? new Date(`${first.date}T${pickupTime}:00`).toISOString() : null;
      const r = await supabase.from('trip_packages').insert({ user_id: session.user.id, is_custom: true, people, start_date: startDay, end_date: endDay, trip_type: mode === 'none' ? null : mode,
        pickup_location: pickup?.label || null, pickup_lat: pickup?.lat || null, pickup_lng: pickup?.lng || null, pickup_time: pickAt, vehicle_id: mode !== 'none' ? v.id : null,
        pickup_people: mode !== 'none' ? people : null, distance_km: mode !== 'none' ? km : null, transfer_price: tprice, total: grand }).select().single();
      if (r.error) throw r.error; pkgId = r.data.id;
      for (const c of items) {
        const total = lineTotal(c, people); const stay = isStay(c);
        const b = await supabase.from('bookings').insert({ user_id: session.user.id, listing_id: c.l.id, package_id: pkgId, guests: people, start_date: c.date, end_date: stay ? addDays(c.date, c.nights - 1) : c.date,
          nights: stay ? c.nights : 1, start_time: c.time + ':00', subtotal: total, total }).select().single();
        if (b.error) throw b.error;
        if (c.items.length) {
          const bi = await supabase.from('booking_items').insert(c.items.map((p) => ({ booking_id: b.data.id, price_id: p.id, label: p.label, quantity: people, unit_price: p.price,
            amount: Number(p.price) * (p.unit === 'per_group' ? 1 : people) * (['per_night', 'per_day'].includes(p.unit) ? c.nights : 1) })));
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

  const optLabel = (p) => `${p.label && p.label !== p.kind ? p.label : p.audience}${p.label && p.label !== p.kind ? ` · ${p.audience}` : ''} · ${Number(p.price) === 0 ? 'Free' : `$${p.price}`}${UNIT_TXT[p.unit] || ''}`;

  return (
    <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" style={{ backgroundColor: '#F6F7F5' }}>
      <View style={{ backgroundColor: C.primary, padding: 18, paddingTop: 22, paddingBottom: 26, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 }}>
        <Text style={{ color: '#fff', fontSize: 24, fontWeight: '800' }}>Plan your trip</Text>
        <Text style={{ color: '#fff', opacity: 0.85, marginTop: 4 }}>Build it your way: stays, tours and activities in one booking.</Text>
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
          <Label>Or search a place</Label><Input placeholder="e.g. Masai Mara, Zanzibar, Diani" value={search} onChangeText={setSearch} />
        </>}

        {/* ---------------- STEP 2: CHOOSE ---------------- */}
        {step === 1 && <>
          <Card style={{ marginHorizontal: 0 }}>
            <Text style={{ fontWeight: '800', marginBottom: 6 }}>Your trip</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}><DateField style={{ flex: 1 }} value={start} minimumDate={new Date()} onChange={(d) => { setStart(d); setChosen({}); }} /></View>
            <Stepper label="Days" value={days} onChange={(n) => { setDays(n); setChosen({}); }} min={1} max={60} />
            <Stepper label="People" value={people} onChange={setPeople} min={1} max={500} />
            <Muted>{startDay} → {endDay}{country ? ` · ${region ? region + ', ' : ''}${country}` : ''}</Muted>
          </Card>

          <View onLayout={(e) => { listY.current = e.nativeEvent.layout.y; }}>
            <Text style={{ fontSize: 18, fontWeight: '800', marginTop: 8 }}>What do you want to book?</Text>
            <Muted>Everything available in {region ? `${region}, ` : ''}{country || 'your search'}.</Muted>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8, marginBottom: 4 }}>
              {Object.entries(CATS).map(([k, g]) => <Chip key={k} label={g.label} active={cat === k} onPress={() => setCat(k)} />)}
            </ScrollView>
            <Input placeholder="Search by name or place" value={search} onChangeText={setSearch} />
            {list !== null && <Muted style={{ marginBottom: 4 }}>{total} {total === 1 ? 'place' : 'places'} found</Muted>}
          </View>

          {list === null ? <Loader /> : list.length === 0 ? <Muted style={{ textAlign: 'center', margin: 24 }}>Nothing here yet. Try another region or category.</Muted> :
            list.map((x) => { const c = chosen[x.id]; const from = cardFrom(x); const freeEntry = x.entrance_fee_free && ['campsite', 'attraction'].includes(x.category); const cover = x.photos?.[0] || null; return (
              <Card key={x.id} onPress={() => toggle(x)} style={{ marginHorizontal: 0, padding: 0, overflow: 'hidden', borderWidth: 2, borderColor: c ? C.primary : '#E5E7EB', backgroundColor: c ? '#F3F9F5' : '#fff' }}>
                <View>
                  <Img uri={cover} category={x.category} style={{ height: 130 }} />
                  <View style={{ position: 'absolute', left: 10, top: 10, backgroundColor: 'rgba(16,34,46,0.78)', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 }}>
                    <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{CAT_BADGE[x.category] || x.category}</Text></View>
                  <View style={{ position: 'absolute', right: 10, top: 10, width: 28, height: 28, borderRadius: 14, backgroundColor: c ? C.primary : 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: c ? '#fff' : C.muted, fontWeight: '800' }}>{c ? '✓' : '+'}</Text></View>
                </View>
                <View style={{ padding: 12 }}>
                  <Text style={{ fontWeight: '800', fontSize: 16 }}>{x.title}</Text>
                  <Muted>📍 {x.location_name || x.region}, {x.country}</Muted>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
                    <Text style={{ color: C.muted }}>⭐ {Number(x.rating_avg || 0).toFixed(1)} ({x.rating_count || 0})</Text>
                    <Text style={{ fontWeight: '800', color: C.primary }}>{freeEntry || from === 0 ? 'Free' : from != null ? `From $${from}` : 'On request'}</Text>
                  </View>
                  {c && <>
                    <View style={{ height: 1, backgroundColor: '#E5E7EB', marginVertical: 10 }} />
                    {c.options?.length > 1 && <>
                      <Text style={{ fontWeight: '700', marginBottom: 4 }}>{STAY.includes(x.category) ? 'Room type' : 'Option'}</Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                        {c.options.map((p) => <View key={p.id} style={{ marginBottom: 6 }}><Chip label={optLabel(p)} active={c.items[0]?.id === p.id} onPress={() => setField(x.id, { items: [p] })} /></View>)}
                      </View></>}
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                      <DateField style={{ flex: 1, marginRight: 8 }} value={new Date(c.date + 'T12:00:00')} disabled={c.fixed} suffix={c.fixed ? ' (fixed date)' : ''}
                        minimumDate={new Date(startDay + 'T00:00:00')} maximumDate={new Date(endDay + 'T23:00:00')} onChange={(d) => setField(x.id, { date: ymd(d) })} />
                      {c.fixed ? <Text style={{ fontWeight: '700' }}>🕒 {c.time}</Text> : <TimeField value={c.time} onChange={(t) => setField(x.id, { time: t })} />}
                    </View>
                    {STAY.includes(x.category) && <Stepper label="Nights" value={c.nights} onChange={(n) => setField(x.id, { nights: n })} min={1} max={30} />}
                    <Text style={{ fontWeight: '800', color: C.primary, marginTop: 4 }}>${lineTotal(c, people).toFixed(2)} for {people} {people === 1 ? 'person' : 'people'}</Text>
                    <TouchableOpacity onPress={() => toggle(x)}><Text style={{ color: C.danger, fontWeight: '700', marginTop: 6 }}>Remove from trip</Text></TouchableOpacity>
                  </>}
                </View>
              </Card>); })}

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
            <Text style={{ fontWeight: '800', marginTop: 4 }}>Total so far: ${itemsTotal.toFixed(2)}</Text></Card>}
          {problems.map((p, i) => <Text key={i} style={{ color: C.danger, fontWeight: '700', marginTop: 4 }}>⚠️ {p}</Text>)}
        </>}

        {/* ---------------- STEP 3: PICKUP ---------------- */}
        {step === 2 && <>
          <Text style={{ fontSize: 18, fontWeight: '800', marginTop: 8 }}>Do you need transport?</Text>
          <Muted>One pickup covers your whole trip.</Muted>
          {[['none', '🚶 No pickup', 'I will get there myself'], ['oneway', '🚐 Pickup only', 'Pick me up before my first booking'], ['round', '🔁 Pickup and return', 'Pick me up and bring me back']].map(([k, t, s]) => (
            <Card key={k} onPress={() => setMode(k)} style={{ marginHorizontal: 0, borderWidth: 2, borderColor: mode === k ? C.primary : '#E5E7EB' }}><Text style={{ fontWeight: '800' }}>{t}</Text><Muted>{s}</Muted></Card>))}
          {mode !== 'none' && <>
            <Label>Pickup place</Label>
            <View style={{ flexDirection: 'row' }}>
              <Btn style={{ flex: 1, marginRight: 4 }} kind="ghost" title="📍 My location" onPress={useMine} />
              <Btn style={{ flex: 1, marginLeft: 4 }} kind="ghost" title="🗺️ Search / map" onPress={onMap} />
            </View>
            {pickup ? <Muted>📍 {pickup.label}</Muted> : null}
            <Label>Pickup time on {first?.date}</Label><TimeField value={pickupTime} onChange={setPickupTime} />
            <RoutePreview from={pickup} to={first ? { lat: first.l.lat, lng: first.l.lng } : null} onKm={setKm} />
            <Label>Vehicle</Label>
            {vehicles.map((x) => { const fits = x.max_passengers >= people; const price = km != null ? transferPrice(x, km) * (mode === 'round' ? 2 : 1) : null; return (
              <Card key={x.id} onPress={() => fits && setVid(x.id)} style={{ marginHorizontal: 0, opacity: fits ? 1 : 0.4, borderWidth: 2, borderColor: vid === x.id ? C.primary : '#E5E7EB', flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ flex: 1 }}><Text style={{ fontWeight: '800' }}>{x.name}</Text><Muted>Up to {x.max_passengers} passengers</Muted></View>
                <Text style={{ fontWeight: '800', color: C.primary }}>{price != null ? `$${price.toFixed(2)}` : '—'}</Text></Card>); })}
            {pickupProblems.map((p, i) => <Text key={i} style={{ color: C.danger, fontWeight: '700', marginTop: 4 }}>⚠️ {p}</Text>)}
          </>}
        </>}

        {/* ---------------- STEP 4: REVIEW & PAY ---------------- */}
        {step === 3 && <>
          <Text style={{ fontSize: 18, fontWeight: '800', marginTop: 8 }}>Review and pay</Text>
          <Muted>{startDay} → {endDay} · {people} {people === 1 ? 'person' : 'people'}</Muted>
          {items.map((c) => <Card key={c.l.id} style={{ marginHorizontal: 0 }}><View style={{ flexDirection: 'row' }}>
            <View style={{ flex: 1 }}><Text style={{ fontWeight: '700' }}>{c.l.title}</Text><Muted>{CAT_BADGE[c.l.category] || c.l.category} · {c.date} · {c.time}{isStay(c) ? ` · ${c.nights} night(s)` : ''}</Muted>
              {c.items[0]?.label && c.items[0].label !== c.items[0].kind ? <Muted>{c.items[0].label}</Muted> : null}</View>
            <Text style={{ fontWeight: '800' }}>${lineTotal(c, people).toFixed(2)}</Text></View></Card>)}
          {mode !== 'none' && <Card style={{ marginHorizontal: 0 }}><View style={{ flexDirection: 'row' }}>
            <View style={{ flex: 1 }}><Text style={{ fontWeight: '700' }}>🚐 {mode === 'round' ? 'Pickup and return' : 'Pickup'} · {v?.name}</Text><Muted>{pickup?.label} · {pickupTime}</Muted></View>
            <Text style={{ fontWeight: '800' }}>${tprice.toFixed(2)}</Text></View></Card>}
          <View style={{ marginVertical: 10, padding: 14, borderRadius: 14, backgroundColor: C.primary }}>
            <Text style={{ color: '#fff', opacity: 0.9 }}>Total</Text><Text style={{ color: '#fff', fontSize: 28, fontWeight: '800' }}>${grand.toFixed(2)}</Text></View>
          <Card style={{ marginHorizontal: 0, backgroundColor: '#FFF8E6' }}>
            <Text style={{ fontWeight: '800' }}>About cancelling</Text>
            <Muted>The whole booking cannot be cancelled. You can cancel single items later in My trips; a {feePct}% cancellation fee applies to each item you cancel.</Muted></Card>
          <Btn title={busy ? 'Please wait…' : `Pay $${grand.toFixed(2)}`} onPress={pay} disabled={busy} />
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