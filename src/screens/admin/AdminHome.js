import React, { useCallback, useEffect, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { pickLocation } from '../../lib/pickBus';
import CountryPicker from '../../components/CountryPicker';
import { View, Text, FlatList, Alert, ScrollView, Linking } from 'react-native';
import { supabase, PAGE_SIZE } from '../../lib/supabase';
import { pickAndUploadPhoto } from '../../lib/upload';
import { useAuth } from '../../lib/AuthContext';
import { Btn, Card, Chip, Input, Label, Muted, Pager } from '../../components/ui';

const TABS = ['Listings', 'Providers', 'Trips', 'Vehicles', 'Destinations', 'Payouts', 'Countries', 'Cities', 'Regions', 'Airports', 'Drop-offs', 'Host IDs', 'Form plans', 'Fees', 'Host balances', 'Legal', 'Settings'];
export default function AdminHome() {
  const [tab, setTab] = useState('Listings');
  return (<View style={{ flex: 1 }}>
    <View style={{ height: 50 }}><ScrollView horizontal contentContainerStyle={{ padding: 8 }}>{TABS.map(t => <Chip key={t} label={t} active={tab === t} onPress={() => setTab(t)} />)}</ScrollView></View>
    {tab === 'Listings' && <AdminListings />}
    {tab === 'Providers' && <Providers />}
    {tab === 'Trips' && <TripRequests />}
    {tab === 'Vehicles' && <Vehicles />}
    {tab === 'Destinations' && <Destinations />}
    {tab === 'Payouts' && <PayoutMethods />}
    {tab === 'Countries' && <Countries />}
    {tab === 'Cities' && <Cities />}
    {tab === 'Regions' && <Regions />}
    {tab === 'Airports' && <Airports />}
    {tab === 'Host IDs' && <HostIds />}
    {tab === 'Drop-offs' && <Dropoffs />}
    {tab === 'Legal' && <LegalAdmin />}
    {tab === 'Form plans' && <FormPlans />}
    {tab === 'Fees' && <Fees />}
    {tab === 'Host balances' && <HostBalances />}
    {tab === 'Settings' && <Settings />}
  </View>);
}

function Review({ table, label }) {
  const [rows, setRows] = useState([]); const [page, setPage] = useState(0); const [notes, setNotes] = useState({});
  const load = useCallback(async () => { const { data } = await supabase.from(table).select('*').eq('status', 'pending').range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE); setRows(data || []); }, [page]);
  useEffect(() => { load(); }, [load]);
  const act = async (id, ok) => { const { error } = await supabase.from(table).update({ status: ok ? 'approved' : 'rejected', admin_note: ok ? null : (notes[id] || 'Please review and resubmit') }).eq('id', id); if (error) Alert.alert('Error', error.message); load(); };
  return <FlatList data={rows.slice(0, PAGE_SIZE)} keyExtractor={(i) => i.id} ListEmptyComponent={<Muted style={{ textAlign: 'center', margin: 30 }}>Nothing pending</Muted>}
    ListFooterComponent={<Pager page={page} setPage={setPage} hasMore={rows.length > PAGE_SIZE} />}
    renderItem={({ item }) => <Card><Text style={{ fontWeight: '700' }}>{label(item)}</Text><Muted>{item.description?.slice(0, 120)}</Muted>
      <Input placeholder="Note to host if rejected" value={notes[item.id] || ''} onChangeText={(v) => setNotes({ ...notes, [item.id]: v })} />
      <View style={{ flexDirection: 'row' }}><Btn style={{ flex: 1, margin: 2 }} title="Approve" onPress={() => act(item.id, true)} /><Btn style={{ flex: 1, margin: 2 }} kind="danger" title="Reject" onPress={() => act(item.id, false)} /></View></Card>} />;
}

