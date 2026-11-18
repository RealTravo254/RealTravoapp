import React, { useEffect, useState } from 'react';
import { ScrollView, View, Alert, Text, Switch } from 'react-native';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import { chooseAndUploadDocument, takeSelfie } from '../../lib/upload';
import { getPosition, reverseInfo, matchRegion } from '../../lib/geo';
import { pickLocation } from '../../lib/pickBus';
import { Btn, Input, Label, Chip, Muted, Card } from '../../components/ui';
import CountryPicker from '../../components/CountryPicker';
import SelectField from '../../components/SelectField';
import PhoneField from '../../components/PhoneField';

const NEEDS_DOCS = ['hotel', 'campsite', 'attraction'];
const HELP = {
  hotel: 'Hotel host: you can list one hotel. TRA and a business registration document are required.',
  campsite: 'Campsite host: you can list one campsite and any number of events. TRA and a business registration document are required.',
  attraction: 'Attraction host: you can list one attraction. TRA and a business registration document are required.',
  activity: 'Company or business: verified once here. After approval you can list Airbnbs, activities, events, guided tours, trips and guides, with no separate verification for each. A business registration number and document are required.',
};
const DOC_TYPES = [['national_id', 'National ID'], ['passport', 'Passport'], ['driving_licence', 'Driving licence']];
export default function ProviderRegister({ navigation }) {
  const { session } = useAuth();
  const [cat, setCat] = useState('hotel');
  const [f, setF] = useState({ business_name: '', registration_number: '', tra_number: '', country: '', city: '', region: '', location_name: '', lat: null, lng: null, contact_email: session.user.email || '', contact_phone: '', contact_whatsapp: '' });
  const [sameWa, setSameWa] = useState(true);
  const [id, setId] = useState({ legal_name: '', document_type: 'national_id', front: null, back: null, selfie: null, street_address: '', city: '' });
  const [doc, setDoc] = useState(null); const [tra, setTra] = useState(null); const [existing, setExisting] = useState([]); const [ver, setVer] = useState(null);
  const [regions, setRegions] = useState([]); const [cities, setCities] = useState([]);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const needs = NEEDS_DOCS.includes(cat);           // TRA + registration
  const needsReg = needs || cat === 'activity';     // company: registration only

  useEffect(() => {
    supabase.from('providers').select('category,business_name,verification,admin_note').eq('user_id', session.user.id).then(({ data }) => setExisting(data || []));
    supabase.from('host_verifications').select('*').eq('user_id', session.user.id).maybeSingle().then(({ data }) => { if (data) { setVer(data); setId((x) => ({ ...x, legal_name: data.legal_name, document_type: data.document_type, street_address: data.street_address, city: data.city })); } });
  }, []);
  // cities and regions come from the lists the admin set for the chosen country
  useEffect(() => {
    if (!f.country) { setRegions([]); setCities([]); return; }
    supabase.from('country_divisions').select('name, countries!inner(name)').eq('countries.name', f.country).eq('active', true).order('name').then(({ data }) => setRegions((data || []).map((r) => r.name)));
    supabase.from('cities').select('name, countries!inner(name)').eq('countries.name', f.country).eq('active', true).order('name').then(({ data }) => setCities((data || []).map((r) => r.name)));
  }, [f.country]);

  const up = (k, bucket) => async () => { try { const p = await chooseAndUploadDocument(session.user.id, bucket, 'id'); if (p) setId((x) => ({ ...x, [k]: p })); } catch (e) { Alert.alert('Upload failed', e.message); } };

  // region is chosen on the map (or from my location); it is matched to the admin's region list
  const applyPoint = async (pt) => {
    const info = await reverseInfo(pt.lat, pt.lng); const m = matchRegion(info.parts, regions);
    setF((x) => ({ ...x, lat: pt.lat, lng: pt.lng, location_name: pt.label || info.label, region: m || '' }));
    if (!m && regions.length) Alert.alert('Region', 'We could not match this spot to a region. Please choose the region from the list below.');
  };
  const useMine = async () => { if (!f.country) return Alert.alert('Choose the country first'); const p = await getPosition(); if (p) applyPoint(p); };
  const onMap = async () => { if (!f.country) return Alert.alert('Choose the country first'); const r = await pickLocation(navigation, 'Select your region on the map'); if (r) applyPoint(r); };

  const submit = async () => {
    if (!f.business_name) return Alert.alert('Business / host name required');
    if (!f.country) return Alert.alert('Choose the country');
    if (cities.length && !f.city) return Alert.alert('Choose the city');
    if (f.lat == null) return Alert.alert('Select the region on the map', 'Use your location or pick it on the map.');
    if (regions.length && !f.region) return Alert.alert('Choose the region');
    if (!f.contact_phone) return Alert.alert('Add a contact phone number');
    if (existing.some((p) => p.category === cat && p.verification !== 'rejected')) return Alert.alert('Already registered', 'You already have a registration for this type. Wait for it to be verified, or choose another type.');
    if (needs && (!f.registration_number || !f.tra_number || !tra || !doc)) return Alert.alert('TRA number, a photo of the TRA certificate, registration number and registration document are required for this category');
    if (!needs && cat === 'activity' && (!f.registration_number || !doc)) return Alert.alert('Business registration', 'A company needs its registration number and registration document.');
    if (!ver || ver.status === 'rejected') {
      if (!id.legal_name || !id.front || !id.selfie || !id.street_address || !id.city) return Alert.alert('Identity verification', 'Add your legal name, ID document (front), a selfie, street address and city.');
      const row = { user_id: session.user.id, legal_name: id.legal_name, document_type: id.document_type, document_front_path: id.front, document_back_path: id.back, selfie_path: id.selfie, street_address: id.street_address, city: id.city, status: 'pending', rejection_reason: null };
      const { error } = await supabase.from('host_verifications').upsert(row, { onConflict: 'user_id' }); if (error) return Alert.alert('Error', error.message);
    }
    const { error } = await supabase.from('providers').insert({ ...f, contact_whatsapp: sameWa ? f.contact_phone : f.contact_whatsapp, user_id: session.user.id, category: cat, registration_document_url: doc,
      tra_number: needs ? f.tra_number : null, tra_image_path: needs ? tra : null, registration_number: needsReg ? f.registration_number : null });
    if (error) Alert.alert('Error', error.message); else { Alert.alert('Submitted', 'Our team verifies your ID and business. You will be notified.'); navigation.goBack(); }
  };
  const needId = !ver || ver.status === 'rejected';
  return (
    <ScrollView contentContainerStyle={{ padding: 12 }} keyboardShouldPersistTaps="handled">
      {(ver || existing.length > 0) && <Card style={{ marginHorizontal: 0 }}>
        <Text style={{ fontWeight: '800' }}>Your hosting status</Text>
        {ver && <Text>ID verification: {ver.status}{ver.rejection_reason ? ` — ${ver.rejection_reason}` : ''}</Text>}
        {existing.map((p, i) => <Text key={i}>{p.category} · {p.business_name}: {p.verification}{p.admin_note ? ` — ${p.admin_note}` : ''}</Text>)}</Card>}

      {needId && <>
        <Text style={{ fontSize: 18, fontWeight: '800', marginTop: 8 }}>1. Verify your identity</Text>
        <Label>Legal name (as on your ID)</Label><Input value={id.legal_name} onChangeText={(v) => setId({ ...id, legal_name: v })} />
        <Label>Document type</Label><View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{DOC_TYPES.map(([k, l]) => <View key={k} style={{ marginBottom: 6 }}><Chip label={l} active={id.document_type === k} onPress={() => setId({ ...id, document_type: k })} /></View>)}</View>
        <Btn kind="ghost" title={id.front ? '✅ ID front uploaded' : '📎 Upload ID (front)'} onPress={up('front', 'host-verification')} />
        <Btn kind="ghost" title={id.back ? '✅ ID back uploaded' : '📎 Upload ID (back, if any)'} onPress={up('back', 'host-verification')} />
        <Btn kind="ghost" title={id.selfie ? '✅ Selfie taken' : '🤳 Take a selfie'} onPress={async () => { try { const p = await takeSelfie(session.user.id); if (p) setId((x) => ({ ...x, selfie: p })); } catch (e) { Alert.alert('Selfie', e.message); } }} />
        <Label>Street address</Label><Input value={id.street_address} onChangeText={(v) => setId({ ...id, street_address: v })} />
        <Label>City</Label><Input value={id.city} onChangeText={(v) => setId({ ...id, city: v })} />
      </>}

      <Text style={{ fontSize: 18, fontWeight: '800', marginTop: 16 }}>{needId ? '2. ' : ''}Your property</Text>
      <Label>What will you list?</Label>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{[['hotel', 'Hotel'], ['campsite', 'Campsite (+ events)'], ['attraction', 'Attraction'], ['activity', 'Company / business']].map(([c, label]) => <View key={c} style={{ marginBottom: 6 }}><Chip label={label} active={cat === c} onPress={() => setCat(c)} /></View>)}</View>
      <Muted>{HELP[cat]}</Muted>
      <Label>Business / host name</Label><Input value={f.business_name} onChangeText={set('business_name')} />
      {needsReg && <><Label>Registration number</Label><Input value={f.registration_number} onChangeText={set('registration_number')} />
        {needs && <><Label>TRA number</Label><Input value={f.tra_number} onChangeText={set('tra_number')} />
        <Btn kind="ghost" title={tra ? '✅ TRA certificate photo uploaded' : '📎 Upload TRA (any legal document)'} onPress={async () => { try { const p = await chooseAndUploadDocument(session.user.id, 'provider-docs', 'tra'); if (p) setTra(p); } catch (e) { Alert.alert('Upload failed', e.message); } }} />
</>}
        <Btn kind="ghost" title={doc ? '✅ Registration document uploaded' : '📎 Upload registration document'} onPress={async () => { try { setDoc(await chooseAndUploadDocument(session.user.id, 'provider-docs', 'reg')); } catch (e) { Alert.alert('Upload failed', e.message); } }} /></>}

      <Label>Country</Label><CountryPicker value={f.country} onChange={(v) => setF((x) => ({ ...x, country: v, city: '', region: '' }))} />
      <Label>City</Label>
      {f.country ? (cities.length ? <SelectField value={f.city} options={cities.map((c) => ({ value: c, label: c }))} onChange={set('city')} placeholder="Select city" title={`Cities in ${f.country}`} />
        : <><Input value={f.city} onChangeText={set('city')} placeholder="City" /><Muted>The admin has not added cities for {f.country} yet (Admin → Cities).</Muted></>) : <Muted>Choose the country first.</Muted>}
      <Label>Region (select on the map)</Label>
      <View style={{ flexDirection: 'row' }}>
        <Btn style={{ flex: 1, marginRight: 4 }} kind="ghost" title="🗺️ Pick on map" onPress={onMap} />
        <Btn style={{ flex: 1, marginLeft: 4 }} kind="ghost" title="📍 Use my location" onPress={useMine} />
      </View>
      {f.lat != null && <Muted>📍 {f.location_name}</Muted>}
      {f.lat != null && (regions.length ? <SelectField value={f.region} options={regions.map((r) => ({ value: r, label: r }))} onChange={set('region')} placeholder="Region" title={`Regions in ${f.country}`} /> : <Muted>No regions set for {f.country} yet (Admin → Regions).</Muted>)}

      <Label>Contact email</Label><Input autoCapitalize="none" value={f.contact_email} onChangeText={set('contact_email')} />
      <Label>Contact phone</Label><PhoneField country={f.country} value={f.contact_phone} onChange={set('contact_phone')} />
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}><Text style={{ flex: 1 }}>WhatsApp is the same number</Text><Switch value={sameWa} onValueChange={setSameWa} /></View>
      {!sameWa && <><Label>WhatsApp number</Label><PhoneField country={f.country} value={f.contact_whatsapp} onChange={set('contact_whatsapp')} /></>}
      <Btn title="Submit for verification" onPress={submit} />
      <View style={{ height: 30 }} />
    </ScrollView>
  );
}
