import React, { useEffect, useState } from 'react';
import { ScrollView, View, Text, Alert, Image, Switch } from 'react-native';
import { getPosition } from '../../lib/geo';
import { ymd } from '../../lib/pricing';
import TimeField from '../../components/TimeField';
import { CONFIG } from '../../lib/config';
import PickerSheet from '../../components/PickerSheet';
import { pickLocation } from '../../lib/pickBus';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import { pickAndUploadPhoto } from '../../lib/upload';
import { Btn, Card, Input, Label, Chip, Muted } from '../../components/ui';
import CountryPicker from '../../components/CountryPicker';
import SelectField from '../../components/SelectField';
import PhoneField from '../../components/PhoneField';
import { DAYS, DAY_NAMES, AMENITIES } from '../../lib/categories';

const AUD = ['adult', 'child', 'foreigner', 'resident', 'group', 'vip', 'vvip', 'regular'];
const KINDS = ['entrance', 'facility', 'activity', 'ticket', 'room', 'guide'];
const UNITS = ['per_person', 'per_group', 'per_night', 'per_day'];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
// what each kind of host may list (the database enforces the same)
const CAT_OPTS = { hotel: ['hotel'], campsite: ['campsite', 'event'], attraction: ['attraction'], activity: ['airbnb', 'activity', 'event', 'guide'] };
const PROV_LABEL = { hotel: 'Hotel', campsite: 'Campsite', attraction: 'Attraction', activity: 'Company / business' };
const hoursFrom = (l) => Object.fromEntries(DAYS.map((d) => [d, l?.opening_hours?.[d] ?? (l ? (l.open_days?.includes(d) ? { open: l.open_time?.slice(0, 5) || '08:00', close: l.close_time?.slice(0, 5) || '18:00' } : { closed: true }) : { open: '08:00', close: '18:00' })]));