function Providers() {
  const [rows, setRows] = useState([]); const [page, setPage] = useState(0);
  const load = useCallback(async () => { const { data } = await supabase.from('providers').select('*').eq('verification', 'pending').range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE); setRows(data || []); }, [page]);
  useEffect(() => { load(); }, [load]);
  const doc = async (p) => { const { data } = await supabase.storage.from('provider-docs').createSignedUrl(p, 600); if (data) Linking.openURL(data.signedUrl); };
  const act = async (p, ok) => {
    if (ok) { const { data: hv } = await supabase.from('host_verifications').select('status').eq('user_id', p.user_id).maybeSingle(); if (hv?.status !== 'approved') return Alert.alert('Verify the host ID first', 'Approve the ID in the Host IDs tab, then verify the business.'); }
    const { error } = await supabase.from('providers').update({ verification: ok ? 'approved' : 'rejected' }).eq('id', p.id);
    if (!error && ok) await supabase.from('profiles').update({ role: 'provider', is_bnb_verified: ['airbnb', 'activity', 'event', 'guide'].includes(p.category) ? true : undefined }).eq('id', p.user_id);
    if (error) Alert.alert('Error', error.message); load();
  };
  return <FlatList data={rows.slice(0, PAGE_SIZE)} keyExtractor={(i) => i.id} ListEmptyComponent={<Muted style={{ textAlign: 'center', margin: 30 }}>No pending providers</Muted>}
    ListFooterComponent={<Pager page={page} setPage={setPage} hasMore={rows.length > PAGE_SIZE} />}
    renderItem={({ item: p }) => <Card><Text style={{ fontWeight: '700' }}>{p.business_name} · {p.category === 'activity' ? 'company / business' : p.category}</Text><Muted>{p.country}, {p.region} · {p.location_name}</Muted>
      {p.registration_number && <Text>Reg: {p.registration_number} · TRA: {p.tra_number}</Text>}
      {p.tra_image_path && <Btn kind="ghost" title="View TRA certificate (photo)" onPress={() => doc(p.tra_image_path)} />}
      {p.registration_document_url && <Btn kind="ghost" title="View registration document" onPress={() => doc(p.registration_document_url)} />}
      <View style={{ flexDirection: 'row' }}><Btn style={{ flex: 1, margin: 2 }} title="Verify" onPress={() => act(p, true)} /><Btn style={{ flex: 1, margin: 2 }} kind="danger" title="Reject" onPress={() => act(p, false)} /></View></Card>} />;
}

function TripRequests() {
  const [rows, setRows] = useState([]); const [counter, setCounter] = useState({});
  const load = () => supabase.from('custom_trip_requests').select('*').eq('status', 'pending').is('host_listing_id', null).order('created_at').then(({ data }) => setRows(data || []));
  useEffect(() => { load(); }, []);
  const act = async (id, status) => { await supabase.from('custom_trip_requests').update({ status, offered_price: status === 'countered' ? Number(counter[id]) : undefined }).eq('id', id); load(); };
  return <ScrollView>{rows.map(r => <Card key={r.id}><Text style={{ fontWeight: '700' }}>{r.is_company ? '🏢' : '👤'} {r.people} people · {r.days} days</Text><Muted>{r.activities.join(', ')} · offer ${r.offered_price ?? '-'}</Muted><Text>{r.note}</Text>
    <Input placeholder="Counter offer USD" keyboardType="decimal-pad" value={counter[r.id] || ''} onChangeText={(v) => setCounter({ ...counter, [r.id]: v })} />
    <View style={{ flexDirection: 'row' }}><Btn style={{ flex: 1, margin: 2 }} title="Accept" onPress={() => act(r.id, 'accepted')} /><Btn style={{ flex: 1, margin: 2 }} kind="ghost" title="Counter" onPress={() => act(r.id, 'countered')} /><Btn style={{ flex: 1, margin: 2 }} kind="danger" title="Reject" onPress={() => act(r.id, 'rejected')} /></View></Card>)}</ScrollView>;
}

function Vehicles() {
  const [rows, setRows] = useState([]); const [n, setN] = useState({ name: '', type: 'car', max_passengers: '4', base_fee: '5', price_per_km: '1' });
  const load = () => supabase.from('vehicles').select('*').order('max_passengers').then(({ data }) => setRows(data || []));
  useEffect(() => { load(); }, []);
  const add = async () => { const { error } = await supabase.from('vehicles').insert({ ...n, max_passengers: Number(n.max_passengers), base_fee: Number(n.base_fee), price_per_km: Number(n.price_per_km) }); if (error) Alert.alert('Error', error.message); load(); };
  const upd = async (id, patch) => { await supabase.from('vehicles').update(patch).eq('id', id); load(); };
  return <ScrollView>{rows.map(v => <Card key={v.id}><Text style={{ fontWeight: '700' }}>{v.name} ({v.type}) · max {v.max_passengers}</Text><Muted>${v.price_per_km}/km · base ${v.base_fee} · {v.active ? 'active' : 'off'}</Muted>
    <Btn kind="ghost" title={v.active ? 'Disable' : 'Enable'} onPress={() => upd(v.id, { active: !v.active })} /></Card>)}
    <View style={{ padding: 12 }}><Label>New vehicle</Label>{['name', 'type', 'max_passengers', 'base_fee', 'price_per_km'].map(k => <Input key={k} placeholder={k} value={n[k]} onChangeText={(v) => setN({ ...n, [k]: v })} />)}<Btn title="Add vehicle" onPress={add} /></View></ScrollView>;
}

