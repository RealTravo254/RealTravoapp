import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Text, Alert, View, TouchableOpacity, Modal, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
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
import { getPosition, matchRegion, reverseInfo } from '../lib/geo';
import { ymd, scheduleProblem, transferPrice } from '../lib/pricing';
import { addDays } from '../lib/schedule';
import { startPayment } from '../lib/payments';
import { isValidContactPhone } from '../lib/phone';
import { C } from '../lib/theme';

const GAP = 30; // minutes between two activities
const PAGE_SIZE = 8;
const STAY = ['hotel', 'resort', 'campsite', 'airbnb'];
const ACTIVITY_CATS = ['attraction', 'activity', 'guide'];
const STAY_CATS = ['hotel', 'resort', 'campsite', 'attraction', 'airbnb', 'activity', 'guide'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SAFETY_NOTES = {
  activity: ['Check the activity requirements and conditions with the provider before you go.', 'Follow staff instructions and posted signs, and keep emergency contact details with you.'],
  facility: ['Confirm opening hours, availability, and accessibility with the provider.', 'Follow on-site instructions and locate exits or staff if you need help.'],
  accommodation: ['Confirm the address and check-in details with the provider before arrival.', 'On arrival, note the exits and emergency contact information, and secure your belongings.'],
};

// Remove rows that share the same id, so React never sees two children with the same key.
const uniq = (arr) => { const seen = new Set(); return (arr || []).filter((r) => r && !seen.has(r.id) && seen.add(r.id)); };

const CATS = {
  all: { label: 'All', cats: [] },
  hotel: { label: '🏨 Hotels & resorts', cats: ['hotel', 'resort'] },
  campsite: { label: '🏕️ Campsites', cats: ['campsite'] },
  airbnb: { label: '🏠 Airbnb', cats: ['airbnb'] },
  resort: { label: '🌴 Resorts', cats: ['resort'] },
  attraction: { label: '🏞️ Attractions', cats: ['attraction'] },
  stayAttraction: { label: '🏞️ Places with accommodation', cats: ['attraction'] },
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
const STEPS = ['Where & when', 'Activities', 'Accommodation', 'Pickup', 'Review'];
const ts = (d, t) => new Date(`${d}T${t}:00`).getTime() / 60000;
const isStay = (c) => !!c.stay;
const blk = (c) => { const s = ts(c.date, c.time); return { label: `“${c.l.title}”`, s, e: isStay(c) ? s + c.nights * 1440 - 180 : s + (c.info?.duration_minutes || 120) }; };
const selectedPriceOptions = (c, p) => {
  if (c.options?.some((x) => x.id === p.id)) return c.options.filter((x) => c.items.some((item) => item.id === x.id));
  if (c.extras?.some((x) => x.id === p.id)) return c.extras.filter((x) => c.items.some((item) => item.id === x.id));
  return c.items.filter((item) => item.kind === p.kind);
};
const priceQuantity = (p, adults, children, selectedOptions) => {
  if (p.unit === 'per_group') return 1;
  const hasAdultPrice = selectedOptions.some((x) => x.audience !== 'child');
  const hasChildPrice = selectedOptions.some((x) => x.audience === 'child');
  if (p.audience === 'child') return hasAdultPrice ? children : adults + children;
  return hasChildPrice ? adults : adults + children;
};
const lineTotal = (c, adults, children) => {
  return c.items.reduce((s, p) => s + Number(p.price) * priceQuantity(p, adults, children, selectedPriceOptions(c, p)) * (['per_night', 'per_day'].includes(p.unit) ? c.nights : 1), 0);
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
  const insets = useSafeAreaInsets();
  const scrollRef = useRef(null); const listY = useRef(0); const reqId = useRef(0); const keyRef = useRef('');
  const [step, setStep] = useState(0); const [busy, setBusy] = useState(false); const [feePct, setFeePct] = useState(20);
  // 1 where
  const [country, setCountry] = useState(''); const [region, setRegion] = useState(''); const [regions, setRegions] = useState([]); const [mine, setMine] = useState(null);
  const [destination, setDestination] = useState(null);
  // 2 choose
  const [adults, setAdults] = useState(2); const [children, setChildren] = useState(0); const people = adults + children;
  const [days, setDays] = useState(3); const [start, setStart] = useState(new Date(Date.now() + 86400000));
  const [cat, setCat] = useState('all'); const [list, setList] = useState(null); const [listError, setListError] = useState(''); const [total, setTotal] = useState(0); const [page, setPage] = useState(0); const [chosen, setChosen] = useState({}); const [reload, setReload] = useState(0);
  const [editingId, setEditingId] = useState(null); const [originalItem, setOriginalItem] = useState(null); const [editorLoading, setEditorLoading] = useState(false);
  const [safetyItem, setSafetyItem] = useState(null);
  const [stayAvailability, setStayAvailability] = useState(null);
  // 3 pickup
  const [mode, setMode] = useState('none'); // none | oneway | return
  const [pickup, setPickup] = useState(null); const [pickupTime, setPickupTime] = useState('08:00'); const [vehicles, setVehicles] = useState([]); const [vid, setVid] = useState(null); const [km, setKm] = useState(null);
  const [pickupDate, setPickupDate] = useState(null); const [returnDate, setReturnDate] = useState(null); const [returnTime, setReturnTime] = useState('17:00'); const [returnKm, setReturnKm] = useState(null);
  const [contactPhone, setContactPhone] = useState('');
  const accountEmail = session?.user?.email || '';
  const [useAccountEmail, setUseAccountEmail] = useState(true); const [contactEmail, setContactEmail] = useState(accountEmail);
  const bookingEmail = (useAccountEmail ? accountEmail : contactEmail).trim();

  const startDay = ymd(start); const endDay = addDays(startDay, days - 1);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  useEffect(() => {
    supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle().then(({ data }) => { if (data) { setMine({ country: data.country, region: data.region || data.city }); if (data.country) setCountry((c) => c || data.country); } });
    supabase.from('vehicles').select('*').eq('active', true).order('max_passengers').order('id').then(({ data }) => setVehicles(uniq(data)));
    supabase.from('app_settings').select('custom_cancel_fee_percent').eq('id', 1).maybeSingle().then(({ data }) => data && setFeePct(Number(data.custom_cancel_fee_percent ?? 20)));
  }, []);
  useEffect(() => { if (!contactPhone && profile?.phone) setContactPhone(profile.phone); }, [profile?.phone]);
  useEffect(() => { if (!contactEmail && accountEmail) setContactEmail(accountEmail); }, [accountEmail]);

  useEffect(() => { setRegion(''); if (!country) return setRegions([]);
    supabase.from('country_divisions').select('id,name, countries!inner(name)').eq('countries.name', country).eq('active', true).order('name').order('id').then(({ data }) => setRegions(uniq(data))); }, [country]);

  useEffect(() => {
    if (!destination?.parts?.length || destination.country !== country || !regions.length) return;
    const match = matchRegion(destination.parts, regions.map((r) => r.name));
    if (match) setRegion(match);
  }, [destination, country, regions]);

  // load one page of listings (filters change -> back to page 1)
  useEffect(() => {
    if (step !== 1 && step !== 2) return;
    const accommodation = step === 2;
    const key = [step, cat, country, region].join('|');
    if (keyRef.current !== key) { keyRef.current = key; if (page !== 0) { setPage(0); return; } }
    const id = ++reqId.current; setList(null); setListError('');
    const g = CATS[cat];
    const categories = cat === 'all' ? (accommodation ? STAY_CATS : ACTIVITY_CATS) : g.cats;
    let q = supabase.from('listings')
      .select('id,title,category,region,country,location_name,lat,lng,photos,facilities,accommodation_available,rating_avg,rating_count,entrance_fee_free,schedule_type,listing_prices(id,kind,label,price,unit,audience,is_optional)', { count: 'exact' })
      .eq('status', 'approved').is('deleted_at', null).in('category', categories);
    if (g.tour) q = q.eq('schedule_type', 'tour');
    if (accommodation) q = q.or('category.in.(hotel,resort,campsite,airbnb),accommodation_available.eq.true');
    if (accommodation && cat === 'stayAttraction') q = q.eq('accommodation_available', true);
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
    if ((step !== 1 && step !== 2) || list === null) return undefined;
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
  const itemsTotal = items.reduce((s, c) => s + lineTotal(c, c.adults, c.children), 0);
  const grand = itemsTotal + tprice;
  const clash = useMemo(() => clashes(items), [chosen]);
  useEffect(() => { setKm(null); setReturnKm(null); }, [mode, pickup?.lat, pickup?.lng, first?.l.id, last?.l.id]);
  useEffect(() => {
    if (pickupDate && (ymd(pickupDate) < startDay || ymd(pickupDate) > endDay)) setPickupDate(null);
    if (returnDate && (ymd(returnDate) < startDay || ymd(returnDate) > endDay)) setReturnDate(null);
  }, [startDay, endDay, pickupDate, returnDate]);

  const openListing = async (x) => {
    const existing = chosen[x.id];
    if (existing) { setOriginalItem(existing); setEditingId(x.id); return; }
    setOriginalItem(null); setEditingId(x.id); setEditorLoading(true);
    try {
      const [priceResult, listingResult] = await Promise.all([
        supabase.from('listing_prices').select('*').eq('listing_id', x.id),
        supabase.from('listings').select('id,title,category,opening_hours,event_date,schedule_type,starts_on,ends_on,open_time,duration_minutes').eq('id', x.id).single(),
      ]);
      if (priceResult.error) throw priceResult.error;
      if (listingResult.error) throw listingResult.error;
      const pr = priceResult.data || [];
      const info = listingResult.data;
      const stay = STAY.includes(x.category) || !!x.accommodation_available;
      const options = mainPrices(x.category, pr, stay);
      const required = [...options.filter((p) => !p.is_optional), ...pr.filter((p) => !p.is_optional && !options.some((option) => option.id === p.id))];
      const adultOption = options.find((p) => p.audience !== 'child');
      const childOption = children > 0 ? options.find((p) => p.audience === 'child') : null;
      const picked = [...required];
      if (!picked.some((p) => p.audience !== 'child') && adultOption) picked.push(adultOption);
      if (childOption && !picked.some((p) => p.audience === 'child')) picked.push(childOption);
      if (!picked.length && options.length) picked.push(options[0]);
      const extras = pr.filter((p) => p.is_optional && ['entrance', 'ticket', 'facility', 'activity'].includes(p.kind) && !options.some((option) => option.id === p.id));
      const fixedDate = info.schedule_type === 'one_time' && info.event_date ? new Date(info.event_date) : null;
      let slot = fixedDate ? { date: ymd(fixedDate), time: `${String(fixedDate.getHours()).padStart(2, '0')}:${String(fixedDate.getMinutes()).padStart(2, '0')}` } : { date: startDay, time: stay ? '14:00' : '09:00' };
      if (!fixedDate) {
        outer: for (let d = 0; d < days; d++) for (let h = stay ? 14 : 8; h <= (stay ? 14 : 17); h++) {
          const cand = { l: x, info, items: picked, stay, date: addDays(startDay, d), time: `${String(h).padStart(2, '0')}:00`, nights: 1 };
          if (!clashes([...Object.values(chosen), cand]).length) { slot = { date: cand.date, time: cand.time }; break outer; }
        }
      }
      setChosen((current) => ({ ...current, [x.id]: { l: x, info, options, extras, items: picked, stay, date: slot.date, time: slot.time, nights: 1, adults, children, fixed: !!fixedDate } }));
    } catch (error) {
      setEditingId(null); setOriginalItem(null);
      Alert.alert('Could not load booking options', error.message);
    } finally { setEditorLoading(false); }
  };
  const setField = (id, patch) => setChosen((c) => ({ ...c, [id]: { ...c[id], ...patch } }));
  const setItemPeople = (id, field, value) => setChosen((current) => {
    const item = current[id];
    if (!item) return current;
    const count = { adults: item.adults, children: item.children, [field]: value };
    const childOptions = item.options.filter((p) => p.audience === 'child');
    const selected = count.children === 0
      ? item.items.filter((p) => !childOptions.some((option) => option.id === p.id))
      : childOptions.length && !item.items.some((p) => childOptions.some((option) => option.id === p.id))
        ? [...item.items, childOptions[0]]
        : item.items;
    return { ...current, [id]: { ...item, ...count, items: selected } };
  });
  const setAdultsCount = (count) => {
    setAdults(count);
    setChosen((current) => Object.fromEntries(Object.entries(current).map(([id, item]) => [id, { ...item, adults: Math.min(item.adults, count) }])));
  };
  const setChildCount = (count) => {
    setChildren(count);
    setChosen((current) => Object.fromEntries(Object.entries(current).map(([id, c]) => {
      const childOptions = c.options.filter((p) => p.audience === 'child');
      const childrenForItem = Math.min(c.children, count);
      const items = childrenForItem === 0
        ? c.items.filter((p) => !childOptions.some((option) => option.id === p.id))
        : childOptions.length && !c.items.some((p) => childOptions.some((option) => option.id === p.id))
          ? [...c.items, childOptions[0]]
          : c.items;
      return [id, { ...c, children: childrenForItem, items }];
    })));
  };
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
  const closeEditor = (save) => {
    if (editingId && !save) setChosen((current) => {
      if (originalItem) return { ...current, [editingId]: originalItem };
      const { [editingId]: removed, ...rest } = current;
      return rest;
    });
    setEditingId(null); setOriginalItem(null); setEditorLoading(false);
  };
  const removeEditingItem = () => {
    setChosen((current) => {
      const { [editingId]: removed, ...rest } = current;
      return rest;
    });
    setEditingId(null); setOriginalItem(null);
  };

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
    if (step === 2) {
      if (!items.length) return Alert.alert('Add at least one stay, tour or activity');
      if (problems.length) return Alert.alert('Please check', problems.join('\n'));
    }
    if (step === 3 && pickupProblems.length) return Alert.alert('Pickup', pickupProblems.join('\n'));
    if (step === 1) setCat('all');
    setStep((current) => current + 1);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };
  const back = () => {
    if (step === 0) navigation.goBack();
    else { if (step === 2) setCat('all'); setStep((current) => current - 1); }
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  const useMine = async () => { const p = await getPosition(); if (!p) return; const i = await reverseInfo(p.lat, p.lng); setPickup({ lat: p.lat, lng: p.lng, label: i.label }); };
  const onMap = async () => { const r = await pickLocation(navigation, 'Choose your pickup location'); if (r) setPickup(r); };
  const onDestinationMap = async () => {
    const r = await pickLocation(navigation, 'Choose your destination');
    if (!r) return;
    const info = await reverseInfo(r.lat, r.lng);
    setDestination({ ...r, label: info.label || r.label, country: info.country, parts: info.parts });
    setRegion('');
    if (info.country) setCountry(info.country);
  };
  const selectCountry = (value) => { setCountry(value); setRegion(''); setDestination(null); };

  const pay = async () => {
    if (!isValidContactPhone(contactPhone)) return Alert.alert('Phone number', 'Enter a valid phone number to continue.');
    if (!EMAIL.test(bookingEmail)) return Alert.alert('Email address', 'Enter a valid contact email address to continue.');
    if (problems.length || pickupProblems.length) return Alert.alert('Please check', [...problems, ...pickupProblems].join('\n'));
    setBusy(true); let pkgId = null;
    try {
      for (const c of items) {
        const guests = c.adults + c.children;
        const { data: left, error: availabilityError } = await supabase.rpc('get_availability', { p_listing: c.l.id, p_start: c.date, p_end: isStay(c) ? addDays(c.date, c.nights - 1) : c.date });
        if (availabilityError) throw availabilityError;
        if (typeof left === 'number' && left < guests) throw new Error(`${c.l.title} has only ${left} places left for that date.`);
      }
      const pickAt = mode !== 'none' ? new Date(`${pickupDay}T${pickupTime}:00`).toISOString() : null;
      const r = await supabase.from('trip_packages').insert({ user_id: session.user.id, is_custom: true, people, adults, children, start_date: startDay, end_date: endDay, trip_type: mode === 'none' ? null : mode,
        pickup_location: pickup?.label || null, pickup_lat: pickup?.lat || null, pickup_lng: pickup?.lng || null, pickup_time: pickAt,
        dropoff_location: isReturn ? pickup?.label || null : null, dropoff_lat: isReturn ? pickup?.lat || null : null, dropoff_lng: isReturn ? pickup?.lng || null : null,
        return_date: isReturn ? returnDay : null, return_time: isReturn ? returnTime + ':00' : null,
        contact_phone: contactPhone, contact_email: bookingEmail, vehicle_id: mode !== 'none' ? v.id : null,
        pickup_people: mode !== 'none' ? people : null, distance_km: mode !== 'none' ? km : null, transfer_price: tprice, total: grand }).select().single();
      if (r.error) throw r.error; pkgId = r.data.id;
      for (const c of items) {
        const guests = c.adults + c.children;
        const total = lineTotal(c, c.adults, c.children); const stay = isStay(c);
        const b = await supabase.from('bookings').insert({ user_id: session.user.id, listing_id: c.l.id, package_id: pkgId, guests, start_date: c.date, end_date: stay ? addDays(c.date, c.nights - 1) : c.date,
          adults: c.adults, children: c.children, nights: stay ? c.nights : 1, start_time: c.time + ':00', contact_phone: contactPhone, contact_email: bookingEmail, trip_type: mode === 'none' ? null : mode,
          pickup_location: pickup?.label || null, pickup_lat: pickup?.lat || null, pickup_lng: pickup?.lng || null, pickup_time: mode !== 'none' ? pickupTime + ':00' : null,
          return_date: isReturn ? returnDay : null, return_time: isReturn ? returnTime + ':00' : null, subtotal: total, total }).select().single();
        if (b.error) throw b.error;
        if (c.items.length) {
          const bi = await supabase.from('booking_items').insert(c.items.map((p) => {
            const quantity = priceQuantity(p, c.adults, c.children, selectedPriceOptions(c, p));
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
  const editorItem = editingId ? chosen[editingId] : null;

  return (
    <View style={{ flex: 1, backgroundColor: '#F6F7F5' }}>
    <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" style={{ backgroundColor: '#F6F7F5' }} contentContainerStyle={{ paddingBottom: 150 }}>
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
          <Text style={{ fontSize: 18, fontWeight: '800', marginTop: 8 }}>Where and when do you want to travel?</Text>
          {mine?.country ? <Card onPress={() => { selectCountry(mine.country); if (mine.region) setRegion(mine.region); }} style={{ marginHorizontal: 0, backgroundColor: '#EAF3EE' }}>
            <Text style={{ fontWeight: '800' }}>⭐ Suggested for you</Text><Muted>{mine.region ? `${mine.region}, ` : ''}{mine.country} (from your profile). Tap to use.</Muted></Card> : null}
          <Label>Country</Label><CountryPicker value={country} onChange={selectCountry} />
          <View style={{ flexDirection: 'row', marginTop: 4 }}>
            <Btn style={{ flex: 1 }} kind="ghost" title="🗺️ Choose a place on the map" onPress={onDestinationMap} />
          </View>
          {destination && <Card style={{ marginHorizontal: 0, backgroundColor: '#EAF3EE' }}>
            <Text style={{ fontWeight: '700' }}>📍 Map destination</Text><Muted>{destination.label}{destination.country ? ` · ${destination.country}` : ''}</Muted>
          </Card>}
          {regions.length > 0 && <><Label>Region (optional)</Label>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              <View style={{ marginBottom: 6 }}><Chip label="All regions" active={!region} onPress={() => setRegion('')} /></View>
              {regions.map((r) => <View key={r.id} style={{ marginBottom: 6 }}><Chip label={r.name} active={region === r.name} onPress={() => setRegion(r.name)} /></View>)}
            </View></>}
          <Card style={{ marginHorizontal: 0, marginTop: 12 }}>
            <Text style={{ fontWeight: '800', marginBottom: 6 }}>Trip dates and travelers</Text>
            <DateField value={start} minimumDate={new Date()} onChange={(d) => { setStart(d); setChosen({}); }} />
            <Stepper label="Days" value={days} onChange={(n) => { setDays(n); setChosen({}); }} min={1} max={60} />
            <Stepper label="Adults" value={adults} onChange={setAdultsCount} min={1} max={500} />
            <Stepper label="Children" value={children} onChange={setChildCount} min={0} max={500} />
            <Muted>{startDay} → {endDay} · {people} travelers{region ? ` · ${region}` : ''}{country ? `, ${country}` : ''}</Muted>
          </Card>
        </>}

        {/* ---------------- STEP 2/3: ACTIVITIES AND ACCOMMODATION ---------------- */}
        {(step === 1 || step === 2) && <>
          <View onLayout={(e) => { listY.current = e.nativeEvent.layout.y; }}>
            <Text style={{ fontSize: 18, fontWeight: '800', marginTop: 8 }}>{step === 1 ? 'Activities, guided trips & facilities' : 'Accommodation'}</Text>
            <Muted>{step === 1
              ? `${startDay} → ${endDay} · ${people} travelers. Choose activities, tours, and on-site facilities.`
              : 'Choose an available hotel, resort, campsite, Airbnb, or attraction with accommodation.'}</Muted>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8, marginBottom: 4 }}>
              {(step === 1 ? ['all', 'attraction', 'activity', 'guide', 'tour'] : ['all', 'hotel', 'resort', 'campsite', 'airbnb', 'stayAttraction'])
                .map((k) => <Chip key={k} label={k === 'all' ? (step === 1 ? 'All activities' : 'All accommodation') : CATS[k].label} active={cat === k} onPress={() => { setCat(k); setPage(0); }} />)}
            </ScrollView>
            {list !== null && <Muted style={{ marginBottom: 4 }}>{total} {total === 1 ? 'place' : 'places'} found</Muted>}
          </View>

          {list === null || (list.some((x) => STAY.includes(x.category) || x.accommodation_available) && stayAvailability === null) ? <Loader /> : listError ? <Card style={{ marginHorizontal: 0 }}><Muted>{listError}</Muted><Btn kind="ghost" title="Try again" onPress={() => setReload((n) => n + 1)} /></Card> : !visibleList?.length ? <Muted style={{ textAlign: 'center', margin: 24 }}>{list.length ? (step === 2 ? 'No accommodation is available for these dates and group size.' : 'No places are available for this trip.') : 'Nothing here yet. Try another region or category.'}</Muted> :
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>{visibleList.map((x) => { const c = chosen[x.id]; const from = cardFrom(x); const freeEntry = x.entrance_fee_free && x.category === 'attraction'; const cover = x.photos?.[0] || null; return (
              <Card key={x.id} style={{ width: '49%', marginHorizontal: 0, padding: 0, overflow: 'hidden', borderWidth: 2, borderColor: c ? C.primary : '#E5E7EB', backgroundColor: c ? '#F3F9F5' : '#fff' }}>
                <TouchableOpacity activeOpacity={0.85} onPress={() => openListing(x)}>
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
                  {c && <View style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#E5E7EB' }}>
                    <Text style={{ fontWeight: '700', color: C.primary }}>✓ Added · {c.adults} adults{c.children ? ` + ${c.children} children` : ''}</Text>
                    <Muted>{c.date} · {c.time}{c.stay ? ` · ${c.nights} night(s)` : ''}</Muted>
                    <Text style={{ fontWeight: '800', marginTop: 4 }}>{formatMoney(lineTotal(c, c.adults, c.children))} · Tap to edit</Text>
                  </View>}
                </View>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setSafetyItem(x)} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 9, borderTopWidth: 1, borderTopColor: '#E5E7EB' }}>
                  <Ionicons name="shield-checkmark-outline" size={17} color={C.primary} />
                  <Text style={{ color: C.primary, fontWeight: '700', marginLeft: 6 }}>Safety & visit info</Text>
                </TouchableOpacity>
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
            {items.map((c) => <Muted key={c.l.id}>{c.date} {c.time} · {c.l.title} · {c.adults} adults{c.children ? ` + ${c.children} children` : ''}{isStay(c) ? ` · ${c.nights} night(s)` : ''}</Muted>)}
            <Text style={{ fontWeight: '800', marginTop: 4 }}>Total so far: {formatMoney(itemsTotal)}</Text>
            {step === 1 && <>
              <Text style={{ fontWeight: '800', marginTop: 12 }}>Need pickup or return transport?</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 }}>
                {[['none', 'No pickup'], ['oneway', 'Pickup only'], ['return', 'Pickup + return']].map(([value, label]) => <Chip key={value} label={label} active={mode === value} onPress={() => setMode(value)} />)}
              </View>
              <Muted>Choose a pickup place, time, and vehicle on the pickup page. Transport cost is added to your total.</Muted>
            </>}
          </Card>}
          {problems.map((p, i) => <Text key={i} style={{ color: C.danger, fontWeight: '700', marginTop: 4 }}>⚠️ {p}</Text>)}
        </>}

        {/* ---------------- STEP 4: PICKUP ---------------- */}
        {step === 3 && <>
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

        {/* ---------------- STEP 5: REVIEW & PAY ---------------- */}
        {step === 4 && <>
          <Text style={{ fontSize: 18, fontWeight: '800', marginTop: 8 }}>Review and pay</Text>
          <Muted>{startDay} → {endDay} · {adults} adults{children ? ` · ${children} children` : ''} · {people} travelers</Muted>
          {items.map((c) => <Card key={c.l.id} style={{ marginHorizontal: 0 }}><View style={{ flexDirection: 'row' }}>
            <View style={{ flex: 1 }}><Text style={{ fontWeight: '700' }}>{c.l.title}</Text><Muted>{CAT_BADGE[c.l.category] || c.l.category} · {c.date} · {c.time}{isStay(c) ? ` · ${c.nights} night(s)` : ''}</Muted>
              <Muted>{c.adults} adults{c.children ? ` · ${c.children} children` : ''}</Muted>
              {c.items.map((p) => <Muted key={p.id}>{p.label} · {p.audience}</Muted>)}</View>
            <Text style={{ fontWeight: '800' }}>{formatMoney(lineTotal(c, c.adults, c.children))}</Text></View></Card>)}
          {mode !== 'none' && <Card style={{ marginHorizontal: 0 }}><View style={{ flexDirection: 'row' }}>
            <View style={{ flex: 1 }}><Text style={{ fontWeight: '700' }}>🚐 {isReturn ? 'Pickup and return' : 'Pickup only'} · {v?.name}</Text><Muted>{pickup?.label} · {pickupDay} {pickupTime}{isReturn ? ` · Return ${returnDay} ${returnTime}` : ''}</Muted></View>
            <Text style={{ fontWeight: '800' }}>{formatMoney(tprice)}</Text></View></Card>}
          <Card style={{ marginHorizontal: 0, backgroundColor: '#FFF8E6' }}>
            <Text style={{ fontWeight: '800' }}>About cancelling</Text>
            <Muted>The whole booking cannot be cancelled. You can cancel single items later in My trips; a {feePct}% cancellation fee applies to each item you cancel.</Muted></Card>
          <Card style={{ marginHorizontal: 0 }}>
            <Text style={{ fontWeight: '800' }}>Booking contact</Text>
            <Muted>Your booking details will be saved with this email address.</Muted>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 }}>
              {accountEmail ? <Chip label={`Use account email: ${accountEmail}`} active={useAccountEmail} onPress={() => setUseAccountEmail(true)} /> : null}
              <Chip label="Use a different email" active={!useAccountEmail} onPress={() => setUseAccountEmail(false)} />
            </View>
            {!useAccountEmail && <><Label>Contact email</Label><Input value={contactEmail} onChangeText={setContactEmail} placeholder="name@example.com" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" /></>}
            <Label>Contact phone number</Label><PhoneField country={profile?.country || ''} value={contactPhone} onChange={setContactPhone} />
          </Card>
        </>}
      </View>
    </ScrollView>
    <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: C.border,
      paddingTop: 10, paddingHorizontal: 14, paddingBottom: Math.max(insets.bottom, 12), elevation: 16, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: -2 } }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
        <View style={{ flex: 1 }}>
          <Muted>{people} travelers · {items.length} selected</Muted>
          <Text style={{ color: C.primary, fontSize: 20, fontWeight: '800' }}>{formatMoney(step >= 3 ? grand : itemsTotal)}</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row' }}>
        <Btn style={{ flex: 1, marginHorizontal: 4, marginVertical: 0 }} kind="ghost" title="Back" onPress={back} disabled={busy} />
        <Btn style={{ flex: 1, marginHorizontal: 4, marginVertical: 0 }} title={step === 4 ? (busy ? 'Please wait…' : `Pay ${formatMoney(grand)}`) : 'Continue'}
          onPress={step === 4 ? pay : next} disabled={busy} />
      </View>
    </View>
    <Modal visible={!!editingId} animationType="slide" transparent onRequestClose={() => { if (!editorLoading) closeEditor(false); }}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.38)' }}>
        <View style={{ maxHeight: '92%', backgroundColor: '#F6F7F5', borderTopLeftRadius: 22, borderTopRightRadius: 22, overflow: 'hidden' }}>
          <View style={{ backgroundColor: '#fff', paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border, flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ flex: 1, fontSize: 18, fontWeight: '800' }}>{editorItem?.l.title || 'Choose booking details'}</Text>
            <TouchableOpacity disabled={editorLoading} onPress={() => closeEditor(false)}><Text style={{ color: C.primary, fontWeight: '800', padding: 6 }}>Close</Text></TouchableOpacity>
          </View>
          {editorLoading || !editorItem ? <ActivityIndicator color={C.primary} size="large" style={{ margin: 40 }} /> : <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 12, paddingBottom: 20 }}>
            <Muted>{CAT_BADGE[editorItem.l.category] || editorItem.l.category} · {editorItem.l.location_name || editorItem.l.region}, {editorItem.l.country}</Muted>
            {!!editorItem.l.facilities?.length && <Muted style={{ marginTop: 4 }}>Amenities: {editorItem.l.facilities.join(' · ')}</Muted>}
            <Card style={{ marginHorizontal: 0 }}>
              <Text style={{ fontWeight: '800' }}>Date and travelers for this booking</Text>
              <Stepper label="Adults" value={editorItem.adults} onChange={(n) => setItemPeople(editingId, 'adults', n)} min={1} max={adults} />
              <Stepper label="Children" value={editorItem.children} onChange={(n) => setItemPeople(editingId, 'children', n)} min={0} max={children} />
              <DateField value={new Date(`${editorItem.date}T12:00:00`)} disabled={editorItem.fixed} suffix={editorItem.fixed ? ' (fixed date)' : ''}
                minimumDate={new Date(`${startDay}T00:00:00`)} maximumDate={new Date(`${endDay}T23:00:00`)} onChange={(d) => setField(editingId, { date: ymd(d) })} />
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                {editorItem.fixed ? <Text style={{ fontWeight: '700' }}>Fixed time · {editorItem.time}</Text> : <TimeField value={editorItem.time} onChange={(t) => setField(editingId, { time: t })} />}
              </View>
              {editorItem.stay && <Stepper label="Nights" value={editorItem.nights} onChange={(n) => setField(editingId, { nights: n })} min={1} max={30} />}
            </Card>
            {!!editorItem.options?.length && <Card style={{ marginHorizontal: 0 }}>
              <Text style={{ fontWeight: '800', marginBottom: 6 }}>{editorItem.stay ? 'Choose a room or stay option' : 'Choose the ticket or activity price'}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {editorItem.options.map((p) => <View key={p.id} style={{ marginBottom: 6 }}><Chip label={optLabel(p)} active={editorItem.items.some((i) => i.id === p.id)} onPress={() => pickPrice(editingId, p)} /></View>)}
              </View>
            </Card>}
            {!!editorItem.extras?.length && <Card style={{ marginHorizontal: 0 }}>
              <Text style={{ fontWeight: '800', marginBottom: 6 }}>On-site facilities and activities</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {editorItem.extras.map((p) => <View key={p.id} style={{ marginBottom: 6 }}><Chip label={`${editorItem.items.some((i) => i.id === p.id) ? '✓ ' : '+ '}${optLabel(p)}`} active={editorItem.items.some((i) => i.id === p.id)} onPress={() => pickPrice(editingId, p)} /></View>)}
              </View>
              {editorItem.items.filter((p) => editorItem.extras.some((extra) => extra.id === p.id) && p.description).map((p) => <Muted key={`detail-${p.id}`}>{p.label}: {p.description}</Muted>)}
            </Card>}
            <Card style={{ marginHorizontal: 0, backgroundColor: '#EAF3EE' }}>
              <Text style={{ fontWeight: '800' }}>Booking total</Text>
              <Text style={{ color: C.primary, fontSize: 22, fontWeight: '800', marginTop: 4 }}>{formatMoney(lineTotal(editorItem, editorItem.adults, editorItem.children))}</Text>
              <Muted>{editorItem.adults} adults{editorItem.children ? ` + ${editorItem.children} children` : ''}</Muted>
            </Card>
          </ScrollView>}
          <View style={{ flexDirection: 'row', backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: C.border, padding: 12 }}>
            {editorItem && <Btn style={{ flex: 1, marginHorizontal: 4, marginVertical: 0 }} kind="ghost" title="Remove" onPress={removeEditingItem} />}
            <Btn style={{ flex: 1, marginHorizontal: 4, marginVertical: 0 }} kind="ghost" title="Cancel" onPress={() => closeEditor(false)} disabled={editorLoading} />
            <Btn style={{ flex: 1, marginHorizontal: 4, marginVertical: 0 }} title={originalItem ? 'Save changes' : 'Add to trip'} onPress={() => closeEditor(true)} disabled={!editorItem || editorLoading} />
          </View>
        </View>
      </View>
    </Modal>
    <Modal visible={!!safetyItem} animationType="fade" transparent onRequestClose={() => setSafetyItem(null)}>
      <View style={{ flex: 1, justifyContent: 'center', padding: 20, backgroundColor: 'rgba(0,0,0,0.42)' }}>
        <View style={{ maxHeight: '80%', backgroundColor: '#fff', borderRadius: 18, overflow: 'hidden' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: C.border }}>
            <Ionicons name="shield-checkmark-outline" size={22} color={C.primary} />
            <Text style={{ flex: 1, fontSize: 18, fontWeight: '800', marginLeft: 8 }}>Safety & visit info</Text>
            <TouchableOpacity onPress={() => setSafetyItem(null)}><Text style={{ color: C.primary, fontWeight: '800', padding: 6 }}>Close</Text></TouchableOpacity>
          </View>
          {safetyItem && <ScrollView contentContainerStyle={{ padding: 16 }}>
            <Text style={{ fontWeight: '800', fontSize: 16 }}>{safetyItem.title}</Text>
            <Muted style={{ marginTop: 3 }}>{safetyItem.location_name || safetyItem.region}{safetyItem.country ? `, ${safetyItem.country}` : ''}</Muted>
            <Text style={{ fontWeight: '800', marginTop: 16, marginBottom: 6 }}>
              {STAY.includes(safetyItem.category) || safetyItem.accommodation_available ? 'Accommodation' : 'Activity'}
            </Text>
            {(STAY.includes(safetyItem.category) || safetyItem.accommodation_available ? SAFETY_NOTES.accommodation : SAFETY_NOTES.activity)
              .map((note) => <Muted key={note} style={{ marginBottom: 7 }}>• {note}</Muted>)}
            <Text style={{ fontWeight: '800', marginTop: 12, marginBottom: 6 }}>Facilities</Text>
            <Muted>{safetyItem.facilities?.length ? safetyItem.facilities.join(' · ') : 'Ask the provider which facilities are available during your visit.'}</Muted>
            {SAFETY_NOTES.facility.map((note) => <Muted key={note} style={{ marginTop: 7 }}>• {note}</Muted>)}
            <Muted style={{ marginTop: 16 }}>General reminders only; this place has not been safety-verified, and no safe zone is marked on the map. Contact the provider for current information.</Muted>
          </ScrollView>}
        </View>
      </View>
    </Modal>
  </View>
  );
}