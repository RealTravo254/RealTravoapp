import React, { useCallback, useRef, useState } from 'react';
import { ScrollView, View, Alert, Text, Switch, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import { chooseAndUploadDocument, takeSelfie } from '../../lib/upload';
import { getPosition, reverseInfo, matchRegion } from '../../lib/geo';
import { pickLocation } from '../../lib/pickBus';
import { Btn, Input, Label, Chip, Muted, Card } from '../../components/ui';
import SelectField from '../../components/SelectField';
import PhoneField from '../../components/PhoneField';

// Host types the user can choose AFTER their identity is approved.
// "key" is the providers.category value saved in the database.
// multi:  true  -> the host can register several provider profiles of this type
//         false -> one registration only
// events: true  -> the host can also host events. Airbnb hosts cannot host events or activities.
const TYPES = [
  { key: 'hotel', label: 'Hotel / restaurant', docs: 'full', multi: false, events: true,
    help: 'You can list multiple hotels or resorts and host events. TRA and a business registration document are required.' },
  { key: 'activity', label: 'Trips, events, tours & activities', docs: 'reg', multi: false, events: true,
    help: 'Verified once as a company or business. You can then list many trips, events, guided tours and activities. A business registration number and document are required.' },
  { key: 'campsite', label: 'Campsite', docs: 'full', multi: false, events: true,
    help: 'You can list multiple campsites and host events. TRA and a business registration document are required.' },
  { key: 'airbnb', label: 'Airbnb', docs: 'none', multi: true, events: false,
    help: 'List as many Airbnb stays as you like, each with its own details. No business documents are needed beyond your verified ID. Airbnb hosts cannot host events or activities.' },
];
const DOC_TYPES = [['national_id', 'National ID'], ['passport', 'Passport'], ['driving_licence', 'Driving licence']];
const STAY_TYPES = ['Entire home', 'Apartment', 'Private room', 'Villa / cottage', 'Other'];

// Use this in ListingForm / HostHome to hide the "event" and "activity" options for Airbnb hosts
export const canHostEvents = (category) => !!TYPES.find((t) => t.key === category)?.events;

// Direct routes to the other host pages. Change the names (second item) to match your navigator.
const HOST_ROUTES = [
  ['🏠 Host home', 'HostHome'],
  ['➕ Listings', 'ListingForm'],
  ['📅 Bookings', 'HostBookings'],
  ['💬 Inquiries', 'HostInquiries'],
  ['📊 Analytics', 'Analytics'],
  ['💳 Payment settings', 'PaymentSettings'],
  ['📝 Booking forms', 'BookingForms'],
];

// Blue verification tick (like Instagram)
function VerifiedBadge({ size = 20 }) {
  return <MaterialCommunityIcons name="check-decagram" size={size} color="#1D9BF0" />;
}

export default function ProviderRegister({ navigation }) {
  const { session, profile } = useAuth();
  const country = profile?.country || '';   // the host's country is ALWAYS the profile country
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [ver, setVer] = useState(null);           // host_verifications row (identity)
  const [existing, setExisting] = useState([]);   // providers rows (host types already submitted)
  const [cat, setCat] = useState(null);           // chosen host type (null until picked)
  const [id, setId] = useState({ legal_name: '', document_type: 'national_id', front: null, back: null, selfie: null, street_address: '', city: '' });
  const [f, setF] = useState({ business_name: '', registration_number: '', tra_number: '', city: '', region: '', location_name: '', lat: null, lng: null, contact_email: session.user.email || '', contact_phone: '', contact_whatsapp: '' });
  const [ab, setAb] = useState({ property_type: '', description: '', bedrooms: '1', beds: '1', bathrooms: '1', max_guests: '2', price_per_night: '', house_rules: '' });
  const [sameWa, setSameWa] = useState(true);
  const [doc, setDoc] = useState(null); const [tra, setTra] = useState(null);
  const [regions, setRegions] = useState([]); const [cities, setCities] = useState([]);
  const prefilled = useRef(false);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const setA = (k) => (v) => setAb((x) => ({ ...x, [k]: v }));

  const type = TYPES.find((t) => t.key === cat);
  const needs = type?.docs === 'full';                       // TRA + registration
  const needsReg = type?.docs === 'full' || type?.docs === 'reg';

  // identity is approved when a verification row exists and is not pending / rejected
  const isVerified = !!ver && ver.status !== 'pending' && ver.status !== 'rejected';
  // a host can only have ONE category: the first one that is not rejected
  const active = existing.find((p) => p.verification !== 'rejected');
  const lockedType = active ? TYPES.find((t) => t.key === active.category) : null;
  const visibleTypes = lockedType ? [lockedType] : TYPES;
  const canAddMore = !lockedType || lockedType.multi;        // only Airbnb can add another one

  // reload the status every time the page comes into view (after the admin decides)
  const loadStatus = useCallback(async () => {
    const [{ data: p }, { data: v }] = await Promise.all([
      supabase.from('providers').select('category,business_name,verification,admin_note').eq('user_id', session.user.id),
      supabase.from('host_verifications').select('*').eq('user_id', session.user.id).maybeSingle(),
    ]);
    setExisting(p || []); setVer(v || null);
    if (v && !prefilled.current) { // fill the form once so a rejected user can fix it
      prefilled.current = true;
      setId((x) => ({ ...x, legal_name: v.legal_name || '', document_type: v.document_type || 'national_id', street_address: v.street_address || '', city: v.city || '' }));
    }
    setLoading(false);
  }, [session.user.id]);
  useFocusEffect(useCallback(() => { loadStatus(); }, [loadStatus]));

  // regions and cities come from the lists the admin set for the profile country
  React.useEffect(() => {
    setF((x) => ({ ...x, city: '', region: '', lat: null, lng: null, location_name: '' }));
    if (!country) { setRegions([]); setCities([]); return; }
    supabase.from('country_divisions').select('name, countries!inner(name)').eq('countries.name', country).eq('active', true).order('name').then(({ data }) => setRegions((data || []).map((r) => r.name)));
    supabase.from('cities').select('name, countries!inner(name)').eq('countries.name', country).eq('active', true).order('name').then(({ data }) => setCities((data || []).map((r) => r.name)));
  }, [country]);

  const up = (k, bucket) => async () => { try { const p = await chooseAndUploadDocument(session.user.id, bucket, 'id'); if (p) setId((x) => ({ ...x, [k]: p })); } catch (e) { Alert.alert('Upload failed', e.message); } };

  // ---------- Stage 1: identity ----------
  const submitIdentity = async () => {
    if (!country) return Alert.alert('Set your country', 'Add your country in your profile before verification. It must match the country where you host.');
    if (!id.legal_name.trim() || !id.front || !id.selfie || !id.street_address.trim() || !id.city.trim())
      return Alert.alert('Identity verification', 'Add your legal name, ID document (front), a selfie, street address and city.');
    setBusy(true);
    const row = { user_id: session.user.id, legal_name: id.legal_name.trim(), document_type: id.document_type, document_front_path: id.front, document_back_path: id.back,
      selfie_path: id.selfie, street_address: id.street_address.trim(), city: id.city.trim(), status: 'pending', rejection_reason: null };
    const { error } = await supabase.from('host_verifications').upsert(row, { onConflict: 'user_id' });
    setBusy(false);
    if (error) return Alert.alert('Error', error.message);
    await loadStatus(); // shows the "Pending review" card
  };

  // ---------- Stage 2: host type + property ----------
  const applyPoint = async (pt) => {
    const info = await reverseInfo(pt.lat, pt.lng); const m = matchRegion(info.parts, regions);
    setF((x) => ({ ...x, lat: pt.lat, lng: pt.lng, location_name: pt.label || info.label, region: m || '' }));
    if (!m && regions.length) Alert.alert('Region', 'We could not match this spot to a region. Please choose the region from the list below.');
  };
  const useMine = async () => { if (!country) return Alert.alert('Set your country in your profile first'); const p = await getPosition(); if (p) applyPoint(p); };
  const onMap = async () => { if (!country) return Alert.alert('Set your country in your profile first'); const r = await pickLocation(navigation, 'Select your region on the map'); if (r) applyPoint(r); };

  const pickType = (t) => {
    if (!isVerified) return Alert.alert('Verification required', 'Your identity must be verified before you can choose what to host.');
    if (lockedType && lockedType.key !== t.key) return Alert.alert('One category only', `You already host as ${lockedType.label}. A host can only have one category.`);
    if (lockedType && !t.multi) return Alert.alert('Already registered', `You already have a ${t.label} registration (${active.verification}).`);
    setCat(t.key);
  };

  const submitProperty = async () => {
    if (!isVerified) return Alert.alert('Verification required', 'Your identity must be verified first.');
    if (!cat) return Alert.alert('Choose what you want to host');
    if (lockedType && (lockedType.key !== cat || !lockedType.multi)) return Alert.alert('One category only', `You already host as ${lockedType.label}. A host can only have one category.`);
    if (!country) return Alert.alert('Set your country', 'Add your country in your profile first. Your listings must be in the same country.');
    if (!f.business_name.trim()) return Alert.alert(cat === 'airbnb' ? 'Stay name required' : 'Business / host name required');
    if (cat === 'airbnb') {
      if (!ab.property_type) return Alert.alert('Choose the property type');
      if (!ab.description.trim()) return Alert.alert('Describe your stay');
      if (!(Number(ab.max_guests) > 0)) return Alert.alert('Enter the maximum number of guests');
      if (!(Number(ab.price_per_night) > 0)) return Alert.alert('Enter the price per night');
    }
    if (cities.length && !f.city) return Alert.alert('Choose the city');
    if (f.lat == null) return Alert.alert('Select the region on the map', 'Use your location or pick it on the map.');
    if (regions.length && !f.region) return Alert.alert('Choose the region');
    if (!f.contact_phone) return Alert.alert('Add a contact phone number');
    if (needs && (!f.registration_number || !f.tra_number || !tra || !doc)) return Alert.alert('TRA number, a photo of the TRA certificate, registration number and registration document are required for this type');
    if (type.docs === 'reg' && (!f.registration_number || !doc)) return Alert.alert('Business registration', 'A company needs its registration number and registration document.');
    setBusy(true);
    const details = cat === 'airbnb' ? {
      property_type: ab.property_type, description: ab.description.trim(), bedrooms: Number(ab.bedrooms) || 0, beds: Number(ab.beds) || 0,
      bathrooms: Number(ab.bathrooms) || 0, max_guests: Number(ab.max_guests), price_per_night: Number(ab.price_per_night), house_rules: ab.house_rules.trim(),
    } : null;
    // country is always the profile country, so every listing matches the host's country
    const { error } = await supabase.from('providers').insert({ ...f, country, contact_whatsapp: sameWa ? f.contact_phone : f.contact_whatsapp, user_id: session.user.id, category: cat,
      registration_document_url: needsReg ? doc : null, tra_number: needs ? f.tra_number : null, tra_image_path: needs ? tra : null, registration_number: needsReg ? f.registration_number : null,
      details });
    setBusy(false);
    if (error) return Alert.alert('Error', error.message);
    Alert.alert('Submitted', 'Our team will verify your business. You will be notified.');
    navigation.goBack();
  };

  if (loading) return <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator size="large" /></View>;

  // ---------- Pending review ----------
  if (ver?.status === 'pending') return (
    <ScrollView contentContainerStyle={{ padding: 12 }}>
      <Card style={{ marginHorizontal: 0 }}>
        <Text style={{ fontSize: 20, fontWeight: '800' }}>⏳ Pending review</Text>
        <Muted style={{ marginTop: 6 }}>Thank you, {ver.legal_name}. Our team is checking your identity. You will be notified when it is approved or if we need you to resubmit. After approval you can choose what you want to host.</Muted>
        <Muted style={{ marginTop: 6 }}>🌍 Your country ({country || 'not set'}) is locked while your verification is under review.</Muted>
        <Btn kind="ghost" title="Refresh status" onPress={loadStatus} />
      </Card>
    </ScrollView>
  );

  // ---------- Identity form (new user, or sent back / rejected) ----------
  if (!ver || ver.status === 'rejected') return (
    <ScrollView contentContainerStyle={{ padding: 12 }} keyboardShouldPersistTaps="handled">
      {ver?.status === 'rejected' && (
        <Card style={{ marginHorizontal: 0 }}>
          <Text style={{ fontWeight: '800', color: '#D64545' }}>Sent back for review</Text>
          <Text>{ver.rejection_reason || 'Please resubmit clear documents.'}</Text>
          <Muted>Fix the details below and submit again.</Muted>
        </Card>
      )}
      <Text style={{ fontSize: 18, fontWeight: '800', marginTop: 8 }}>Verify your identity</Text>
      <Muted>Before you can host anything, we need to verify who you are. You choose what to host after you are approved.</Muted>

      <Card style={{ marginHorizontal: 0, marginTop: 10 }}>
        <Text style={{ fontWeight: '800' }}>🌍 Country: {country || 'not set'}</Text>
        <Muted>This is the country in your profile. Your ID and everything you host must be in this country. Once you submit for verification you cannot change it.</Muted>
        {!country && <Btn kind="ghost" title="Set my country in my profile" onPress={() => navigation.navigate('EditProfile')} />}
      </Card>

      <Label>Legal name (as on your ID)</Label><Input value={id.legal_name} onChangeText={(v) => setId({ ...id, legal_name: v })} />
      <Label>Document type</Label>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{DOC_TYPES.map(([k, l]) => <View key={k} style={{ marginBottom: 6 }}><Chip label={l} active={id.document_type === k} onPress={() => setId({ ...id, document_type: k })} /></View>)}</View>
      <Btn kind="ghost" title={id.front ? '✅ ID front uploaded' : '📎 Upload ID (front)'} onPress={up('front', 'host-verification')} />
      <Btn kind="ghost" title={id.back ? '✅ ID back uploaded' : '📎 Upload ID (back, if any)'} onPress={up('back', 'host-verification')} />
      <Btn kind="ghost" title={id.selfie ? '✅ Selfie taken' : '🤳 Take a selfie'} onPress={async () => { try { const p = await takeSelfie(session.user.id); if (p) setId((x) => ({ ...x, selfie: p })); } catch (e) { Alert.alert('Selfie', e.message); } }} />
      <Label>Street address</Label><Input value={id.street_address} onChangeText={(v) => setId({ ...id, street_address: v })} />
      <Label>City</Label><Input value={id.city} onChangeText={(v) => setId({ ...id, city: v })} />
      <Btn title={busy ? 'Submitting…' : 'Submit for verification'} onPress={busy ? () => {} : submitIdentity} />
      <View style={{ height: 30 }} />
    </ScrollView>
  );

  // ---------- Approved: verified badge, host tools, choose host type, then property details ----------
  return (
    <ScrollView contentContainerStyle={{ padding: 12 }} keyboardShouldPersistTaps="handled">
      <Card style={{ marginHorizontal: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ fontSize: 20, fontWeight: '800' }}>{ver.legal_name}</Text>
          <View style={{ marginLeft: 6 }}><VerifiedBadge size={22} /></View>
        </View>
        <Text style={{ color: '#1D9BF0', fontWeight: '700', marginTop: 2 }}>Verified host · {country}</Text>
        {existing.map((p, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
            <Text>{p.category} · {p.business_name}: {p.verification}{p.admin_note ? ` — ${p.admin_note}` : ''}</Text>
            {p.verification === 'approved' && <View style={{ marginLeft: 4 }}><VerifiedBadge size={16} /></View>}
          </View>
        ))}
      </Card>

      {/* Direct routes to the other host pages */}
      {active && (
        <>
          <Text style={{ fontSize: 18, fontWeight: '800', marginTop: 12 }}>Host tools</Text>
          {HOST_ROUTES.map(([label, route]) => (
            <Btn key={route} kind="ghost" title={label} onPress={() => navigation.navigate(route)} />
          ))}
        </>
      )}

      <Text style={{ fontSize: 18, fontWeight: '800', marginTop: 12 }}>{lockedType ? 'Your host category' : 'What do you want to host?'}</Text>
      {lockedType && <Muted>A host can only have one category.{lockedType.multi ? ' You can add as many Airbnb stays as you like.' : ''}</Muted>}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {visibleTypes.map((t) => {
          const found = existing.find((p) => p.category === t.key && p.verification !== 'rejected');
          return <View key={t.key} style={{ marginBottom: 6 }}><Chip label={found ? `${t.label} (${found.verification})` : t.label} active={cat === t.key} onPress={() => pickType(t)} /></View>;
        })}
      </View>
      {type ? <Muted>{type.help}</Muted> : lockedType && !canAddMore ? <Muted>You already have your {lockedType.label} registration. Use the host tools above to manage it.</Muted> : lockedType ? <Muted>Tap Airbnb to add another stay.</Muted> : <Muted>Choose a type to continue.</Muted>}

      {type && canAddMore && <>
        <Text style={{ fontSize: 18, fontWeight: '800', marginTop: 16 }}>{cat === 'airbnb' ? (active ? 'Add another stay' : 'Your stay') : 'Your property'}</Text>
        <Label>{cat === 'airbnb' ? 'Stay name' : 'Business / host name'}</Label><Input value={f.business_name} onChangeText={set('business_name')} />

        {cat === 'airbnb' && <>
          <Label>Property type</Label>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{STAY_TYPES.map((s) => <View key={s} style={{ marginBottom: 6 }}><Chip label={s} active={ab.property_type === s} onPress={() => setA('property_type')(s)} /></View>)}</View>
          <Label>Description</Label><Input multiline value={ab.description} onChangeText={setA('description')} placeholder="Describe the stay, the view, what guests will love" style={{ minHeight: 80, textAlignVertical: 'top' }} />
          <Label>Maximum guests</Label><Input keyboardType="number-pad" value={ab.max_guests} onChangeText={(t) => setA('max_guests')(t.replace(/\D/g, ''))} />
          <Label>Bedrooms</Label><Input keyboardType="number-pad" value={ab.bedrooms} onChangeText={(t) => setA('bedrooms')(t.replace(/\D/g, ''))} />
          <Label>Beds</Label><Input keyboardType="number-pad" value={ab.beds} onChangeText={(t) => setA('beds')(t.replace(/\D/g, ''))} />
          <Label>Bathrooms</Label><Input keyboardType="number-pad" value={ab.bathrooms} onChangeText={(t) => setA('bathrooms')(t.replace(/\D/g, ''))} />
          <Label>Price per night</Label><Input keyboardType="decimal-pad" value={ab.price_per_night} onChangeText={(t) => setA('price_per_night')(t.replace(/[^0-9.]/g, ''))} />
          <Label>House rules (optional)</Label><Input multiline value={ab.house_rules} onChangeText={setA('house_rules')} placeholder="Check-in time, quiet hours, pets, smoking" style={{ minHeight: 60, textAlignVertical: 'top' }} />
        </>}

        {needsReg && <>
          <Label>Registration number</Label><Input value={f.registration_number} onChangeText={set('registration_number')} />
          {needs && <>
            <Label>TRA number</Label><Input value={f.tra_number} onChangeText={set('tra_number')} />
            <Btn kind="ghost" title={tra ? '✅ TRA certificate photo uploaded' : '📎 Upload TRA (any legal document)'} onPress={async () => { try { const p = await chooseAndUploadDocument(session.user.id, 'provider-docs', 'tra'); if (p) setTra(p); } catch (e) { Alert.alert('Upload failed', e.message); } }} />
          </>}
          <Btn kind="ghost" title={doc ? '✅ Registration document uploaded' : '📎 Upload registration document'} onPress={async () => { try { setDoc(await chooseAndUploadDocument(session.user.id, 'provider-docs', 'reg')); } catch (e) { Alert.alert('Upload failed', e.message); } }} />
        </>}

        <Label>Country</Label>
        <Muted>🌍 {country || 'Not set'} (locked to your profile country)</Muted>
        <Label>City</Label>
        {country ? (cities.length
          ? <SelectField value={f.city} options={cities.map((c) => ({ value: c, label: c }))} onChange={set('city')} placeholder="Select city" title={`Cities in ${country}`} />
          : <><Input value={f.city} onChangeText={set('city')} placeholder="City" /><Muted>The admin has not added cities for {country} yet (Admin → Cities).</Muted></>) : <Muted>Set your country in your profile first.</Muted>}
        <Label>Region (select on the map)</Label>
        <View style={{ flexDirection: 'row' }}>
          <Btn style={{ flex: 1, marginRight: 4 }} kind="ghost" title="🗺️ Pick on map" onPress={onMap} />
          <Btn style={{ flex: 1, marginLeft: 4 }} kind="ghost" title="📍 Use my location" onPress={useMine} />
        </View>
        {f.lat != null && <Muted>📍 {f.location_name}</Muted>}
        {f.lat != null && (regions.length
          ? <SelectField value={f.region} options={regions.map((r) => ({ value: r, label: r }))} onChange={set('region')} placeholder="Region" title={`Regions in ${country}`} />
          : <Muted>No regions set for {country} yet (Admin → Regions).</Muted>)}

        <Label>Contact email</Label><Input autoCapitalize="none" value={f.contact_email} onChangeText={set('contact_email')} />
        <Label>Contact phone</Label><PhoneField country={country} value={f.contact_phone} onChange={set('contact_phone')} />
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}><Text style={{ flex: 1 }}>WhatsApp is the same number</Text><Switch value={sameWa} onValueChange={setSameWa} /></View>
        {!sameWa && <><Label>WhatsApp number</Label><PhoneField country={country} value={f.contact_whatsapp} onChange={set('contact_whatsapp')} /></>}
        <Btn title={busy ? 'Submitting…' : 'Submit for verification'} onPress={busy ? () => {} : submitProperty} />
      </>}
      <View style={{ height: 30 }} />
    </ScrollView>
  );
}