function Destinations() {
  const { session } = useAuth();
  const [rows, setRows] = useState([]); const [n, setN] = useState({ name: '', country: 'Kenya', region: '', image_url: '', description: '', activities: '' });
  const load = () => supabase.from('destinations').select('*').order('name').then(({ data }) => setRows(data || []));
  useEffect(() => { load(); }, []);
  const add = async () => { const { error } = await supabase.from('destinations').insert({ ...n, activities: n.activities.split(',').map(s => s.trim()).filter(Boolean) }); if (error) Alert.alert('Error', error.message); else setN({ ...n, name: '' }); load(); };
  return <ScrollView>{rows.map(d => <Card key={d.id}><Text style={{ fontWeight: '700' }}>{d.name}</Text><Muted>{d.region}, {d.country} · {d.activities.join(', ')}</Muted>
    <Btn kind="danger" title="Remove" onPress={async () => { await supabase.from('destinations').delete().eq('id', d.id); load(); }} /></Card>)}
    <View style={{ padding: 12 }}><Label>New destination</Label><Btn kind="ghost" title={n.image_url ? '✅ Image uploaded (tap to replace)' : '🖼️ Upload destination image'} onPress={async () => { try { const u = await pickAndUploadPhoto(session.user.id, 'destination-images'); if (u) setN({ ...n, image_url: u }); } catch (e) { Alert.alert('Upload failed', e.message); } }} />{['name', 'country', 'region', 'description', 'activities'].map(k => <Input key={k} placeholder={k === 'activities' ? 'activities, comma separated' : k} value={n[k]} onChangeText={(v) => setN({ ...n, [k]: v })} />)}<Btn title="Add destination" onPress={add} /></View></ScrollView>;
}

function Settings() {
  const [s, setS] = useState(null);
  useEffect(() => { supabase.from('app_settings').select('*').eq('id', 1).single().then(({ data }) => setS(data)); }, []);
  if (!s) return null;
  const save = async () => { const { error } = await supabase.from('app_settings').update({ commission_percent: Number(s.commission_percent), subscription_price: Number(s.subscription_price), subscription_price_kes: Number(s.subscription_price_kes), unpaid_hold_hours: Number(s.unpaid_hold_hours), latest_version: s.latest_version, min_version: s.min_version, update_url: s.update_url || null, update_message: s.update_message || null, urgent_response_hours: Number(s.urgent_response_hours), normal_response_hours: Number(s.normal_response_hours) }).eq('id', 1); Alert.alert(error ? error.message : 'Saved'); };
  return <ScrollView contentContainerStyle={{ padding: 12 }}>
    <Label>Commission % per booking</Label><Input keyboardType="decimal-pad" value={String(s.commission_percent)} onChangeText={(v) => setS({ ...s, commission_percent: v })} />
    <Label>Host subscription price (KES, paid by M-Pesa)</Label><Input keyboardType="decimal-pad" value={String(s.subscription_price_kes ?? '')} onChangeText={(v) => setS({ ...s, subscription_price_kes: v })} />
    <Label>App update — newest version (e.g. 1.0.3)</Label><Input autoCapitalize="none" value={s.latest_version || ''} onChangeText={(v) => setS({ ...s, latest_version: v })} />
    <Label>Oldest version still allowed (users below this must update)</Label><Input autoCapitalize="none" value={s.min_version || ''} onChangeText={(v) => setS({ ...s, min_version: v })} />
    <Label>Update link (Play Store or build link)</Label><Input autoCapitalize="none" value={s.update_url || ''} onChangeText={(v) => setS({ ...s, update_url: v })} />
    <Label>Update message</Label><Input value={s.update_message || ''} onChangeText={(v) => setS({ ...s, update_message: v })} />
    <Label>Keep unpaid bookings for (hours)</Label><Input keyboardType="number-pad" value={String(s.unpaid_hold_hours ?? 5)} onChangeText={(v) => setS({ ...s, unpaid_hold_hours: v })} />
    <Label>Contacts subscription price</Label><Input keyboardType="decimal-pad" value={String(s.subscription_price)} onChangeText={(v) => setS({ ...s, subscription_price: v })} />
    <Label>Urgent response hours</Label><Input keyboardType="number-pad" value={String(s.urgent_response_hours)} onChangeText={(v) => setS({ ...s, urgent_response_hours: v })} />
    <Label>Normal response hours</Label><Input keyboardType="number-pad" value={String(s.normal_response_hours)} onChangeText={(v) => setS({ ...s, normal_response_hours: v })} />
    <Btn title="Save" onPress={save} /></ScrollView>;
}