export default function ListingForm({ route, navigation }) {
  const { session } = useAuth(); const { listing, providers = [] } = route.params || {};
  const approved = providers.filter((p) => p.verification === 'approved');
  const [providerId, setProviderId] = useState(listing?.provider_id || approved[0]?.id);
  const provider = providers.find((p) => p.id === providerId);
  const catOptions = CAT_OPTS[provider?.category] || [];
  const locked = !!listing?.verified_once; // category + location are fixed after the first approval
  const old = listing?.facilities || [];
  const [f, setF] = useState({ category: listing?.category || (CAT_OPTS[provider?.category] || [])[0] || 'hotel', title: listing?.title || '', description: listing?.description || '',
    country: listing?.country || provider?.country || '', region: listing?.region || provider?.region || '', location_name: listing?.location_name || '',
    lat: listing?.lat, lng: listing?.lng, google_place_id: listing?.google_place_id, hours: hoursFrom(listing),
    entrance_fee_free: !!listing?.entrance_fee_free, amenities: old.filter((a) => AMENITIES.includes(a)), other: old.filter((a) => !AMENITIES.includes(a)).join(', '),
    photos: listing?.photos || [], event_date: listing?.event_date, schedule_type: listing?.schedule_type || 'always', starts_on: listing?.starts_on || '', ends_on: listing?.ends_on || '',
    tour_time: listing?.open_time ? listing.open_time.slice(0, 5) : '08:00', one_date: listing?.event_date ? ymd(new Date(listing.event_date)) : '',
    one_time: listing?.event_date ? `${String(new Date(listing.event_date).getHours()).padStart(2, '0')}:${String(new Date(listing.event_date).getMinutes()).padStart(2, '0')}` : '18:00', daily_limit: listing?.daily_limit ? String(listing.daily_limit) : '', pickup_times: listing?.pickup_times || [] });
  const [prices, setPrices] = useState([]); const [newPT, setNewPT] = useState('08:00');
  const [contact, setContact] = useState({ email: provider?.contact_email || '', phone: provider?.contact_phone || '', whatsapp: provider?.contact_whatsapp || '' });
  const [placeQ, setPlaceQ] = useState(''); const [results, setResults] = useState([]); const [dpick, setDpick] = useState(null);
  const [regions, setRegions] = useState([]); const [sameWa, setSameWa] = useState(true);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  useEffect(() => { if (!f.country) return setRegions([]); supabase.from('country_divisions').select('name, countries!inner(name)').eq('countries.name', f.country).eq('active', true).order('name').then(({ data }) => setRegions((data || []).map((r) => r.name))); }, [f.country]);
  useEffect(() => { if (!listing) return;
    supabase.from('listing_prices').select('*').eq('listing_id', listing.id).then(({ data }) => setPrices(data || []));
    supabase.from('listing_contacts').select('*').eq('listing_id', listing.id).maybeSingle().then(({ data }) => data && setContact(data)); }, []);

  const searchPlace = async () => {
    const r = await fetch(`https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(placeQ)}&key=${CONFIG.googleKey}`).then((x) => x.json());
    setResults((r.results || []).slice(0, 5));
  };
  const pick = (p) => { setF((x) => ({ ...x, location_name: p.name + ', ' + (p.formatted_address || ''), lat: p.geometry.location.lat, lng: p.geometry.location.lng, google_place_id: p.place_id })); setResults([]); };
  const here = async () => { const p = await getPosition(); if (p) setF((x) => ({ ...x, lat: p.lat, lng: p.lng })); };
  const onMap = async () => { const r = await pickLocation(navigation, 'Choose the place on the map'); if (r) setF((x) => ({ ...x, lat: r.lat, lng: r.lng, location_name: r.label })); };

  const setDay = (d, patch) => setF((x) => ({ ...x, hours: { ...x.hours, [d]: patch } }));
  const sched = f.category === 'event' ? 'one_time' : (['activity', 'guide'].includes(f.category) ? f.schedule_type : 'always'); const showHours = !['tour', 'one_time'].includes(sched);
  const copyToAll = () => { const first = DAYS.map((d) => f.hours[d]).find((h) => !h.closed); if (first) setF((x) => ({ ...x, hours: Object.fromEntries(DAYS.map((d) => [d, { ...first }])) })); };
  const toggleAmenity = (a) => set('amenities')(f.amenities.includes(a) ? f.amenities.filter((x) => x !== a) : [...f.amenities, a]);

  const addPrice = (kind = 'entrance') => setPrices((p) => [...p, { kind, label: '', audience: 'adult', unit: 'per_person', price: '0', is_optional: kind === 'facility' || kind === 'activity', description: '', photo_url: null }]);
  const updPrice = (i, k, v) => setPrices((p) => p.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const cycle = (arr, cur) => arr[(arr.indexOf(cur) + 1) % arr.length];
  const needsDetails = (k) => k === 'facility' || k === 'activity';

  const save = async () => {
    if (!providerId) return Alert.alert('Your provider registration must be approved first');
    if (!catOptions.includes(f.category)) return Alert.alert('Category', 'Your registration cannot list this type.');
    if (!f.title || !f.lat) return Alert.alert('Title and a map location are required');
    for (const d of DAYS) { const h = f.hours[d]; if (!h.closed && (!TIME.test(h.open || '') || !TIME.test(h.close || '') || h.close <= h.open)) return Alert.alert('Opening hours', `${DAY_NAMES[d]}: use HH:MM (24h) and closing after opening, or mark it closed.`); }
    const openDays = DAYS.filter((d) => !f.hours[d].closed); if (!openDays.length) return Alert.alert('Opening hours', 'Open at least one day.');
    for (const p of prices) if (needsDetails(p.kind) && (!p.label || !p.description || !p.photo_url)) return Alert.alert('Facilities & activities', 'Every facility and activity needs a name, a description and one photo.');
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
      opening_hours: f.hours, open_days: openDays, open_time: sched === 'tour' ? f.tour_time : first.open, close_time: first.close, entrance_fee_free: f.entrance_fee_free, facilities: amenities, photos: f.photos, event_date: eventIso, schedule_type: sched, starts_on: (sched === 'range' || sched === 'tour') ? f.starts_on : null, ends_on: (sched === 'range' || sched === 'tour') ? f.ends_on : null,
      daily_limit: f.daily_limit ? Number(f.daily_limit) : null, pickup_times: ['guide', 'activity'].includes(f.category) ? f.pickup_times : [], status: ['approved', 'hidden'].includes(listing?.status) ? listing.status : 'pending', admin_note: null };
    const q = listing ? supabase.from('listings').update(row).eq('id', listing.id).select().single() : supabase.from('listings').insert(row).select().single();
    const { data, error } = await q; if (error) return Alert.alert('Cannot save', /one_listing_per_provider/.test(error.message) ? `You can list only one ${f.category}.` : error.message);
    if (listing) await supabase.from('listing_prices').delete().eq('listing_id', data.id);
    if (prices.length) await supabase.from('listing_prices').insert(prices.map((p) => ({ listing_id: data.id, kind: p.kind, label: p.label || p.kind, audience: p.audience, unit: p.unit, price: Number(p.price) || 0, is_optional: p.is_optional,
      description: needsDetails(p.kind) ? p.description : null, photo_url: needsDetails(p.kind) ? p.photo_url : null })));
    await supabase.from('listing_contacts').upsert({ listing_id: data.id, ...contact, whatsapp: sameWa ? contact.phone : contact.whatsapp });
    Alert.alert(listing?.status === 'approved' ? 'Saved' : 'Submitted', listing?.status === 'approved' ? 'Your changes are live.' : 'Admin will verify this listing before it goes live.'); navigation.goBack();
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 12 }} keyboardShouldPersistTaps="handled">
      {!approved.length && <Text style={{ color: '#D64545' }}>No approved provider profile yet.</Text>}
      {!listing && approved.length > 1 && <><Label>Hosting as</Label><View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{approved.map((p) => <View key={p.id} style={{ marginBottom: 6 }}><Chip label={`${PROV_LABEL[p.category] || p.category} · ${p.business_name}`} active={providerId === p.id} onPress={() => { setProviderId(p.id); setF((x) => ({ ...x, category: (CAT_OPTS[p.category] || [])[0] || x.category })); }} /></View>)}</View></>}
      {provider && <Muted>{provider.category === 'hotel' ? 'Hotel host: one hotel.' : provider.category === 'campsite' ? 'Campsite host: one campsite and any number of events.' : provider.category === 'attraction' ? 'Attraction host: one attraction.' : 'Company: Airbnbs, activities, events, guided tours, trips and guides. No separate verification per listing.'}</Muted>}
      <Label>Category</Label>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{catOptions.map((c) => <View key={c} style={{ marginBottom: 6 }}><Chip label={c} active={f.category === c} onPress={() => !locked && set('category')(c)} /></View>)}</View>
      <Label>Title</Label><Input value={f.title} onChangeText={set('title')} />
      <Label>Description</Label><Input multiline value={f.description} onChangeText={set('description')} />
      <Label>Country</Label><CountryPicker value={f.country} onChange={set('country')} />
      <Label>Region</Label>{regions.length ? <SelectField value={f.region} options={regions.map((r) => ({ value: r, label: r }))} onChange={set('region')} placeholder="Select region" title="Region" /> : <Input value={f.region} onChangeText={set('region')} />}

      <Label>Location (Google Places)</Label>
      {locked ? <Muted>🔒 Category and location cannot be changed after verification.</Muted> : <>
        <Input value={placeQ} onChangeText={setPlaceQ} placeholder="Search place name on Google" /><Btn kind="ghost" title="Search Google Places" onPress={searchPlace} />
        {results.map((r) => <Card key={r.place_id} onPress={() => pick(r)} style={{ marginHorizontal: 0 }}><Text>{r.name}</Text><Muted>{r.formatted_address}</Muted></Card>)}
        <Btn kind="ghost" title="🗺️ Choose on map (search or tap)" onPress={onMap} />
        <Btn kind="ghost" title="Use my current location" onPress={here} /></>}
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
        {f.category !== 'event' && <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {[['always', 'Ongoing (no end date)'], ['range', 'Activity with an end date'], ['tour', 'Tour / trip with start & end date'], ['one_time', 'Happens once (date & time)']].map(([k, l]) => <View key={k} style={{ marginBottom: 6 }}><Chip label={l} active={sched === k} onPress={() => set('schedule_type')(k)} /></View>)}</View>}
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
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}><Text>Free entrance</Text><Switch value={f.entrance_fee_free} onValueChange={set('entrance_fee_free')} /></View>
      <Label>Daily limit (max guests / tickets per day, empty = unlimited)</Label><Input keyboardType="number-pad" value={f.daily_limit} onChangeText={set('daily_limit')} />

      <Label>Amenities (choose from the list)</Label>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{AMENITIES.map((a) => <View key={a} style={{ marginBottom: 6 }}><Chip label={a} active={f.amenities.includes(a)} onPress={() => toggleAmenity(a)} /></View>)}</View>
      <Label>Other amenities (comma separated)</Label><Input value={f.other} onChangeText={set('other')} placeholder="e.g. Rooftop bar, Bicycle hire" />

      {['guide', 'activity'].includes(f.category) && <>
        <Label>Fixed pickup times (optional)</Label>
        <Muted>Add two or more times if guests are picked up at set times (for example 06:00 and 09:00). Guests choose one. Leave empty to let guests choose any time.</Muted>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{f.pickup_times.map((t) => <View key={t} style={{ marginBottom: 6 }}><Chip label={`🕒 ${t}  ✕`} onPress={() => set('pickup_times')(f.pickup_times.filter((x) => x !== t))} /></View>)}</View>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}><View style={{ flex: 1 }}><TimeField label="New time" value={newPT} onChange={setNewPT} /></View><Btn style={{ marginLeft: 8 }} kind="ghost" title="＋ Add" onPress={() => { if (!f.pickup_times.includes(newPT)) set('pickup_times')([...f.pickup_times, newPT].sort()); }} /></View>
      </>}
      <Label>Photos</Label>
      <ScrollView horizontal>{f.photos.map((u) => <Image key={u} source={{ uri: u }} style={{ width: 90, height: 90, marginRight: 6, borderRadius: 8 }} />)}</ScrollView>
      <Btn kind="ghost" title="＋ Add photo" onPress={async () => { try { const u = await pickAndUploadPhoto(session.user.id); if (u) set('photos')([...f.photos, u]); } catch (e) { Alert.alert('Upload failed', e.message); } }} />

      <Label>Prices, facilities and activities</Label>
      <Muted>Entrance / room / ticket / guide are simple prices. Facilities and activities also need a description and one photo.</Muted>
      {prices.map((p, i) => (
        <Card key={i} style={{ marginHorizontal: 0 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            <Chip label={p.kind} onPress={() => updPrice(i, 'kind', cycle(KINDS, p.kind))} /><Chip label={p.audience} onPress={() => updPrice(i, 'audience', cycle(AUD, p.audience))} />
            <Chip label={p.unit.replace('_', ' ')} onPress={() => updPrice(i, 'unit', cycle(UNITS, p.unit))} /><Chip label={p.is_optional ? 'optional' : 'required'} onPress={() => updPrice(i, 'is_optional', !p.is_optional)} /></View>
          <Input placeholder={needsDetails(p.kind) ? 'Name (e.g. Boat ride, Spa, Game drive)' : 'Label (e.g. Entrance, Standard room, VIP ticket)'} value={p.label} onChangeText={(v) => updPrice(i, 'label', v)} />
          {needsDetails(p.kind) && <>
            <Input multiline placeholder="Details: what is included, duration, what to bring" value={p.description || ''} onChangeText={(v) => updPrice(i, 'description', v)} />
            {p.photo_url ? <Image source={{ uri: p.photo_url }} style={{ height: 120, borderRadius: 10 }} /> : null}
            <Btn kind="ghost" title={p.photo_url ? 'Change photo' : '📷 Add photo (required)'} onPress={async () => { try { const u = await pickAndUploadPhoto(session.user.id); if (u) updPrice(i, 'photo_url', u); } catch (e) { Alert.alert('Upload failed', e.message); } }} /></>}
          <Input placeholder="Price USD (0 = free)" keyboardType="decimal-pad" value={String(p.price)} onChangeText={(v) => updPrice(i, 'price', v)} />
          <Btn kind="danger" title="Remove" onPress={() => setPrices((x) => x.filter((_, j) => j !== i))} /></Card>))}
      <View style={{ flexDirection: 'row' }}>
        <Btn style={{ flex: 1, marginRight: 4 }} kind="ghost" title="＋ Price" onPress={() => addPrice('entrance')} />
        <Btn style={{ flex: 1, marginHorizontal: 2 }} kind="ghost" title="＋ Facility" onPress={() => addPrice('facility')} />
        <Btn style={{ flex: 1, marginLeft: 4 }} kind="ghost" title="＋ Activity" onPress={() => addPrice('activity')} />
      </View>

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
