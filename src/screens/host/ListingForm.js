import React, { useEffect, useState } from 'react';
import { ScrollView, View, Text, Alert, Image, Switch, ActivityIndicator, TouchableOpacity } from 'react-native';
import { getPosition } from '../../lib/geo';
import { ymd } from '../../lib/pricing';
import TimeField from '../../components/TimeField';
import { CONFIG } from '../../lib/config';
import PickerSheet from '../../components/PickerSheet';
import { pickLocation } from '../../lib/pickBus';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import { pickAndUploadPhotos } from '../../lib/uploadMany';
import { pickAndUploadListingVideo } from '../../lib/uploadVideo';
import { C } from '../../lib/theme';
import { Btn, Card, Input, Label, Chip, Muted } from '../../components/ui';
import CountryPicker from '../../components/CountryPicker';
import SelectField from '../../components/SelectField';
import PhoneField from '../../components/PhoneField';
import { DAYS, DAY_NAMES, AMENITIES } from '../../lib/categories';

const AUD = ['adult', 'child', 'foreigner', 'resident', 'group', 'vip', 'vvip', 'regular'];
const KINDS = ['entrance', 'facility', 'activity', 'ticket', 'room', 'guide'];
const UNITS = ['per_person', 'per_group', 'per_night', 'per_day'];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_PHOTOS = 6;
const MAX_EXTRA_PHOTOS = 4;

// Remove rows that share the same id, so React never sees two children with the same key.
const uniqById = (arr) => { const seen = new Set(); return (arr || []).filter((r) => r && !seen.has(r.id) && seen.add(r.id)); };

// what each kind of host may list.
const CAT_OPTS = {
  hotel: ['hotel', 'resort', 'event'],
  campsite: ['campsite', 'event'],
  attraction: ['attraction', 'event'],
  activity: ['airbnb', 'activity', 'guide', 'event'],
};
const CAT_LABEL = { hotel: 'Hotel', resort: 'Resort', campsite: 'Campsite', attraction: 'Attraction', airbnb: 'Airbnb', activity: 'Activity', event: 'Event', guide: 'Guided tour / guide' };
const PROV_LABEL = { hotel: 'Hotel / Resort', campsite: 'Campsite', attraction: 'Attraction', activity: 'Company / business' };

// The "main" price each category must have
const MAIN = { hotel: 'room', resort: 'room', campsite: 'room', airbnb: 'room', guide: 'guide' }; // everything else = entrance
const MAIN_TXT = {
  entrance: { title: 'Entrance fee', hint: 'What guests pay to enter, in USD. Add more rows for child, foreigner, resident, etc.' },
  room: { title: 'Room price', hint: 'Price per night in USD. Add a row for each room type.' },
  guide: { title: 'Guide fee', hint: 'What guests pay for the guide, in USD.' },
};
const UNIT_FOR = { room: 'per_night', guide: 'per_day' };

const blank = (kind, price = '0') => ({ kind, label: '', audience: 'adult', unit: UNIT_FOR[kind] || 'per_person', price, is_optional: kind === 'facility' || kind === 'activity', description: '', photo_url: null, photo_urls: [] });

const hoursFrom = (l) => Object.fromEntries(DAYS.map((d) => [d, l?.opening_hours?.[d] ?? (l ? (l.open_days?.includes(d) ? { open: l.open_time?.slice(0, 5) || '08:00', close: l.close_time?.slice(0, 5) || '18:00' } : { closed: true }) : { open: '08:00', close: '18:00' })]));