function PayoutMethods() {
  const [rows, setRows] = useState([]); const [n, setN] = useState({ country: '', type: 'bank', name: '', bank_code: '', swift_code: '', branch_code: '', currency: '', instructions: '' });
  const load = () => supabase.from('payment_methods').select('*').order('country').order('name').then(({ data }) => setRows(data || []));
  useEffect(() => { load(); }, []);
  const add = async () => { const row = Object.fromEntries(Object.entries({ ...n, country: n.country || '*' }).map(([k, v]) => [k, v === '' ? null : v])); const { error } = await supabase.from('payment_methods').insert(row); if (error) Alert.alert('Error', error.message); else setN({ ...n, name: '', bank_code: '', swift_code: '', branch_code: '' }); load(); };
  return <ScrollView>{rows.map(x => <Card key={x.id}><Text style={{ fontWeight: '700' }}>{x.name} · {x.type}</Text><Muted>{x.country} · {x.currency || '-'}{x.swift_code ? ` · SWIFT ${x.swift_code}` : ''}{x.bank_code ? ` · code ${x.bank_code}` : ''}{x.active ? '' : ' · OFF'}</Muted>
    <View style={{ flexDirection: 'row' }}><Btn style={{ flex: 1, margin: 2 }} kind="ghost" title={x.active ? 'Disable' : 'Enable'} onPress={async () => { await supabase.from('payment_methods').update({ active: !x.active }).eq('id', x.id); load(); }} />
    <Btn style={{ flex: 1, margin: 2 }} kind="danger" title="Delete" onPress={async () => { await supabase.from('payment_methods').delete().eq('id', x.id); load(); }} /></View></Card>)}
    <View style={{ padding: 12 }}><Label>New payout method (country * = everywhere; type: bank, paypal, mobile_money, wise, other)</Label>
      {['country', 'type', 'name', 'bank_code', 'swift_code', 'branch_code', 'currency', 'instructions'].map(k => <Input key={k} placeholder={k} value={n[k]} onChangeText={(v) => setN({ ...n, [k]: v })} />)}<Btn title="Add method" onPress={add} /></View></ScrollView>;
}

function Countries() {
  const [rows, setRows] = useState([]); const [n, setN] = useState({ name: '', code: '', dial_code: '' });
  const load = () => supabase.from('countries').select('*').order('name').then(({ data }) => setRows(data || []));
  useEffect(() => { load(); }, []);
  const add = async () => { if (!n.name) return; const { error } = await supabase.from('countries').insert({ name: n.name.trim(), code: n.code.toUpperCase() || null, dial_code: n.dial_code || null }); if (error) Alert.alert('Error', error.message); else setN({ name: '', code: '', dial_code: '' }); load(); };
  return <ScrollView>
    <View style={{ padding: 12 }}><Label>Add country (users pick from this list)</Label>
      <Input placeholder="Name" value={n.name} onChangeText={(v) => setN({ ...n, name: v })} /><Input placeholder="ISO code (TZ)" autoCapitalize="characters" value={n.code} onChangeText={(v) => setN({ ...n, code: v })} />
      <Input placeholder="Dial code (+255)" value={n.dial_code} onChangeText={(v) => setN({ ...n, dial_code: v })} /><Btn title="Add country" onPress={add} /></View>
    {rows.map((c) => <Card key={c.id}><Text style={{ fontWeight: '700' }}>{c.name} {c.code ? `(${c.code})` : ''}</Text><Muted>{c.dial_code || ''}{c.active ? '' : ' · hidden'}</Muted>
      <View style={{ flexDirection: 'row' }}><Btn style={{ flex: 1, margin: 2 }} kind="ghost" title={c.active ? 'Hide' : 'Show'} onPress={async () => { await supabase.from('countries').update({ active: !c.active }).eq('id', c.id); load(); }} />
      <Btn style={{ flex: 1, margin: 2 }} kind="danger" title="Delete" onPress={async () => { await supabase.from('countries').delete().eq('id', c.id); load(); }} /></View></Card>)}</ScrollView>;
}

