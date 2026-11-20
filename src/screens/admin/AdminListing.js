import React, { useEffect, useState } from 'react';
import { ScrollView, View, Text, Alert, Linking } from 'react-native';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import { Btn, Card, Input, Label, Muted, Loader } from '../../components/ui';
import Img from '../../components/Img';
import MapView, { Marker } from '../../components/SafeMap';
import { DAYS, DAY_NAMES } from '../../lib/categories';
import { C } from '../../lib/theme';

// Admin review: EVERYTHING about one listing (any category) before approving, rejecting or hiding it.
const Row = ({ k, v }) => (v == null || v === '' || (Array.isArray(v) && !v.length)) ? null : (
  <View style={{ flexDirection: 'row', paddingVertical: 3 }}><Muted style={{ width: 128 }}>{k}</Muted><Text style={{ flex: 1, color: C.text }}>{Array.isArray(v) ? v.join(', ') : String(v)}</Text></View>);
const Block = ({ title, children }) => <Card><Text style={{ fontWeight: '800', fontSize: 16, marginBottom: 6 }}>{title}</Text>{children}</Card>;
const SCHED = { always: 'Ongoing (no end date)', range: 'Activity with an end date', tour: 'Tour / trip with start and end date', one_time: 'Happens once (date and time)' };

export default function AdminListing({ route, navigation }) {
  const { formatMoney } = useAuth();
  const { id } = route.params; const [d, setD] = useState(null); const [note, setNote] = useState('');
  useEffect(() => { (async () => {
    const { data: l } = await supabase.from('listings').select('*, providers(*)').eq('id', id).single();
    const [{ data: prices }, { data: contact }, { data: owner }, { data: ver }] = await Promise.all([
      supabase.from('listing_prices').select('*').eq('listing_id', id).order('kind'),
      supabase.from('listing_contacts').select('*').eq('listing_id', id).maybeSingle(),
      supabase.from('profiles').select('first_name,last_name,country,phone,gender,role,is_bnb_verified').eq('id', l.owner_id).maybeSingle(),
      supabase.from('host_verifications').select('status,legal_name,document_type,city').eq('user_id', l.owner_id).maybeSingle()]);
    setD({ l, prices: prices || [], contact, owner, ver }); setNote(l.admin_note || '');
    navigation.setOptions({ title: l.title });
  })(); }, [id]);
  if (!d) return <Loader />;
  const { l, prices, contact, owner, ver } = d; const p = l.providers || {};
  const openDoc = async (bucket, path) => { const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 600); if (data) Linking.openURL(data.signedUrl); else Alert.alert('File not found'); };
  const setStatus = async (status) => {
    if (status === 'rejected' && !note.trim()) return Alert.alert('Write a note', 'Tell the host what to fix before sending it back.');
    const { error } = await supabase.from('listings').update({ status, admin_note: status === 'approved' ? null : note.trim() || null }).eq('id', id);
    if (error) Alert.alert('Error', error.message); else { Alert.alert('Done', `Listing ${status}.`); navigation.goBack(); }
  };
  const when = l.event_date ? new Date(l.event_date).toLocaleString() : null;
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>{(l.photos.length ? l.photos : [null]).map((u, i) => <Img key={i} uri={u} category={l.category} style={{ width: 260, height: 170, marginRight: 4 }} />)}</ScrollView>
      <Block title={l.title}>
        <Row k="Category" v={l.category} /><Row k="Status" v={`${l.status}${l.verified_once ? ' · was verified before' : ''}`} /><Row k="Created" v={new Date(l.created_at).toLocaleString()} />
        <Row k="Description" v={l.description} /><Row k="Overnight accommodation" v={l.accommodation_available ? 'Available' : 'Not available'} /><Row k="Previous admin note" v={l.admin_note} />
      </Block>
      <Block title="Host and documents">
        <Row k="Business name" v={p.business_name} /><Row k="Registered as" v={p.category} /><Row k="Registration no." v={p.registration_number} /><Row k="TRA number" v={p.tra_number} />
        <Row k="Business status" v={p.verification} /><Row k="Business contact" v={[p.contact_email, p.contact_phone, p.contact_whatsapp].filter(Boolean)} />
        <Row k="Owner" v={`${owner?.first_name || ''} ${owner?.last_name || ''}`.trim()} /><Row k="Owner country" v={owner?.country} /><Row k="Owner phone" v={owner?.phone} />
        <Row k="Host ID check" v={ver ? `${ver.status} · ${ver.legal_name} (${ver.document_type}), ${ver.city}` : 'No ID submitted'} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {p.tra_image_path && <Btn style={{ margin: 2 }} kind="ghost" title="View TRA document" onPress={() => openDoc('provider-docs', p.tra_image_path)} />}
          {p.registration_document_url && <Btn style={{ margin: 2 }} kind="ghost" title="View registration document" onPress={() => openDoc('provider-docs', p.registration_document_url)} />}
        </View>
      </Block>
      <Block title="Place">
        <Row k="Country" v={l.country} /><Row k="City" v={l.city} /><Row k="Region" v={l.region} /><Row k="Location" v={l.location_name} /><Row k="Coordinates" v={l.lat != null ? `${l.lat}, ${l.lng}` : null} /><Row k="Google place id" v={l.google_place_id} />
        {l.lat != null && <View style={{ height: 170, borderRadius: 12, overflow: 'hidden', marginTop: 8 }}><MapView style={{ flex: 1 }} initialRegion={{ latitude: l.lat, longitude: l.lng, latitudeDelta: 0.05, longitudeDelta: 0.05 }}><Marker coordinate={{ latitude: l.lat, longitude: l.lng }} title={l.title} /></MapView></View>}
      </Block>
      <Block title="Schedule and limits">
        <Row k="Type" v={l.category === 'event' ? 'Event: happens once' : SCHED[l.schedule_type]} />
        {(l.schedule_type === 'range' || l.schedule_type === 'tour') && <Row k="Dates" v={`${l.starts_on} → ${l.ends_on}`} />}
        {l.schedule_type === 'tour' && <Row k="Departure time" v={l.open_time?.slice(0, 5)} />}
        {(l.category === 'event' || l.schedule_type === 'one_time') && <Row k="Date and time" v={when} />}
        <Row k="Daily limit" v={l.daily_limit ? `${l.daily_limit} guests per day` : 'Unlimited'} /><Row k="Free entrance" v={l.entrance_fee_free ? 'Yes' : null} />
        {!['tour', 'one_time'].includes(l.schedule_type) && l.category !== 'event' && (<View style={{ marginTop: 6 }}><Text style={{ fontWeight: '700' }}>Opening hours</Text>
          {DAYS.map((x) => { const h = l.opening_hours?.[x]; return <Row key={x} k={DAY_NAMES[x]} v={!h ? '—' : h.closed ? 'Closed' : `${h.open} – ${h.close}`} />; })}</View>)}
      </Block>
      <Block title="Amenities"><Row k="Amenities" v={l.facilities} />{!l.facilities?.length && <Muted>None listed</Muted>}</Block>
      <Block title={`Prices, facilities and activities (${prices.length})`}>
        {prices.length === 0 && <Muted>No prices added</Muted>}
        {prices.map((x) => (
          <View key={x.id} style={{ borderBottomWidth: 1, borderColor: C.border, paddingVertical: 8 }}>
            <Text style={{ fontWeight: '700' }}>{x.label} <Text style={{ color: C.muted, fontWeight: '400' }}>({x.kind})</Text></Text>
            <Muted>{x.audience} · {x.unit.replace('_', ' ')} · {Number(x.price) === 0 ? 'Free' : formatMoney(x.price)}{x.is_optional ? ' · optional' : ' · required'}</Muted>
            {x.description ? <Text style={{ marginTop: 2 }}>{x.description}</Text> : null}
            {['facility', 'activity'].includes(x.kind) && <Img uri={x.photo_url} category={l.category} style={{ height: 110, borderRadius: 10, marginTop: 6 }} />}
          </View>))}
      </Block>
      <Block title="Contact shown after booking"><Row k="Email" v={contact?.email} /><Row k="Phone" v={contact?.phone} /><Row k="WhatsApp" v={contact?.whatsapp} />{!contact && <Muted>No contact added</Muted>}</Block>
      <Card>
        <Label>Note to the host (required when rejecting)</Label><Input multiline value={note} onChangeText={setNote} placeholder="What should the host fix?" />
        <View style={{ flexDirection: 'row' }}>
          <Btn style={{ flex: 1, margin: 2 }} title="Approve" onPress={() => setStatus('approved')} />
          <Btn style={{ flex: 1, margin: 2 }} kind="danger" title="Reject / send back" onPress={() => setStatus('rejected')} />
        </View>
        {l.status === 'approved' && <Btn kind="ghost" title="Hide from guests" onPress={() => setStatus('hidden')} />}
      </Card>
    </ScrollView>
  );
}