export default function ListingForm({ route, navigation }) {
  const { session } = useAuth(); const { listing, providers: rawProviders = [] } = route.params || {};
  const providers = uniqById(rawProviders);
  const approved = providers.filter((p) => p.verification === 'approved');
  const [providerId, setProviderId] = useState(listing?.provider_id || approved[0]?.id);
  const provider = providers.find((p) => p.id === providerId);
  const catLocked = !!listing; // category can never be changed once the listing exists
  const old = listing?.facilities || [];

  const allOpts = CAT_OPTS[provider?.category] || [];
  const catOptions = allOpts;

  const [f, setF] = useState({ category: listing?.category || allOpts[0] || 'hotel', title: listing?.title || '', description: listing?.description || '',
    country: listing?.country || provider?.country || '', region: listing?.region || provider?.region || '', location_name: listing?.location_name || '',
    lat: listing?.lat, lng: listing?.lng, google_place_id: listing?.google_place_id, hours: hoursFrom(listing),
    entrance_fee_free: !!listing?.entrance_fee_free,
    accommodation_available: listing
      ? (listing.accommodation_available ?? ['hotel', 'resort', 'campsite', 'airbnb'].includes(listing.category))
      : ['hotel', 'resort', 'campsite', 'airbnb'].includes(allOpts[0] || 'hotel'),
    amenities: old.filter((a) => AMENITIES.includes(a)), other: old.filter((a) => !AMENITIES.includes(a)).join(', '),
    photos: [...new Set(listing?.photos || [])].slice(0, MAX_PHOTOS), event_date: listing?.event_date, schedule_type: listing?.schedule_type || 'always', starts_on: listing?.starts_on || '', ends_on: listing?.ends_on || '',
    tour_time: listing?.open_time ? listing.open_time.slice(0, 5) : '08:00', one_date: listing?.event_date ? ymd(new Date(listing.event_date)) : '',
    one_time: listing?.event_date ? `${String(new Date(listing.event_date).getHours()).padStart(2, '0')}:${String(new Date(listing.event_date).getMinutes()).padStart(2, '0')}` : '18:00', daily_limit: listing?.daily_limit ? String(listing.daily_limit) : '', pickup_times: listing?.pickup_times || [] });

  const [prices, setPrices] = useState([]); const [pricesLoaded, setPricesLoaded] = useState(!listing);
  const [newPT, setNewPT] = useState('08:00');
  const [contact, setContact] = useState({ email: provider?.contact_email || '', phone: provider?.contact_phone || '', whatsapp: provider?.contact_whatsapp || '' });
  const [placeQ, setPlaceQ] = useState(''); const [results, setResults] = useState([]); const [dpick, setDpick] = useState(null);
  const [regions, setRegions] = useState([]); const [sameWa, setSameWa] = useState(true);
  const [busy, setBusy] = useState(null); // text while general photos are picking/uploading
  const [rowBusy, setRowBusy] = useState(null); // index of the price row whose photo is uploading
  const [videoUrl, setVideoUrl] = useState(listing?.video_url || null);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const setCategory = (category) => setF((x) => ({ ...x, category, accommodation_available: ['hotel', 'resort', 'campsite', 'airbnb'].includes(category) }));

  const mainKind = MAIN[f.category] || 'entrance';
  const canBeFree = mainKind === 'entrance';
  const isFree = canBeFree && f.entrance_fee_free;

  useEffect(() => { if (!f.country) return setRegions([]); supabase.from('country_divisions').select('name, countries!inner(name)').eq('countries.name', f.country).eq('active', true).order('name').then(({ data }) => setRegions([...new Set((data || []).map((r) => r.name))])); }, [f.country]);
  useEffect(() => { if (!listing) return;
    supabase.from('listing_prices').select('*').eq('listing_id', listing.id).then(({ data }) => {
      setPrices(uniqById(data).map((price) => ({
        ...price,
        photo_urls: price.photo_urls?.length ? price.photo_urls.slice(0, MAX_EXTRA_PHOTOS) : (price.photo_url ? [price.photo_url] : []),
      })));
      setPricesLoaded(true);
    });
    supabase.from('listing_contacts').select('*').eq('listing_id', listing.id).maybeSingle().then(({ data }) => data && setContact(data)); }, []);

  // always keep one (empty) main price row ready so the host has to fill in the entrance / room / guide price
  useEffect(() => {
    if (!pricesLoaded) return;
    setPrices((p) => {
      const kept = p.filter((x) => !(x.seed && x.kind !== mainKind)); // drop untouched rows of the previous category
      if (isFree || kept.some((x) => x.kind === mainKind)) return kept;
      return [{ ...blank(mainKind, ''), seed: true }, ...kept];
    });
  }, [mainKind, isFree, pricesLoaded]);

  const searchPlace = async () => {
    const r = await fetch(`https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(placeQ)}&key=${CONFIG.googleKey}`).then((x) => x.json());
    const seen = new Set();
    setResults((r.results || []).filter((p) => !seen.has(p.place_id) && seen.add(p.place_id)).slice(0, 5));
  };
  const pick = (p) => { setF((x) => ({ ...x, location_name: p.name + ', ' + (p.formatted_address || ''), lat: p.geometry.location.lat, lng: p.geometry.location.lng, google_place_id: p.place_id })); setResults([]); };
  const here = async () => { const p = await getPosition(); if (p) setF((x) => ({ ...x, lat: p.lat, lng: p.lng })); };
  const onMap = async () => { const r = await pickLocation(navigation, 'Choose the place on the map'); if (r) setF((x) => ({ ...x, lat: r.lat, lng: r.lng, location_name: r.label })); };

  const setDay = (d, patch) => setF((x) => ({ ...x, hours: { ...x.hours, [d]: patch } }));
  const sched = f.category === 'event' ? 'one_time' : ['activity', 'guide'].includes(f.category) ? f.schedule_type : 'always'; const showHours = !['tour', 'one_time'].includes(sched);
  const copyToAll = () => { const first = DAYS.map((d) => f.hours[d]).find((h) => !h.closed); if (first) setF((x) => ({ ...x, hours: Object.fromEntries(DAYS.map((d) => [d, { ...first }])) })); };
  const toggleAmenity = (a) => set('amenities')(f.amenities.includes(a) ? f.amenities.filter((x) => x !== a) : [...f.amenities, a]);

  const addPrice = (kind) => setPrices((p) => [...p, blank(kind)]);
  const addMainPrice = () => setPrices((p) => {
    const used = p.filter((x) => x.kind === mainKind).map((x) => x.audience);
    return [...p, { ...blank(mainKind, ''), audience: AUD.find((a) => !used.includes(a)) || 'adult' }];
  });
  const updPrice = (i, k, v) => setPrices((p) => p.map((x, j) => (j === i
    ? { ...x, [k]: v, ...(k === 'photo_urls' ? { photo_url: v[0] || null } : {}), seed: false }
    : x)));
  const cycle = (arr, cur) => arr[(arr.indexOf(cur) + 1) % arr.length];
  const needsDetails = (k) => k === 'facility' || k === 'activity';

  // ---- photos: several at once, with a visible loading state ----
  const addPhotos = async () => {
    if (busy) return;
    const room = MAX_PHOTOS - f.photos.length;
    if (room <= 0) return Alert.alert('Photos', `You can add up to ${MAX_PHOTOS} photos.`);
    setBusy('Opening your gallery…');
    try {
      const urls = await pickAndUploadPhotos(session.user.id, {
        limit: room,
        onStart: (n) => setBusy(`Processing and uploading 0 of ${n}…`),
        onProgress: (d, n) => setBusy(`Processing and uploading ${d} of ${n}…`),
      });
      // the same photo can never be added twice
      if (urls.length) setF((x) => ({ ...x, photos: [...new Set([...x.photos, ...urls])].slice(0, MAX_PHOTOS) }));
    } catch (e) { Alert.alert('Upload failed', e.message); } finally { setBusy(null); }
  };
  const addRowPhotos = async (i) => {
    if (rowBusy !== null) return;
    const current = prices[i]?.photo_urls || (prices[i]?.photo_url ? [prices[i].photo_url] : []);
    const room = MAX_EXTRA_PHOTOS - current.length;
    if (room <= 0) return Alert.alert('Photos', `Each facility or activity can have up to ${MAX_EXTRA_PHOTOS} photos.`);
    setRowBusy(i);
    try {
      const urls = await pickAndUploadPhotos(session.user.id, { limit: room });
      if (urls.length) updPrice(i, 'photo_urls', [...new Set([...current, ...urls])].slice(0, MAX_EXTRA_PHOTOS));
    }
    catch (e) { Alert.alert('Upload failed', e.message); } finally { setRowBusy(null); }
  };
  const addVideo = async () => {
    if (busy) return;
    setBusy('Opening your video library…');
    try {
      const url = await pickAndUploadListingVideo(session.user.id, setBusy);
      if (url) setVideoUrl(url);
    } catch (e) { Alert.alert('Video upload failed', e.message); } finally { setBusy(null); }
  };

  const save = async () => {
    if (!providerId) return Alert.alert('Your provider registration must be approved first');
    if (!catOptions.includes(f.category)) return Alert.alert('Category', 'Your registration cannot list this type.');
    if (!f.title || !f.lat) return Alert.alert('Title and a map location are required');
    if (!isFree && !prices.some((p) => p.kind === mainKind && Number(p.price) > 0)) return Alert.alert(MAIN_TXT[mainKind].title, `Enter the ${MAIN_TXT[mainKind].title.toLowerCase()} (more than 0)${canBeFree ? ', or switch on "Free entrance"' : ''}.`);
    if (f.accommodation_available && mainKind !== 'room' && !prices.some((p) => p.kind === 'room' && Number(p.price) > 0))
      return Alert.alert('Accommodation price', 'Add at least one room or stay price per night.');
    if (f.accommodation_available && (!Number.isInteger(Number(f.daily_limit)) || Number(f.daily_limit) < 1))
      return Alert.alert('Accommodation availability', 'Enter the maximum number of guests you can host per day so booked dates can be filtered.');
    for (const d of DAYS) { const h = f.hours[d]; if (!h.closed && (!TIME.test(h.open || '') || !TIME.test(h.close || '') || h.close <= h.open)) return Alert.alert('Opening hours', `${DAY_NAMES[d]}: use HH:MM (24h) and closing after opening, or mark it closed.`); }
    const openDays = DAYS.filter((d) => !f.hours[d].closed); if (!openDays.length) return Alert.alert('Opening hours', 'Open at least one day.');
    for (const p of prices) if (needsDetails(p.kind) && (!p.label || !p.description || !(p.photo_urls?.length || p.photo_url))) return Alert.alert('Facilities & activities', 'Every facility and activity needs a name, a description and at least one photo.');
    const first = f.hours[openDays[0]];
    const amenities = [...f.amenities, ...f.other.split(',').map((s) => s.trim()).filter(Boolean)];
    if (sched === 'range' || sched === 'tour') {
      if (!f.starts_on || !f.ends_on) return Alert.alert('Dates', 'Choose the start date and the end date.');
      if (f.ends_on < f.starts_on) return Alert.alert('Dates', 'The end date must not be before the start date.');
      if (f.ends_on < ymd(new Date())) return Alert.alert('Dates', 'The end date is already in the past.');
      if (sched === 'tour' && !TIME.test(f.tour_time)) return Alert.alert('Departure time', 'Choose the departure time.');
    }
    let eventIso = null;
    if (sched === 'one_time') { if (!f.one_date) return Alert.alert('Date', 'Choose the date.'); const at = new Date(`${f.one_date}T${f.one_time}:00`); if (at.getTime() < Date.now()) return Alert.alert('Date', 'Choose a date and time in the future.'); eventIso = at.toISOString(); }
    const row = { provider_id: providerId, owner_id: session.user.id, city: provider?.city || listing?.city || null, category: f.category, title: f.title, description: f.description, country: f.country, region: f.region, location_name: f.location_name, lat: f.lat, lng: f.lng, google_place_id: f.google_place_id,
      opening_hours: f.hours, open_days: openDays, open_time: sched === 'tour' ? f.tour_time : first.open, close_time: first.close, entrance_fee_free: isFree, accommodation_available: f.accommodation_available, facilities: amenities, photos: f.photos, video_url: videoUrl, event_date: eventIso, schedule_type: sched, starts_on: (sched === 'range' || sched === 'tour') ? f.starts_on : null, ends_on: (sched === 'range' || sched === 'tour') ? f.ends_on : null,
      daily_limit: f.daily_limit ? Number(f.daily_limit) : null, pickup_times: ['guide', 'activity'].includes(f.category) ? f.pickup_times : [], status: ['approved', 'hidden'].includes(listing?.status) ? listing.status : 'pending', admin_note: null };
    const q = listing ? supabase.from('listings').update(row).eq('id', listing.id).select().single() : supabase.from('listings').insert(row).select().single();
    const { data, error } = await q; if (error) return Alert.alert('Cannot save', error.message);
    if (listing) await supabase.from('listing_prices').delete().eq('listing_id', data.id);
    const toSave = prices.filter((p) => !(isFree && p.kind === mainKind));
    if (toSave.length) {
      const { error: pricesError } = await supabase.from('listing_prices').insert(toSave.map((p) => ({
        listing_id: data.id, kind: p.kind, label: p.label || p.kind, audience: p.audience, unit: p.unit, price: Number(p.price) || 0, is_optional: p.is_optional,
        description: needsDetails(p.kind) ? p.description : null,
        photo_url: needsDetails(p.kind) ? (p.photo_urls?.[0] || p.photo_url || null) : null,
        photo_urls: needsDetails(p.kind) ? (p.photo_urls?.length ? p.photo_urls.slice(0, MAX_EXTRA_PHOTOS) : (p.photo_url ? [p.photo_url] : [])) : [],
      })));
      if (pricesError) return Alert.alert('Cannot save prices', pricesError.message);
    }
    await supabase.from('listing_contacts').upsert({ listing_id: data.id, ...contact, whatsapp: sameWa ? contact.phone : contact.whatsapp });
    Alert.alert(listing?.status === 'approved' ? 'Saved' : 'Submitted', listing?.status === 'approved' ? 'Your changes are live.' : 'Admin will verify this listing before it goes live.'); navigation.goBack();
  };

  const providerNote = !provider ? null
    : provider.category === 'hotel' ? 'Hotel / resort hosts can list multiple hotels, resorts, and events.'
    : provider.category === 'campsite' ? 'Campsite hosts can list multiple campsites and events.'
    : provider.category === 'attraction' ? 'Attraction hosts can list multiple attractions and events.'
    : 'Company: list multiple Airbnbs, activities, guided tours, trips, and events.';

  const renderMainRow = (p, i, count) => (
    <View key={i} style={{ marginBottom: 10 }}>
      {mainKind === 'room' && <Input placeholder="Room name (e.g. Standard room, Family suite)" value={p.label} onChangeText={(v) => updPrice(i, 'label', v)} />}
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Chip label={p.audience} onPress={() => updPrice(i, 'audience', cycle(AUD, p.audience))} />
        <Chip label={p.unit.replace('_', ' ')} onPress={() => updPrice(i, 'unit', cycle(UNITS, p.unit))} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ fontWeight: '800', color: C.ink, marginRight: 6 }}>$</Text>
        <Input style={{ flex: 1 }} placeholder="0.00" keyboardType="decimal-pad" value={String(p.price)} onChangeText={(v) => updPrice(i, 'price', v)} />
        {count > 1 && <Btn style={{ marginLeft: 8 }} kind="danger" title="✕" onPress={() => setPrices((x) => x.filter((_, j) => j !== i))} />}
      </View>
    </View>
  );

  const mainRows = prices.map((p, i) => ({ p, i })).filter(({ p }) => p.kind === mainKind);
  const extraRows = prices.map((p, i) => ({ p, i })).filter(({ p }) => p.kind !== mainKind);

  return (
    <ScrollView contentContainerStyle={{ padding: 12 }} keyboardShouldPersistTaps="handled">
      {!approved.length && <Text style={{ color: '#D64545' }}>No approved provider profile yet.</Text>}
      {!listing && approved.length > 1 && <><Label>Hosting as</Label><View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{approved.map((p) => <View key={p.id} style={{ marginBottom: 6 }}><Chip label={`${PROV_LABEL[p.category] || p.category} · ${p.business_name}`} active={providerId === p.id} onPress={() => { const category = (CAT_OPTS[p.category] || [])[0] || f.category; setProviderId(p.id); setF((x) => ({ ...x, category, accommodation_available: ['hotel', 'resort', 'campsite', 'airbnb'].includes(category) })); }} /></View>)}</View></>}
      {providerNote && <Muted>{providerNote}</Muted>}

      <Label>What are you listing?</Label>
      {catLocked
        ? <><View style={{ flexDirection: 'row' }}><Chip label={CAT_LABEL[f.category] || f.category} active /></View><Muted>🔒 The type cannot be changed after the listing is created.</Muted></>
        : catOptions.length
          ? <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{catOptions.map((c) => <View key={c} style={{ marginBottom: 6 }}><Chip label={CAT_LABEL[c] || c} active={f.category === c} onPress={() => setCategory(c)} /></View>)}</View>
          : <Muted>You have already listed everything this registration allows.</Muted>}
      <Label>{f.category === 'resort' ? 'Resort name' : f.category === 'hotel' ? 'Hotel name' : 'Title'}</Label><Input value={f.title} onChangeText={set('title')} />
      <Label>Description</Label><Input multiline value={f.description} onChangeText={set('description')} />
      <Label>Country</Label><CountryPicker value={f.country} onChange={set('country')} />
      <Label>Region</Label>{regions.length ? <SelectField value={f.region} options={regions.map((r) => ({ value: r, label: r }))} onChange={set('region')} placeholder="Select region" title="Region" /> : <Input value={f.region} onChangeText={set('region')} />}

      <Label>Location (Google Places)</Label>
      <Input value={placeQ} onChangeText={setPlaceQ} placeholder="Search place name on Google" /><Btn kind="ghost" title="Search Google Places" onPress={searchPlace} />
      {results.map((r) => <Card key={r.place_id} onPress={() => pick(r)} style={{ marginHorizontal: 0 }}><Text>{r.name}</Text><Muted>{r.formatted_address}</Muted></Card>)}
      <Btn kind="ghost" title="🗺️ Choose on map (search or tap)" onPress={onMap} />
      <Btn kind="ghost" title="Use my current location" onPress={here} />
      <Muted>{f.lat ? `📍 ${f.location_name || ''} (${f.lat.toFixed(4)}, ${f.lng.toFixed(4)})` : 'No location chosen'}</Muted>

      {showHours && <>
      <Label>Opening hours (24h, HH:MM)</Label>
      {DAYS.map((d) => { const h = f.hours[d]; return (
        <View key={d} style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 2 }}>
          <Text style={{ width: 44, fontWeight: '600' }}>{d.toUpperCase()}</Text>
          <Switch value={!h.closed} onValueChange={(on) => setDay(d, on ? { open: '08:00', close: '18:00' } : { closed: true })} />
          {h.closed ? <Muted style={{ marginLeft: 12 }}>Closed</Muted> : <>
            <Input style={{ flex: 1, marginHorizontal: 6 }} value={h.open} onChangeText={(v) => setDay(d, { ...h, open: v })} placeholder="08:00" />
            <Input style={{ flex: 1 }} value={h.close} onChangeText={(v) => setDay(d, { ...h, close: v })} placeholder="18:00" /></>}
        </View>); })}
      <Btn kind="ghost" title="Copy first open day to every day" onPress={copyToAll} />
      </>}

      {['activity', 'guide', 'event'].includes(f.category) && (<>
        <Label>When does it happen?</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {(f.category === 'event' ? [['one_time', 'Event date & time']] : [['always', 'Ongoing (no end date)'], ['range', 'Activity with an end date'], ['tour', 'Tour / trip with start & end date'], ['one_time', 'Happens once (date & time)']]).map(([k, l]) => <View key={k} style={{ marginBottom: 6 }}><Chip label={l} active={sched === k} onPress={() => set('schedule_type')(k)} /></View>)}</View>
        {(sched === 'range' || sched === 'tour') && <>
          <Btn kind="ghost" title={`📅 Starts: ${f.starts_on || 'pick a date'}`} onPress={() => setDpick('start')} />
          <Btn kind="ghost" title={`🏁 Ends: ${f.ends_on || 'pick a date'}`} onPress={() => setDpick('end')} />
          {sched === 'tour' && <TimeField label="Departure time" value={f.tour_time} onChange={set('tour_time')} />}
          <Muted>{sched === 'tour' ? 'Guests book the whole trip from the start date to the end date.' : 'Guests can book any day from the start date until the end date, during the opening hours.'}</Muted></>}
        {sched === 'one_time' && <>
          <Btn kind="ghost" title={`📅 Date: ${f.one_date || 'pick a date'}`} onPress={() => setDpick('one')} />
          <TimeField label="Time" value={f.one_time} onChange={set('one_time')} /></>}
        <PickerSheet visible={!!dpick} mode="date" value={new Date(((dpick === 'start' ? f.starts_on : dpick === 'end' ? (f.ends_on || f.starts_on) : f.one_date) || ymd(new Date())) + 'T12:00:00')}
          minimumDate={dpick === 'end' && f.starts_on ? new Date(f.starts_on + 'T00:00:00') : new Date()}
          onCancel={() => setDpick(null)} onDone={(d) => { const w = dpick; setDpick(null); set(w === 'start' ? 'starts_on' : w === 'end' ? 'ends_on' : 'one_date')(ymd(d)); }} />
      </>)}

      {/* ---------- main price: entrance / room / guide ---------- */}
      <Label>{MAIN_TXT[mainKind].title}</Label>
      <Card style={{ marginHorizontal: 0 }}>
        {canBeFree && <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}><Text style={{ fontWeight: '700' }}>Free entrance</Text><Switch value={f.entrance_fee_free} onValueChange={set('entrance_fee_free')} /></View>}
        {isFree
          ? <Muted>Guests get in for free.</Muted>
          : <>
              <Muted>{MAIN_TXT[mainKind].hint}</Muted>
              <View style={{ height: 8 }} />
              {mainRows.map(({ p, i }) => renderMainRow(p, i, mainRows.length))}
              <Btn kind="ghost" title={mainKind === 'room' ? '＋ Add another room type' : '＋ Add another price'} onPress={addMainPrice} />
            </>}
      </Card>

      <Label>Daily limit (max guests per day{f.accommodation_available ? ', required for accommodation' : ', empty = unlimited'})</Label><Input keyboardType="number-pad" value={f.daily_limit} onChangeText={set('daily_limit')} />

      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}>
        <Text style={{ flex: 1, fontWeight: '700' }}>Overnight accommodation is available here</Text>
        <Switch value={f.accommodation_available} onValueChange={set('accommodation_available')} disabled={['hotel', 'resort', 'campsite', 'airbnb'].includes(f.category)} />
      </View>
      {f.accommodation_available && mainKind !== 'room' && <Muted>Add a room price under Facilities, activities and extra prices. It will appear in the custom trip accommodation cards.</Muted>}

      <Label>Amenities (choose from the list)</Label>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{AMENITIES.map((a) => <View key={a} style={{ marginBottom: 6 }}><Chip label={a} active={f.amenities.includes(a)} onPress={() => toggleAmenity(a)} /></View>)}</View>
      <Label>Other amenities (comma separated)</Label><Input value={f.other} onChangeText={set('other')} placeholder="e.g. Rooftop bar, Bicycle hire" />

      {['guide', 'activity'].includes(f.category) && <>
        <Label>Fixed pickup times (optional)</Label>
        <Muted>Add two or more times if guests are picked up at set times (for example 06:00 and 09:00). Guests choose one. Leave empty to let guests choose any time.</Muted>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{f.pickup_times.map((t) => <View key={t} style={{ marginBottom: 6 }}><Chip label={`🕒 ${t}  ✕`} onPress={() => set('pickup_times')(f.pickup_times.filter((x) => x !== t))} /></View>)}</View>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}><View style={{ flex: 1 }}><TimeField label="New time" value={newPT} onChange={setNewPT} /></View><Btn style={{ marginLeft: 8 }} kind="ghost" title="＋ Add" onPress={() => { if (!f.pickup_times.includes(newPT)) set('pickup_times')([...f.pickup_times, newPT].sort()); }} /></View>
      </>}

      {/* ---------- photos: multi-select ---------- */}
      <Label>Photos ({f.photos.length}/{MAX_PHOTOS})</Label>
      <Muted>Select several photos at once. The first one is the cover photo.</Muted>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 6 }}>
        {f.photos.map((u, idx) => (
          <View key={`${u}-${idx}`} style={{ marginRight: 8 }}>
            <Image source={{ uri: u }} style={{ width: 132, height: 88, borderRadius: 12 }} />
            {idx === 0 && <View style={{ position: 'absolute', left: 6, bottom: 6, backgroundColor: C.ink, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}><Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>Cover</Text></View>}
            <TouchableOpacity onPress={() => set('photos')(f.photos.filter((_, j) => j !== idx))} style={{ position: 'absolute', right: 4, top: 4, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(16,34,46,0.8)', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>✕</Text>
            </TouchableOpacity>
          </View>
        ))}
        {busy && <View style={{ width: 132, height: 88, borderRadius: 12, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={C.primary} /></View>}
      </ScrollView>
      {busy && <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.primarySoft, borderRadius: 12, padding: 10, marginBottom: 6 }}><ActivityIndicator color={C.primary} /><Text style={{ marginLeft: 10, color: C.primary, fontWeight: '700' }}>{busy}</Text></View>}
      <Btn kind="ghost" disabled={!!busy} title={busy ? 'Please wait…' : '＋ Add photos'} onPress={addPhotos} />

      <Label>Place video (optional)</Label>
      <Muted>Upload one video up to 30 seconds. Videos are not used for facilities or activities.</Muted>
      {videoUrl && <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.primarySoft, borderRadius: 10, padding: 10 }}>
        <Text style={{ flex: 1, color: C.primary, fontWeight: '700' }}>Video uploaded</Text>
        <Btn kind="danger" title="Remove" onPress={() => setVideoUrl(null)} />
      </View>}
      <Btn kind="ghost" disabled={!!busy} title={busy ? 'Please wait…' : videoUrl ? 'Change video' : '＋ Add video'} onPress={addVideo} />

      {/* ---------- other prices, facilities, activities ---------- */}
      <Label>Facilities, activities and extra prices</Label>
      <Muted>Facilities and activities need a description and 1–4 photos each.</Muted>
      {extraRows.map(({ p, i }) => (
        <Card key={i} style={{ marginHorizontal: 0 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            <Chip label={p.kind} onPress={() => updPrice(i, 'kind', cycle(KINDS, p.kind))} /><Chip label={p.audience} onPress={() => updPrice(i, 'audience', cycle(AUD, p.audience))} />
            <Chip label={p.unit.replace('_', ' ')} onPress={() => updPrice(i, 'unit', cycle(UNITS, p.unit))} /><Chip label={p.is_optional ? 'optional' : 'required'} onPress={() => updPrice(i, 'is_optional', !p.is_optional)} /></View>
          <Input placeholder={needsDetails(p.kind) ? 'Name (e.g. Boat ride, Spa, Game drive)' : p.kind === 'room' ? 'Accommodation name (e.g. lodge, family room, tent)' : 'Label (e.g. Parking, Camera pass)'} value={p.label} onChangeText={(v) => updPrice(i, 'label', v)} />
          {needsDetails(p.kind) && <>
            <Input multiline placeholder="Details: what is included, duration, what to bring" value={p.description || ''} onChangeText={(v) => updPrice(i, 'description', v)} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 6 }}>
              {(p.photo_urls?.length ? p.photo_urls : (p.photo_url ? [p.photo_url] : [])).slice(0, MAX_EXTRA_PHOTOS).map((url, photoIndex) => (
                <View key={`${url}-${photoIndex}`} style={{ marginRight: 8 }}>
                  <Image source={{ uri: url }} style={{ width: 120, height: 80, borderRadius: 10 }} />
                  <TouchableOpacity
                    onPress={() => updPrice(i, 'photo_urls', (p.photo_urls?.length ? p.photo_urls : [p.photo_url]).filter((_, j) => j !== photoIndex))}
                    style={{ position: 'absolute', right: 4, top: 4, width: 24, height: 24, borderRadius: 12, backgroundColor: 'rgba(16,34,46,0.8)', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))}
              {rowBusy === i && <View style={{ width: 120, height: 80, borderRadius: 10, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={C.primary} /></View>}
            </ScrollView>
            <Btn
              kind="ghost"
              disabled={rowBusy !== null || (p.photo_urls?.length || (p.photo_url ? 1 : 0)) >= MAX_EXTRA_PHOTOS}
              title={rowBusy === i ? 'Uploading…' : `＋ Add photos (${p.photo_urls?.length || (p.photo_url ? 1 : 0)}/${MAX_EXTRA_PHOTOS})`}
              onPress={() => addRowPhotos(i)}
            />
          </>}
          <Input placeholder="Price USD (0 = free)" keyboardType="decimal-pad" value={String(p.price)} onChangeText={(v) => updPrice(i, 'price', v)} />
          <Btn kind="danger" title="Remove" onPress={() => setPrices((x) => x.filter((_, j) => j !== i))} /></Card>))}
      <View style={{ flexDirection: 'row' }}>
        <Btn style={{ flex: 1, marginRight: 4 }} kind="ghost" title="＋ Price" onPress={() => addPrice('ticket')} />
        <Btn style={{ flex: 1, marginHorizontal: 2 }} kind="ghost" title="＋ Facility" onPress={() => addPrice('facility')} />
        <Btn style={{ flex: 1, marginLeft: 4 }} kind="ghost" title="＋ Activity" onPress={() => addPrice('activity')} />
      </View>
      {f.accommodation_available && mainKind !== 'room' && <Btn kind="ghost" title="＋ Accommodation / room price" onPress={() => addPrice('room')} />}

      <Label>Contact (hidden until guest books or subscribes)</Label>
      <Input placeholder="Email" autoCapitalize="none" value={contact.email || ''} onChangeText={(v) => setContact({ ...contact, email: v })} />
      <PhoneField country={f.country} value={contact.phone || ''} onChange={(v) => setContact((c) => ({ ...c, phone: v }))} />
      <View style={{ flexDirection: 'row', alignItems: 'center' }}><Text style={{ flex: 1 }}>WhatsApp is the same number</Text><Switch value={sameWa} onValueChange={setSameWa} /></View>
      {!sameWa && <PhoneField country={f.country} value={contact.whatsapp || ''} onChange={(v) => setContact((c) => ({ ...c, whatsapp: v }))} />}
      <Btn title={listing ? (listing.status === 'approved' ? 'Save changes' : 'Resubmit for review') : 'Submit for review'} onPress={save} />
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}