function Regions() {
  const [country, setCountry] = useState(''); const [rows, setRows] = useState([]); const [name, setName] = useState('');
  const load = async () => { if (!country) return setRows([]); const { data } = await supabase.from('country_divisions').select('id,name,active, countries!inner(name)').eq('countries.name', country).order('name'); setRows(data || []); };
  useEffect(() => { load(); }, [country]);
  const add = async () => { const { data: c } = await supabase.from('countries').select('id').eq('name', country).single(); const { error } = await supabase.from('country_divisions').insert({ country_id: c.id, name: name.trim() }); if (error) Alert.alert('Error', error.message); else setName(''); load(); };
  return <ScrollView><View style={{ padding: 12 }}><Label>Country</Label><CountryPicker value={country} onChange={setCountry} />
    {country ? <><Input placeholder="New region / county / state" value={name} onChangeText={setName} /><Btn title="Add region" onPress={add} /></> : null}</View>
    {rows.map((r) => <Card key={r.id}><Text style={{ fontWeight: '700' }}>{r.name}{r.active ? '' : ' (hidden)'}</Text><View style={{ flexDirection: 'row' }}>
      <Btn style={{ flex: 1, margin: 2 }} kind="ghost" title={r.active ? 'Hide' : 'Show'} onPress={async () => { await supabase.from('country_divisions').update({ active: !r.active }).eq('id', r.id); load(); }} />
      <Btn style={{ flex: 1, margin: 2 }} kind="danger" title="Delete" onPress={async () => { await supabase.from('country_divisions').delete().eq('id', r.id); load(); }} /></View></Card>)}</ScrollView>;
}

function Airports() {
  const nav = useNavigation(); const [rows, setRows] = useState([]); const [n, setN] = useState({ name: '', code: '', city: '', country: '' }); const [pt, setPt] = useState(null);
  const load = () => supabase.from('airports').select('*').order('country').order('name').then(({ data }) => setRows(data || []));
  useEffect(() => { load(); }, []);
  const add = async () => { if (!n.name || !n.country || !pt) return Alert.alert('Name, country and map location are required'); const { error } = await supabase.from('airports').insert({ ...n, code: n.code.toUpperCase() || null, lat: pt.lat, lng: pt.lng }); if (error) Alert.alert('Error', error.message); else { setN({ name: '', code: '', city: '', country: n.country }); setPt(null); } load(); };
  return <ScrollView><View style={{ padding: 12 }}><Label>Add airport (guests are picked up from these)</Label>
    <Input placeholder="Airport name" value={n.name} onChangeText={(v) => setN({ ...n, name: v })} /><Input placeholder="Code (JRO)" autoCapitalize="characters" value={n.code} onChangeText={(v) => setN({ ...n, code: v })} />
    <Input placeholder="City" value={n.city} onChangeText={(v) => setN({ ...n, city: v })} /><CountryPicker value={n.country} onChange={(v) => setN({ ...n, country: v })} />
    <Btn kind="ghost" title={pt ? `📍 ${pt.lat.toFixed(4)}, ${pt.lng.toFixed(4)}` : '🗺️ Pick location on map'} onPress={async () => { const r = await pickLocation(nav, 'Airport location'); if (r) setPt(r); }} />
    <Btn title="Add airport" onPress={add} /></View>
    {rows.map((a) => <Card key={a.id}><Text style={{ fontWeight: '700' }}>{a.code ? `${a.code} · ` : ''}{a.name}</Text><Muted>{a.city}, {a.country}{a.active ? '' : ' · hidden'}</Muted><View style={{ flexDirection: 'row' }}>
      <Btn style={{ flex: 1, margin: 2 }} kind="ghost" title={a.active ? 'Hide' : 'Show'} onPress={async () => { await supabase.from('airports').update({ active: !a.active }).eq('id', a.id); load(); }} />
      <Btn style={{ flex: 1, margin: 2 }} kind="danger" title="Delete" onPress={async () => { await supabase.from('airports').delete().eq('id', a.id); load(); }} /></View></Card>)}</ScrollView>;
}

function HostIds() {
  const [rows, setRows] = useState([]); const [note, setNote] = useState({});
  const load = () => supabase.from('host_verifications').select('*').eq('status', 'pending').order('submitted_at').then(({ data }) => setRows(data || []));
  useEffect(() => { load(); }, []);
  const view = async (path) => { if (!path) return; const { data } = await supabase.storage.from('host-verification').createSignedUrl(path, 600); if (data) Linking.openURL(data.signedUrl); };
  const act = async (r, ok) => { const { error } = await supabase.from('host_verifications').update({ status: ok ? 'approved' : 'rejected', rejection_reason: ok ? null : (note[r.id] || 'Please resubmit clear documents'), reviewed_at: new Date().toISOString() }).eq('id', r.id); if (error) Alert.alert('Error', error.message); load(); };
  return <ScrollView>{rows.length === 0 && <Muted style={{ textAlign: 'center', margin: 30 }}>No pending host IDs</Muted>}
    {rows.map((r) => <Card key={r.id}><Text style={{ fontWeight: '700' }}>{r.legal_name}</Text><Muted>{r.document_type} · {r.street_address}, {r.city}</Muted>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}><Btn style={{ margin: 2 }} kind="ghost" title="ID front" onPress={() => view(r.document_front_path)} />
        {r.document_back_path && <Btn style={{ margin: 2 }} kind="ghost" title="ID back" onPress={() => view(r.document_back_path)} />}<Btn style={{ margin: 2 }} kind="ghost" title="Selfie" onPress={() => view(r.selfie_path)} /></View>
      <Input placeholder="Reason if rejected" value={note[r.id] || ''} onChangeText={(v) => setNote({ ...note, [r.id]: v })} />
      <View style={{ flexDirection: 'row' }}><Btn style={{ flex: 1, margin: 2 }} title="Approve ID" onPress={() => act(r, true)} /><Btn style={{ flex: 1, margin: 2 }} kind="danger" title="Reject" onPress={() => act(r, false)} /></View></Card>)}</ScrollView>;
}

// Terms & privacy: the admin pastes the realtravo.com page address and/or the text, then publishes. Publishing asks everyone to confirm again.
function LegalAdmin() {
  const [docs, setDocs] = useState({}); const [edit, setEdit] = useState({});
  const load = () => supabase.from('legal_documents').select('*').then(({ data }) => { const m = {}; (data || []).forEach((d) => { m[d.kind] = d; }); setDocs(m); setEdit((e) => { const n = { ...e }; (data || []).forEach((d) => { if (!n[d.kind]) n[d.kind] = { url: d.url || '', content: d.content || '' }; }); return n; }); });
  useEffect(() => { load(); }, []);
  const publish = async (kind) => {
    const e = edit[kind] || {}; if (!e.url?.trim() && !e.content?.trim()) return Alert.alert('Add the page address or the text first');
    Alert.alert('Publish new version?', 'Every user must confirm it again before they can continue.', [{ text: 'Cancel' }, { text: 'Publish', onPress: async () => {
      const { error } = await supabase.rpc('publish_legal', { p_kind: kind, p_url: e.url || '', p_content: e.content || '' }); if (error) Alert.alert('Error', error.message); else { Alert.alert('Published'); load(); } } }]);
  };
  return <ScrollView contentContainerStyle={{ padding: 12 }} keyboardShouldPersistTaps="handled">
    {['terms', 'privacy'].map((k) => { const d = docs[k]; if (!d) return null; const e = edit[k] || { url: '', content: '' };
      return <Card key={k} style={{ marginHorizontal: 0 }}><Text style={{ fontWeight: '800', fontSize: 16 }}>{d.title}</Text>
        <Muted>{d.published ? `Published · version ${d.version}` : 'Not published yet'}</Muted>
        <Label>Page address (e.g. the realtravo.com page)</Label><Input autoCapitalize="none" placeholder="https://realtravo.com/..." value={e.url} onChangeText={(v) => setEdit({ ...edit, [k]: { ...e, url: v } })} />
        <Label>Or paste the text (shown inside the app instead of the page)</Label><Input multiline style={{ height: 160 }} value={e.content} onChangeText={(v) => setEdit({ ...edit, [k]: { ...e, content: v } })} />
        <Btn title="Publish new version" onPress={() => publish(k)} /></Card>; })}
  </ScrollView>;
}

function Cities() {
  const [country, setCountry] = useState(''); const [rows, setRows] = useState([]); const [name, setName] = useState('');
  const load = async () => { if (!country) return setRows([]); const { data } = await supabase.from('cities').select('id,name,active, countries!inner(name)').eq('countries.name', country).order('name'); setRows(data || []); };
  useEffect(() => { load(); }, [country]);
  const add = async () => { const { data: c } = await supabase.from('countries').select('id').eq('name', country).single(); const { error } = await supabase.from('cities').insert({ country_id: c.id, name: name.trim() }); if (error) Alert.alert('Error', error.message); else setName(''); load(); };
  return <ScrollView><View style={{ padding: 12 }}><Label>Country</Label><CountryPicker value={country} onChange={setCountry} />
    {country ? <><Input placeholder="New city" value={name} onChangeText={setName} /><Btn title="Add city" onPress={add} /></> : null}</View>
    {rows.map((r) => <Card key={r.id}><Text style={{ fontWeight: '700' }}>{r.name}{r.active ? '' : ' (hidden)'}</Text><View style={{ flexDirection: 'row' }}>
      <Btn style={{ flex: 1, margin: 2 }} kind="ghost" title={r.active ? 'Hide' : 'Show'} onPress={async () => { await supabase.from('cities').update({ active: !r.active }).eq('id', r.id); load(); }} />
      <Btn style={{ flex: 1, margin: 2 }} kind="danger" title="Delete" onPress={async () => { await supabase.from('cities').delete().eq('id', r.id); load(); }} /></View></Card>)}</ScrollView>;
}

// Booking-form plans: price per form, monthly with a limit, annual unlimited (prices in KES, set here by the admin)
function FormPlans() {
  const [rows, setRows] = useState([]); const [n, setN] = useState({ name: '', kind: 'monthly', price_kes: '', form_limit: '' });
  const load = () => supabase.from('form_plans').select('*').order('price_kes').then(({ data }) => setRows(data || []));
  useEffect(() => { load(); }, []);
  const add = async () => { if (!n.name || !n.price_kes) return Alert.alert('Name and price are required'); const { error } = await supabase.from('form_plans').insert({ name: n.name, kind: n.kind, price_kes: Number(n.price_kes), form_limit: n.kind === 'annual' ? null : (n.form_limit ? Number(n.form_limit) : (n.kind === 'per_form' ? 1 : null)) }); if (error) Alert.alert('Error', error.message); else setN({ name: '', kind: 'monthly', price_kes: '', form_limit: '' }); load(); };
  return <ScrollView keyboardShouldPersistTaps="handled">{rows.map((p) => <Card key={p.id}><Text style={{ fontWeight: '700' }}>{p.name}</Text><Muted>{p.kind} · KES {p.price_kes} · {p.form_limit == null ? 'unlimited' : `${p.form_limit} form(s)`}{p.active ? '' : ' · off'}</Muted>
    <View style={{ flexDirection: 'row' }}><Btn style={{ flex: 1, margin: 2 }} kind="ghost" title={p.active ? 'Turn off' : 'Turn on'} onPress={async () => { await supabase.from('form_plans').update({ active: !p.active }).eq('id', p.id); load(); }} />
    <Btn style={{ flex: 1, margin: 2 }} kind="danger" title="Delete" onPress={async () => { await supabase.from('form_plans').delete().eq('id', p.id); load(); }} /></View></Card>)}
    <View style={{ padding: 12 }}><Label>New plan</Label><Input placeholder="Name" value={n.name} onChangeText={(v) => setN({ ...n, name: v })} />
      <View style={{ flexDirection: 'row' }}>{['per_form', 'monthly', 'annual'].map((k) => <Chip key={k} label={k} active={n.kind === k} onPress={() => setN({ ...n, kind: k })} />)}</View>
      <Input placeholder="Price (KES)" keyboardType="decimal-pad" value={n.price_kes} onChangeText={(v) => setN({ ...n, price_kes: v })} />
      {n.kind !== 'annual' && <Input placeholder="Number of forms allowed (e.g. 4)" keyboardType="number-pad" value={n.form_limit} onChangeText={(v) => setN({ ...n, form_limit: v })} />}
      <Btn title="Add plan" onPress={add} /></View></ScrollView>;
}

// Platform charge per category (percent of each booking)
function Fees() {
  const [rows, setRows] = useState([]); const [v, setV] = useState({});
  const load = () => supabase.from('category_fees').select('*').order('category').then(({ data }) => { setRows(data || []); setV(Object.fromEntries((data || []).map((r) => [r.category, String(r.commission_percent)]))); });
  useEffect(() => { load(); }, []);
  const save = async (c) => { const { error } = await supabase.from('category_fees').update({ commission_percent: Number(v[c]) }).eq('category', c); Alert.alert(error ? error.message : 'Saved'); };
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 12 }}><Muted>Each category has its own charge. Hosts see the deduction in their earnings.</Muted>
    {rows.map((r) => <Card key={r.category} style={{ marginHorizontal: 0 }}><Text style={{ fontWeight: '700' }}>{r.category}</Text><Input keyboardType="decimal-pad" value={v[r.category]} onChangeText={(t) => setV({ ...v, [r.category]: t })} /><Btn kind="ghost" title="Save %" onPress={() => save(r.category)} /></Card>)}</ScrollView>;
}

// What each host earned, was paid, and is still owed; record a payout
function HostBalances() {
  const [rows, setRows] = useState([]); const [amt, setAmt] = useState({});
  const load = () => supabase.rpc('admin_host_balances').then(({ data }) => setRows(data || []));
  useEffect(() => { load(); }, []);
  const pay = async (h) => { const a = Number(amt[h.host_id]); if (!(a > 0)) return Alert.alert('Enter the amount you paid'); const { data: u } = await supabase.auth.getUser(); const { error } = await supabase.from('host_payouts').insert({ host_id: h.host_id, amount: a, created_by: u.user.id, note: 'Recorded by admin' }); if (error) Alert.alert('Error', error.message); else { setAmt({ ...amt, [h.host_id]: '' }); load(); } };
  return <ScrollView keyboardShouldPersistTaps="handled">{rows.length === 0 && <Muted style={{ textAlign: 'center', margin: 30 }}>No hosts yet</Muted>}
    {rows.map((h) => <Card key={h.host_id}><Text style={{ fontWeight: '700' }}>{h.name || 'Host'}</Text><Muted>Earned ${Number(h.net).toFixed(2)} · paid out ${Number(h.paid_out).toFixed(2)}</Muted>
      <Text style={{ fontSize: 18, fontWeight: '800' }}>Owed: ${Number(h.balance).toFixed(2)}</Text>
      <Input placeholder="Amount you paid the host" keyboardType="decimal-pad" value={amt[h.host_id] || ''} onChangeText={(t) => setAmt({ ...amt, [h.host_id]: t })} /><Btn kind="ghost" title="Record payout" onPress={() => pay(h)} /></Card>)}</ScrollView>;
}

// Every listing from every category, filterable by status; open one to see all of its details
function AdminListings() {
  const nav = useNavigation(); const [status, setStatus] = useState('pending'); const [rows, setRows] = useState([]); const [page, setPage] = useState(0);
  const load = useCallback(async () => {
    let q = supabase.from('listings').select('id,title,category,status,country,region,created_at,schedule_type,providers(business_name)').is('deleted_at', null).order('created_at', { ascending: false }).range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
    if (status !== 'all') q = q.eq('status', status);
    const { data } = await q; setRows(data || []);
  }, [status, page]);
  useEffect(() => { setPage(0); }, [status]);
  useEffect(() => { const u = nav.addListener('focus', load); load(); return u; }, [load]);
  return <View style={{ flex: 1 }}>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', padding: 8 }}>{['pending', 'approved', 'rejected', 'hidden', 'all'].map((x) => <View key={x} style={{ marginBottom: 4 }}><Chip label={x} active={status === x} onPress={() => setStatus(x)} /></View>)}</View>
    <FlatList data={rows.slice(0, PAGE_SIZE)} keyExtractor={(i) => i.id} ListEmptyComponent={<Muted style={{ textAlign: 'center', margin: 30 }}>No {status} listings</Muted>}
      ListFooterComponent={<Pager page={page} setPage={setPage} hasMore={rows.length > PAGE_SIZE} />}
      renderItem={({ item }) => <Card><Text style={{ fontWeight: '700' }}>{item.title}</Text>
        <Muted>{item.category}{item.schedule_type !== 'always' ? ` · ${item.schedule_type.replace('_', ' ')}` : ''} · {item.region || item.country} · {item.providers?.business_name || 'host'}</Muted>
        <Text>Status: {item.status} · {new Date(item.created_at).toLocaleDateString()}</Text>
        <Btn title="Open full details" onPress={() => nav.navigate('AdminListing', { id: item.id })} /></Card>} />
  </View>;
}

// Drop-off places are private: only the guest and the admin can read them (hosts cannot).
function Dropoffs() {
  const [rows, setRows] = useState([]); const [page, setPage] = useState(0);
  useEffect(() => { supabase.from('booking_dropoffs').select('*, bookings(start_date,return_date,return_time,listings(title))').order('created_at', { ascending: false }).range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE).then(({ data }) => setRows(data || [])); }, [page]);
  return <FlatList data={rows.slice(0, PAGE_SIZE)} keyExtractor={(i) => i.booking_id} ListEmptyComponent={<Muted style={{ textAlign: 'center', margin: 30 }}>No drop-offs yet</Muted>}
    ListFooterComponent={<Pager page={page} setPage={setPage} hasMore={rows.length > PAGE_SIZE} />}
    renderItem={({ item: d }) => <Card><Text style={{ fontWeight: '700' }}>{d.bookings?.listings?.title}</Text><Muted>{d.bookings?.start_date}{d.bookings?.return_date ? ` · return ${d.bookings.return_date} ${(d.bookings.return_time || '').slice(0, 5)}` : ''}</Muted>
      <Text>🏁 {d.dropoff_location}</Text><Muted>{d.dropoff_lat}, {d.dropoff_lng}</Muted></Card>} />;
}
