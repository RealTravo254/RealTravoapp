import React, { useCallback, useEffect, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { pickLocation } from '../../lib/pickBus';
import CountryPicker from '../../components/CountryPicker';
import { View, Text, FlatList, Alert, ScrollView, Linking } from 'react-native';
import { supabase, PAGE_SIZE } from '../../lib/supabase';
import { pickAndUploadPhoto } from '../../lib/upload';
import { useAuth } from '../../lib/AuthContext';
import { Btn, Card, Chip, Input, Label, Loader, Muted, Pager } from '../../components/ui';
import { Ionicons } from '@expo/vector-icons';
import { C } from '../../lib/theme';
import { ADMIN_PAGES } from './adminPages';
import { canManageAdminPage, canViewAdminPage, fetchAdminAccess } from './adminAccess';
import AdminPayouts from './AdminPayouts';

const SECTION_COMPONENTS = {
  listings: AdminListings, providers: Providers, trips: TripRequests, vehicles: Vehicles,
  destinations: Destinations, payouts: PayoutMethods, countries: Countries, cities: Cities,
  regions: Regions, airports: Airports, dropoffs: Dropoffs, host_ids: HostIds,
  fees: Fees, host_balances: AdminPayouts, legal: LegalAdmin, settings: Settings,
};

export default function AdminHome({ navigation }) {
  const [access, setAccess] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetchAdminAccess().then(setAccess).catch((error) => Alert.alert('Could not load admin access', error.message))
      .finally(() => setLoading(false));
  }, []);
  if (loading) return <Loader />;
  const pages = ADMIN_PAGES.filter((page) => canViewAdminPage(access, page.key));
  return (
    <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 30 }}>
      <View style={{ backgroundColor: C.deep, borderRadius: 18, padding: 20, marginBottom: 14 }}>
        <Text style={{ color: '#fff', fontSize: 24, fontWeight: '900' }}>Admin workspace</Text>
        <Text style={{ color: '#D5E4DD', marginTop: 6 }}>Choose a section to open its own page.</Text>
      </View>
      {access?.is_super_admin && (
        <Card onPress={() => navigation.navigate('AdminUsers')} style={{ marginHorizontal: 0, borderColor: C.primary }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Ionicons name="people-outline" size={26} color={C.primary} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={{ color: C.text, fontSize: 16, fontWeight: '800' }}>Admin access</Text>
              <Muted>Add admins and choose their page permissions.</Muted>
            </View>
            <Ionicons name="chevron-forward" size={20} color={C.muted} />
          </View>
        </Card>
      )}
      {pages.map((page) => {
        const manageable = canManageAdminPage(access, page.key);
        return (
          <Card key={page.key} onPress={() => navigation.navigate('AdminSection', { pageKey: page.key })} style={{ marginHorizontal: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name={page.icon} size={25} color={C.primary} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={{ color: C.text, fontSize: 16, fontWeight: '800' }}>{page.title}</Text>
                <Muted>{page.description}</Muted>
              </View>
              <Text style={{ color: manageable ? C.primary : C.muted, fontSize: 11, fontWeight: '700', marginRight: 6 }}>
                {manageable ? 'MANAGE' : 'VIEW'}
              </Text>
              <Ionicons name="chevron-forward" size={18} color={C.muted} />
            </View>
          </Card>
        );
      })}
      {!pages.length && !access?.is_super_admin && <Muted style={{ marginTop: 20, textAlign: 'center' }}>No admin pages have been assigned to your account.</Muted>}
    </ScrollView>
  );
}

export function AdminSection({ route, navigation }) {
  const { pageKey } = route.params || {};
  const [access, setAccess] = useState(null);
  const [loading, setLoading] = useState(true);
  const page = ADMIN_PAGES.find((item) => item.key === pageKey);
  useEffect(() => {
    setAccess(null);
    setLoading(true);
    if (page) navigation.setOptions({ title: page.title });
    fetchAdminAccess().then(setAccess).catch((error) => Alert.alert('Could not load admin access', error.message))
      .finally(() => setLoading(false));
  }, [pageKey, navigation]);
  if (loading) return <Loader />;
  if (!page || !canViewAdminPage(access, page.key)) {
    return <View style={{ padding: 20 }}><Muted>You do not have permission to view this admin page.</Muted></View>;
  }
  const Section = SECTION_COMPONENTS[page.key];
  if (!Section) return <View style={{ padding: 20 }}><Muted>This admin page is unavailable.</Muted></View>;
  return <Section canManage={canManageAdminPage(access, page.key)} />;
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

function Providers({ canManage }) {
  const [rows, setRows] = useState([]); const [page, setPage] = useState(0);
  const load = useCallback(async () => { const { data } = await supabase.from('providers').select('*').eq('verification', 'pending').order('created_at').range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE); setRows(data || []); }, [page]);
  useEffect(() => { load(); }, [load]);
  const doc = async (p) => { const { data } = await supabase.storage.from('provider-docs').createSignedUrl(p, 600); if (data) Linking.openURL(data.signedUrl); };
  const act = async (p, ok) => {
    if (ok) { const { data: status, error: statusError } = await supabase.rpc('admin_provider_identity_status', { p_user: p.user_id }); if (statusError) return Alert.alert('Could not check host ID', statusError.message); if (status !== 'approved') return Alert.alert('Verify the host ID first', 'Approve the ID in the Host IDs page, then verify the business.'); }
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
      {canManage && <View style={{ flexDirection: 'row' }}><Btn style={{ flex: 1, margin: 2 }} title="Verify" onPress={() => act(p, true)} /><Btn style={{ flex: 1, margin: 2 }} kind="danger" title="Reject" onPress={() => act(p, false)} /></View>}</Card>} />;
}

function TripRequests({ canManage }) {
  const { formatMoney } = useAuth();
  const [rows, setRows] = useState([]); const [counter, setCounter] = useState({});
  const [noShows, setNoShows] = useState([]);
  const [page, setPage] = useState(0); const [noShowPage, setNoShowPage] = useState(0);
  const load = async () => {
    const [requests, reports] = await Promise.all([
      supabase.from('custom_trip_requests').select('*').eq('status', 'pending').is('host_listing_id', null).order('created_at').range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
      supabase.from('bookings').select('*, listings(title,category,providers(business_name))').eq('no_show_resolution', 'pending').order('no_show_reported_at').range(noShowPage * PAGE_SIZE, noShowPage * PAGE_SIZE + PAGE_SIZE),
    ]);
    if (requests.error) Alert.alert('Could not load trip requests', requests.error.message);
    if (reports.error) Alert.alert('Could not load no-show reports', reports.error.message);
    setRows(requests.data || []);
    setNoShows(reports.data || []);
  };
  useEffect(() => { load(); }, [page, noShowPage]);
  const act = async (id, status) => { const { error } = await supabase.from('custom_trip_requests').update({ status, offered_price: status === 'countered' ? Number(counter[id]) : undefined }).eq('id', id); if (error) Alert.alert('Could not update request', error.message); else load(); };
  const resolveNoShow = (booking, resolution) => {
    const refund = resolution === 'refund_guest';
    Alert.alert(
      'Confirm guest contact',
      'Only continue after contacting the guest and confirming the outcome.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: refund ? 'Refund guest balance' : 'Release earnings to host',
          style: refund ? 'destructive' : 'default',
          onPress: async () => {
            const { error } = await supabase.rpc('resolve_booking_no_show', {
              p_booking: booking.id,
              p_resolution: resolution,
              p_note: 'Admin confirmed with the guest.',
            });
            if (error) Alert.alert('Could not resolve no-show', error.message);
            else { Alert.alert('Resolved', refund ? 'The booking total was refunded to the guest balance.' : 'The booking earnings are now included in the host balance.'); load(); }
          },
        },
      ],
    );
  };
  return <ScrollView>
    <Text style={{ fontSize: 18, fontWeight: '800', margin: 12 }}>Activity and guided-trip no-shows</Text>
    {noShows.length === 0 && <Muted style={{ marginHorizontal: 12, marginBottom: 8 }}>No no-show reports awaiting review.</Muted>}
    {noShows.slice(0, PAGE_SIZE).map((b) => <Card key={b.id}>
      <Text style={{ fontWeight: '800' }}>{b.listings?.title || 'Activity booking'} · {b.listings?.category}</Text>
      <Muted>Host: {b.listings?.providers?.business_name || 'Host'} · Guest: {b.contact_email || 'No contact email'} </Muted>
      <Muted>{b.start_date}{b.start_time ? ` · ${b.start_time.slice(0, 5)}` : ''} · {formatMoney(b.total)} · Reported {new Date(b.no_show_reported_at).toLocaleString()}</Muted>
      {b.contact_email && <Btn kind="ghost" title="Email guest" onPress={() => Linking.openURL(`mailto:${b.contact_email}`)} />}
      {canManage && <View style={{ flexDirection: 'row' }}>
        <Btn style={{ flex: 1, margin: 2 }} kind="danger" title="Refund guest" onPress={() => resolveNoShow(b, 'refund_guest')} />
        <Btn style={{ flex: 1, margin: 2 }} title="Release to host" onPress={() => resolveNoShow(b, 'pay_host')} />
      </View>}
    </Card>)}
    <Pager page={noShowPage} setPage={setNoShowPage} hasMore={noShows.length > PAGE_SIZE} />
    <Text style={{ fontSize: 18, fontWeight: '800', margin: 12 }}>Custom trip requests</Text>
    {rows.slice(0, PAGE_SIZE).map(r => <Card key={r.id}><Text style={{ fontWeight: '700' }}>{r.is_company ? '🏢' : '👤'} {r.people} people · {r.days} days</Text><Muted>{(r.activities || []).join(', ')} · offer {r.offered_price == null ? '-' : formatMoney(r.offered_price)}</Muted><Text>{r.note}</Text>
    {canManage && <><Input placeholder="Counter offer USD" keyboardType="decimal-pad" value={counter[r.id] || ''} onChangeText={(v) => setCounter({ ...counter, [r.id]: v })} />
    <View style={{ flexDirection: 'row' }}><Btn style={{ flex: 1, margin: 2 }} title="Accept" onPress={() => act(r.id, 'accepted')} /><Btn style={{ flex: 1, margin: 2 }} kind="ghost" title="Counter" onPress={() => act(r.id, 'countered')} /><Btn style={{ flex: 1, margin: 2 }} kind="danger" title="Reject" onPress={() => act(r.id, 'rejected')} /></View></>}</Card>)}
    <Pager page={page} setPage={setPage} hasMore={rows.length > PAGE_SIZE} />
  </ScrollView>;
}

// Vehicles / car types: admin adds, edits, enables or removes. Guests only see the total price.
function Vehicles({ canManage }) {
  const empty = { name: '', type: 'car', max_passengers: '4', base_fee: '5', price_per_km: '1' };
  const [rows, setRows] = useState([]); const [n, setN] = useState(empty); const [editId, setEditId] = useState(null); const [page, setPage] = useState(0);
  const load = () => supabase.from('vehicles').select('*').order('max_passengers').range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE).then(({ data, error }) => { if (error) Alert.alert('Could not load vehicles', error.message); else setRows(data || []); });
  useEffect(() => { load(); }, [page]);
  const save = async () => {
    if (!n.name) return Alert.alert('Enter the vehicle name');
    const row = { name: n.name, type: n.type, max_passengers: Number(n.max_passengers), base_fee: Number(n.base_fee), price_per_km: Number(n.price_per_km) };
    const { error } = editId ? await supabase.from('vehicles').update(row).eq('id', editId) : await supabase.from('vehicles').insert(row);
    if (error) Alert.alert('Error', error.message); else { setN(empty); setEditId(null); } load();
  };
  const upd = async (id, patch) => { await supabase.from('vehicles').update(patch).eq('id', id); load(); };
  const FIELDS = [['name', 'Name (e.g. Toyota Noah)'], ['type', 'Type (car, van, bus)'], ['max_passengers', 'Max passengers'], ['base_fee', 'Base fee (USD)'], ['price_per_km', 'Price per km (USD)']];
  return <ScrollView keyboardShouldPersistTaps="handled">{rows.slice(0, PAGE_SIZE).map((v) => <Card key={v.id}><Text style={{ fontWeight: '700' }}>{v.name} ({v.type}) · max {v.max_passengers}</Text>
    <Muted>${v.price_per_km}/km · base ${v.base_fee} · {v.active ? 'active' : 'off'} (guests see only the total)</Muted>
    {canManage && <View style={{ flexDirection: 'row' }}>
      <Btn style={{ flex: 1, margin: 2 }} kind="ghost" title="Edit" onPress={() => { setEditId(v.id); setN({ name: v.name, type: v.type, max_passengers: String(v.max_passengers), base_fee: String(v.base_fee), price_per_km: String(v.price_per_km) }); }} />
      <Btn style={{ flex: 1, margin: 2 }} kind="ghost" title={v.active ? 'Disable' : 'Enable'} onPress={() => upd(v.id, { active: !v.active })} />
      <Btn style={{ flex: 1, margin: 2 }} kind="danger" title="Delete" onPress={async () => { await supabase.from('vehicles').delete().eq('id', v.id); load(); }} /></View>}</Card>)}
    <Pager page={page} setPage={setPage} hasMore={rows.length > PAGE_SIZE} />
    {canManage && <View style={{ padding: 12 }}><Label>{editId ? 'Edit vehicle' : 'New vehicle'}</Label>
      {FIELDS.map(([k, p]) => <Input key={k} placeholder={p} keyboardType={['max_passengers', 'base_fee', 'price_per_km'].includes(k) ? 'decimal-pad' : 'default'} value={n[k]} onChangeText={(v) => setN({ ...n, [k]: v })} />)}
      <Btn title={editId ? 'Save changes' : 'Add vehicle'} onPress={save} />
      {editId && <Btn kind="ghost" title="Cancel edit" onPress={() => { setEditId(null); setN(empty); }} />}</View>}</ScrollView>;
}

function Destinations({ canManage }) {
  const { session } = useAuth();
  const [rows, setRows] = useState([]); const [n, setN] = useState({ name: '', country: 'Kenya', region: '', image_url: '', description: '', activities: '' }); const [page, setPage] = useState(0);
  const load = () => supabase.from('destinations').select('*').order('name').range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE).then(({ data, error }) => { if (error) Alert.alert('Could not load destinations', error.message); else setRows(data || []); });
  useEffect(() => { load(); }, [page]);
  const add = async () => { const { error } = await supabase.from('destinations').insert({ ...n, activities: n.activities.split(',').map(s => s.trim()).filter(Boolean) }); if (error) Alert.alert('Error', error.message); else setN({ ...n, name: '' }); load(); };
  return <ScrollView>{rows.slice(0, PAGE_SIZE).map(d => <Card key={d.id}><Text style={{ fontWeight: '700' }}>{d.name}</Text><Muted>{d.region}, {d.country} · {d.activities.join(', ')}</Muted>
    {canManage && <Btn kind="danger" title="Remove" onPress={async () => { const { error } = await supabase.from('destinations').delete().eq('id', d.id); if (error) Alert.alert('Could not remove destination', error.message); else load(); }} />}</Card>)}
    <Pager page={page} setPage={setPage} hasMore={rows.length > PAGE_SIZE} />
    {canManage && <View style={{ padding: 12 }}><Label>New destination</Label><Btn kind="ghost" title={n.image_url ? '✅ Image uploaded (tap to replace)' : '🖼️ Upload destination image'} onPress={async () => { try { const u = await pickAndUploadPhoto(session.user.id, 'destination-images'); if (u) setN({ ...n, image_url: u }); } catch (e) { Alert.alert('Upload failed', e.message); } }} />{['name', 'country', 'region', 'description', 'activities'].map(k => <Input key={k} placeholder={k === 'activities' ? 'activities, comma separated' : k} value={n[k]} onChangeText={(v) => setN({ ...n, [k]: v })} />)}<Btn title="Add destination" onPress={add} /></View>}</ScrollView>;
}

function Settings({ canManage }) {
  const [s, setS] = useState(null);
  useEffect(() => { supabase.from('app_settings').select('*').eq('id', 1).single().then(({ data }) => setS(data)); }, []);
  if (!s) return <Loader />;
  const readOnly = canManage ? {} : { editable: false };
  const save = async () => {
    if (!canManage) return;
    const rate = Number(s.kes_per_usd);
    if (!Number.isFinite(rate) || rate <= 0) return Alert.alert('Exchange rate', 'Enter how many Kenyan shillings equal one US dollar.');
    const { error } = await supabase.from('app_settings').update({ commission_percent: Number(s.commission_percent), subscription_price: Number(s.subscription_price), subscription_price_kes: Number(s.subscription_price_kes), unpaid_hold_hours: Number(s.unpaid_hold_hours), latest_version: s.latest_version, min_version: s.min_version, update_url: s.update_url || null, update_message: s.update_message || null, urgent_response_hours: Number(s.urgent_response_hours), normal_response_hours: Number(s.normal_response_hours), custom_cancel_fee_percent: Number(s.custom_cancel_fee_percent ?? 20), kes_per_usd: rate }).eq('id', 1);
    Alert.alert(error ? error.message : 'Saved');
  };
  return <ScrollView contentContainerStyle={{ padding: 12 }}>
    <Label>Commission % per booking</Label><Input {...readOnly} keyboardType="decimal-pad" value={String(s.commission_percent)} onChangeText={(v) => setS({ ...s, commission_percent: v })} />
    <Label>Exchange rate (KES per 1 USD)</Label><Input {...readOnly} keyboardType="decimal-pad" value={String(s.kes_per_usd ?? '')} onChangeText={(v) => setS({ ...s, kes_per_usd: v })} />
    <Label>Host subscription price (KES, paid by M-Pesa)</Label><Input {...readOnly} keyboardType="decimal-pad" value={String(s.subscription_price_kes ?? '')} onChangeText={(v) => setS({ ...s, subscription_price_kes: v })} />
    <Label>App update — newest version (e.g. 1.0.3)</Label><Input {...readOnly} autoCapitalize="none" value={s.latest_version || ''} onChangeText={(v) => setS({ ...s, latest_version: v })} />
    <Label>Oldest version still allowed (users below this must update)</Label><Input {...readOnly} autoCapitalize="none" value={s.min_version || ''} onChangeText={(v) => setS({ ...s, min_version: v })} />
    <Label>Update link (Play Store or build link)</Label><Input {...readOnly} autoCapitalize="none" value={s.update_url || ''} onChangeText={(v) => setS({ ...s, update_url: v })} />
    <Label>Update message</Label><Input {...readOnly} value={s.update_message || ''} onChangeText={(v) => setS({ ...s, update_message: v })} />
    <Label>Keep unpaid bookings for (hours)</Label><Input {...readOnly} keyboardType="number-pad" value={String(s.unpaid_hold_hours ?? 5)} onChangeText={(v) => setS({ ...s, unpaid_hold_hours: v })} />
    <Label>Contacts subscription price</Label><Input {...readOnly} keyboardType="decimal-pad" value={String(s.subscription_price)} onChangeText={(v) => setS({ ...s, subscription_price: v })} />
    <Label>Urgent response hours</Label><Input {...readOnly} keyboardType="number-pad" value={String(s.urgent_response_hours)} onChangeText={(v) => setS({ ...s, urgent_response_hours: v })} />
    <Label>Normal response hours</Label><Input {...readOnly} keyboardType="number-pad" value={String(s.normal_response_hours)} onChangeText={(v) => setS({ ...s, normal_response_hours: v })} />
    <Label>Custom trip: cancellation fee % per cancelled item</Label><Input {...readOnly} keyboardType="decimal-pad" value={String(s.custom_cancel_fee_percent ?? 20)} onChangeText={(v) => setS({ ...s, custom_cancel_fee_percent: v })} />
    {canManage && <Btn title="Save" onPress={save} />}</ScrollView>;
}

function PayoutMethods({ canManage }) {
  const [rows, setRows] = useState([]); const [n, setN] = useState({ country: '', type: 'bank', name: '', bank_code: '', swift_code: '', branch_code: '', currency: '', instructions: '' });
  const [page, setPage] = useState(0);
  const load = () => supabase.from('payment_methods').select('*').order('country').order('name').range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE).then(({ data, error }) => { if (error) Alert.alert('Could not load payout methods', error.message); else setRows(data || []); });
  useEffect(() => { load(); }, [page]);
  const add = async () => { const row = Object.fromEntries(Object.entries({ ...n, country: n.country || '*' }).map(([k, v]) => [k, v === '' ? null : v])); const { error } = await supabase.from('payment_methods').insert(row); if (error) Alert.alert('Error', error.message); else setN({ ...n, name: '', bank_code: '', swift_code: '', branch_code: '' }); load(); };
  return <ScrollView>{rows.slice(0, PAGE_SIZE).map(x => <Card key={x.id}><Text style={{ fontWeight: '700' }}>{x.name} · {x.type}</Text><Muted>{x.country} · {x.currency || '-'}{x.swift_code ? ` · SWIFT ${x.swift_code}` : ''}{x.bank_code ? ` · code ${x.bank_code}` : ''}{x.active ? '' : ' · OFF'}</Muted>
    {canManage &&
    <View style={{ flexDirection: 'row' }}><Btn style={{ flex: 1, margin: 2 }} kind="ghost" title={x.active ? 'Disable' : 'Enable'} onPress={async () => { await supabase.from('payment_methods').update({ active: !x.active }).eq('id', x.id); load(); }} />
    <Btn style={{ flex: 1, margin: 2 }} kind="danger" title="Delete" onPress={async () => { await supabase.from('payment_methods').delete().eq('id', x.id); load(); }} /></View>}</Card>)}
    <Pager page={page} setPage={setPage} hasMore={rows.length > PAGE_SIZE} />
    {canManage && <View style={{ padding: 12 }}><Label>New payout method (country * = everywhere; type: bank, paypal, mobile_money, wise, other)</Label>
      {['country', 'type', 'name', 'bank_code', 'swift_code', 'branch_code', 'currency', 'instructions'].map(k => <Input key={k} placeholder={k} value={n[k]} onChangeText={(v) => setN({ ...n, [k]: v })} />)}<Btn title="Add method" onPress={add} /></View>}</ScrollView>;
}

function Countries({ canManage }) {
  const [rows, setRows] = useState([]); const [n, setN] = useState({ name: '', code: '', dial_code: '' }); const [page, setPage] = useState(0);
  const load = () => supabase.from('countries').select('*').order('name').range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE).then(({ data, error }) => { if (error) Alert.alert('Could not load countries', error.message); else setRows(data || []); });
  useEffect(() => { load(); }, [page]);
  const add = async () => { if (!n.name) return; const { error } = await supabase.from('countries').insert({ name: n.name.trim(), code: n.code.toUpperCase() || null, dial_code: n.dial_code || null }); if (error) Alert.alert('Error', error.message); else setN({ name: '', code: '', dial_code: '' }); load(); };
  return <ScrollView>
    {canManage && <View style={{ padding: 12 }}><Label>Add country (users pick from this list)</Label>
      <Input placeholder="Name" value={n.name} onChangeText={(v) => setN({ ...n, name: v })} /><Input placeholder="ISO code (TZ)" autoCapitalize="characters" value={n.code} onChangeText={(v) => setN({ ...n, code: v })} />
      <Input placeholder="Dial code (+255)" value={n.dial_code} onChangeText={(v) => setN({ ...n, dial_code: v })} /><Btn title="Add country" onPress={add} /></View>}
    {rows.slice(0, PAGE_SIZE).map((c) => <Card key={c.id}><Text style={{ fontWeight: '700' }}>{c.name} {c.code ? `(${c.code})` : ''}</Text><Muted>{c.dial_code || ''}{c.active ? '' : ' · hidden'}</Muted>
      {canManage && <View style={{ flexDirection: 'row' }}><Btn style={{ flex: 1, margin: 2 }} kind="ghost" title={c.active ? 'Hide' : 'Show'} onPress={async () => { await supabase.from('countries').update({ active: !c.active }).eq('id', c.id); load(); }} />
      <Btn style={{ flex: 1, margin: 2 }} kind="danger" title="Delete" onPress={async () => { await supabase.from('countries').delete().eq('id', c.id); load(); }} /></View>}</Card>)}
    <Pager page={page} setPage={setPage} hasMore={rows.length > PAGE_SIZE} /></ScrollView>;
}

function Regions({ canManage }) {
  const [country, setCountry] = useState(''); const [rows, setRows] = useState([]); const [name, setName] = useState(''); const [page, setPage] = useState(0);
  const load = async () => { if (!country) return setRows([]); const { data, error } = await supabase.from('country_divisions').select('id,name,active, countries!inner(name)').eq('countries.name', country).order('name').range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE); if (error) Alert.alert('Could not load regions', error.message); else setRows(data || []); };
  useEffect(() => { setPage(0); }, [country]);
  useEffect(() => { load(); }, [country, page]);
  const add = async () => { const { data: c } = await supabase.from('countries').select('id').eq('name', country).single(); const { error } = await supabase.from('country_divisions').insert({ country_id: c.id, name: name.trim() }); if (error) Alert.alert('Error', error.message); else setName(''); load(); };
  return <ScrollView><View style={{ padding: 12 }}><Label>Country</Label><CountryPicker value={country} onChange={setCountry} />
    {country && canManage ? <><Input placeholder="New region / county / state" value={name} onChangeText={setName} /><Btn title="Add region" onPress={add} /></> : null}</View>
    {rows.slice(0, PAGE_SIZE).map((r) => <Card key={r.id}><Text style={{ fontWeight: '700' }}>{r.name}{r.active ? '' : ' (hidden)'}</Text>{canManage && <View style={{ flexDirection: 'row' }}>
      <Btn style={{ flex: 1, margin: 2 }} kind="ghost" title={r.active ? 'Hide' : 'Show'} onPress={async () => { await supabase.from('country_divisions').update({ active: !r.active }).eq('id', r.id); load(); }} />
      <Btn style={{ flex: 1, margin: 2 }} kind="danger" title="Delete" onPress={async () => { await supabase.from('country_divisions').delete().eq('id', r.id); load(); }} /></View>}</Card>)}
    <Pager page={page} setPage={setPage} hasMore={rows.length > PAGE_SIZE} /></ScrollView>;
}

// Airports grouped by country and city. Admin adds, edits, hides or deletes.
function Airports({ canManage }) {
  const nav = useNavigation(); const empty = { name: '', code: '', city: '', region: '', country: '' };
  const [rows, setRows] = useState([]); const [n, setN] = useState(empty); const [pt, setPt] = useState(null); const [editId, setEditId] = useState(null); const [q, setQ] = useState(''); const [page, setPage] = useState(0);
  const load = () => supabase.from('airports').select('*').order('country').order('city').order('name').then(({ data }) => setRows(data || []));
  useEffect(() => { load(); }, []);
  useEffect(() => { setPage(0); }, [q]);
  const save = async () => {
    if (!n.name || !n.country || !n.city || !pt) return Alert.alert('Name, country, city and map location are required');
    const row = { name: n.name.trim(), code: n.code.toUpperCase() || null, city: n.city.trim(), region: n.region.trim() || null, country: n.country, lat: pt.lat, lng: pt.lng };
    const { error } = editId ? await supabase.from('airports').update(row).eq('id', editId) : await supabase.from('airports').insert(row);
    if (error) Alert.alert('Error', error.message); else { setN({ ...empty, country: n.country }); setPt(null); setEditId(null); } load();
  };
  const s = q.trim().toLowerCase();
  const shown = rows.filter((a) => !s || `${a.name} ${a.code || ''} ${a.city || ''} ${a.country}`.toLowerCase().includes(s));
  const groups = {}; shown.forEach((a) => { const k = `${a.country}|${a.city || 'Other'}`; (groups[k] = groups[k] || []).push(a); });
  return <ScrollView keyboardShouldPersistTaps="handled">{canManage && <View style={{ padding: 12 }}><Label>{editId ? 'Edit airport' : 'Add airport (guests are picked up from these)'}</Label>
    <Label>Country</Label><CountryPicker value={n.country} onChange={(v) => setN({ ...n, country: v })} />
    <Input placeholder="City" value={n.city} onChangeText={(v) => setN({ ...n, city: v })} />
    <Input placeholder="Region / county (optional)" value={n.region} onChangeText={(v) => setN({ ...n, region: v })} />
    <Input placeholder="Airport name" value={n.name} onChangeText={(v) => setN({ ...n, name: v })} />
    <Input placeholder="Code (JRO)" autoCapitalize="characters" value={n.code} onChangeText={(v) => setN({ ...n, code: v })} />
    <Btn kind="ghost" title={pt ? `📍 ${pt.lat.toFixed(4)}, ${pt.lng.toFixed(4)}` : '🗺️ Pick location on map'} onPress={async () => { const r = await pickLocation(nav, 'Airport location'); if (r) setPt(r); }} />
    <Btn title={editId ? 'Save changes' : 'Add airport'} onPress={save} />
    {editId && <Btn kind="ghost" title="Cancel edit" onPress={() => { setEditId(null); setN(empty); setPt(null); }} />}
    </View>}
    <View style={{ paddingHorizontal: 12 }}><Input placeholder="🔍 Search airports" value={q} onChangeText={setQ} /></View>
    {Object.entries(groups).slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(([k, list]) => { const [ctry, city] = k.split('|'); return <View key={k}>
      <Text style={{ fontWeight: '800', marginHorizontal: 12, marginTop: 8 }}>📍 {city}, {ctry}</Text>
      {list.map((a) => <Card key={a.id}><Text style={{ fontWeight: '700' }}>{a.code ? `${a.code} · ` : ''}{a.name}</Text><Muted>{a.region ? `${a.region} · ` : ''}{a.lat?.toFixed?.(3)}, {a.lng?.toFixed?.(3)}{a.active ? '' : ' · hidden'}</Muted>
        {canManage && <View style={{ flexDirection: 'row' }}>
          <Btn style={{ flex: 1, margin: 2 }} kind="ghost" title="Edit" onPress={() => { setEditId(a.id); setN({ name: a.name, code: a.code || '', city: a.city || '', region: a.region || '', country: a.country }); setPt({ lat: a.lat, lng: a.lng }); }} />
          <Btn style={{ flex: 1, margin: 2 }} kind="ghost" title={a.active ? 'Hide' : 'Show'} onPress={async () => { await supabase.from('airports').update({ active: !a.active }).eq('id', a.id); load(); }} />
          <Btn style={{ flex: 1, margin: 2 }} kind="danger" title="Delete" onPress={async () => { await supabase.from('airports').delete().eq('id', a.id); load(); }} /></View>}</Card>)}
    </View>; })}
    <Pager page={page} setPage={setPage} hasMore={(page + 1) * PAGE_SIZE < Object.keys(groups).length} />
  </ScrollView>;
}

function HostIds({ canManage }) {
  const [rows, setRows] = useState([]); const [note, setNote] = useState({}); const [page, setPage] = useState(0);
  const load = () => supabase.from('host_verifications').select('*').eq('status', 'pending').order('submitted_at').range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE).then(({ data, error }) => { if (error) Alert.alert('Could not load host IDs', error.message); else setRows(data || []); });
  useEffect(() => { load(); }, [page]);
  const view = async (path) => { if (!path) return; const { data } = await supabase.storage.from('host-verification').createSignedUrl(path, 600); if (data) Linking.openURL(data.signedUrl); };
  const act = async (r, ok) => { const { error } = await supabase.from('host_verifications').update({ status: ok ? 'approved' : 'rejected', rejection_reason: ok ? null : (note[r.id] || 'Please resubmit clear documents'), reviewed_at: new Date().toISOString() }).eq('id', r.id); if (error) Alert.alert('Error', error.message); load(); };
  return <ScrollView>{rows.length === 0 && page === 0 && <Muted style={{ textAlign: 'center', margin: 30 }}>No pending host IDs</Muted>}
    {rows.slice(0, PAGE_SIZE).map((r) => <Card key={r.id}><Text style={{ fontWeight: '700' }}>{r.legal_name}</Text><Muted>{r.document_type} · {r.street_address}, {r.city}</Muted>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}><Btn style={{ margin: 2 }} kind="ghost" title="ID front" onPress={() => view(r.document_front_path)} />
        {r.document_back_path && <Btn style={{ margin: 2 }} kind="ghost" title="ID back" onPress={() => view(r.document_back_path)} />}<Btn style={{ margin: 2 }} kind="ghost" title="Selfie" onPress={() => view(r.selfie_path)} /></View>
      {canManage && <><Input placeholder="Reason if rejected" value={note[r.id] || ''} onChangeText={(v) => setNote({ ...note, [r.id]: v })} />
      <View style={{ flexDirection: 'row' }}><Btn style={{ flex: 1, margin: 2 }} title="Approve ID" onPress={() => act(r, true)} /><Btn style={{ flex: 1, margin: 2 }} kind="danger" title="Reject" onPress={() => act(r, false)} /></View></>}</Card>)}
    <Pager page={page} setPage={setPage} hasMore={rows.length > PAGE_SIZE} /></ScrollView>;
}

// Terms & privacy: the admin pastes the realtravo.com page address and/or the text, then publishes. Publishing asks everyone to confirm again.
function LegalAdmin({ canManage }) {
  const [docs, setDocs] = useState({}); const [edit, setEdit] = useState({});
  const load = () => supabase.from('legal_documents').select('*').then(({ data }) => { const m = {}; (data || []).forEach((d) => { m[d.kind] = d; }); setDocs(m); setEdit((e) => { const n = { ...e }; (data || []).forEach((d) => { if (!n[d.kind]) n[d.kind] = { url: d.url || '', content: d.content || '' }; }); return n; }); });
  useEffect(() => { load(); }, []);
  const publish = async (kind) => {
    const e = edit[kind] || {}; if (!e.url?.trim() && !e.content?.trim()) return Alert.alert('Add the page address or the text first');
    Alert.alert('Publish new version?', 'Every user must confirm it again before they can continue.', [{ text: 'Cancel' }, { text: 'Publish', onPress: async () => {
      const { error } = await supabase.rpc('admin_publish_legal', { p_kind: kind, p_url: e.url || '', p_content: e.content || '' }); if (error) Alert.alert('Error', error.message); else { Alert.alert('Published'); load(); } } }]);
  };
  return <ScrollView contentContainerStyle={{ padding: 12 }} keyboardShouldPersistTaps="handled">
    {['terms', 'privacy'].map((k) => { const d = docs[k]; if (!d) return null; const e = edit[k] || { url: '', content: '' };
      return <Card key={k} style={{ marginHorizontal: 0 }}><Text style={{ fontWeight: '800', fontSize: 16 }}>{d.title}</Text>
        <Muted>{d.published ? `Published · version ${d.version}` : 'Not published yet'}</Muted>
        <Label>Page address (e.g. the realtravo.com page)</Label><Input editable={canManage} autoCapitalize="none" placeholder="https://realtravo.com/..." value={e.url} onChangeText={(v) => setEdit({ ...edit, [k]: { ...e, url: v } })} />
        <Label>Or paste the text (shown inside the app instead of the page)</Label><Input editable={canManage} multiline style={{ height: 160 }} value={e.content} onChangeText={(v) => setEdit({ ...edit, [k]: { ...e, content: v } })} />
        {canManage && <Btn title="Publish new version" onPress={() => publish(k)} />}</Card>; })}
  </ScrollView>;
}

function Cities({ canManage }) {
  const [country, setCountry] = useState(''); const [rows, setRows] = useState([]); const [name, setName] = useState(''); const [page, setPage] = useState(0);
  const load = async () => { if (!country) return setRows([]); const { data, error } = await supabase.from('cities').select('id,name,active, countries!inner(name)').eq('countries.name', country).order('name').range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE); if (error) Alert.alert('Could not load cities', error.message); else setRows(data || []); };
  useEffect(() => { setPage(0); }, [country]);
  useEffect(() => { load(); }, [country, page]);
  const add = async () => { const { data: c } = await supabase.from('countries').select('id').eq('name', country).single(); const { error } = await supabase.from('cities').insert({ country_id: c.id, name: name.trim() }); if (error) Alert.alert('Error', error.message); else setName(''); load(); };
  return <ScrollView><View style={{ padding: 12 }}><Label>Country</Label><CountryPicker value={country} onChange={setCountry} />
    {country && canManage ? <><Input placeholder="New city" value={name} onChangeText={setName} /><Btn title="Add city" onPress={add} /></> : null}</View>
    {rows.slice(0, PAGE_SIZE).map((r) => <Card key={r.id}><Text style={{ fontWeight: '700' }}>{r.name}{r.active ? '' : ' (hidden)'}</Text>{canManage && <View style={{ flexDirection: 'row' }}>
      <Btn style={{ flex: 1, margin: 2 }} kind="ghost" title={r.active ? 'Hide' : 'Show'} onPress={async () => { await supabase.from('cities').update({ active: !r.active }).eq('id', r.id); load(); }} />
      <Btn style={{ flex: 1, margin: 2 }} kind="danger" title="Delete" onPress={async () => { await supabase.from('cities').delete().eq('id', r.id); load(); }} /></View>}</Card>)}
    <Pager page={page} setPage={setPage} hasMore={rows.length > PAGE_SIZE} /></ScrollView>;
}

// Platform charge per category (percent of each booking)
function Fees({ canManage }) {
  const [rows, setRows] = useState([]); const [v, setV] = useState({}); const [page, setPage] = useState(0);
  const load = () => supabase.from('category_fees').select('*').order('category').range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE).then(({ data, error }) => {
    if (error) Alert.alert('Could not load category fees', error.message);
    else { setRows(data || []); setV(Object.fromEntries((data || []).map((r) => [r.category, String(r.commission_percent)]))); }
  });
  useEffect(() => { load(); }, [page]);
  const save = async (c) => { const { error } = await supabase.from('category_fees').update({ commission_percent: Number(v[c]) }).eq('category', c); Alert.alert(error ? error.message : 'Saved'); };
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 12 }}><Muted>Each category has its own charge. Hosts see the deduction in their earnings.</Muted>
    {rows.slice(0, PAGE_SIZE).map((r) => <Card key={r.category} style={{ marginHorizontal: 0 }}><Text style={{ fontWeight: '700' }}>{r.category}</Text><Input editable={canManage} keyboardType="decimal-pad" value={v[r.category]} onChangeText={(t) => setV({ ...v, [r.category]: t })} />{canManage && <Btn kind="ghost" title="Save %" onPress={() => save(r.category)} />}</Card>)}
    <Pager page={page} setPage={setPage} hasMore={rows.length > PAGE_SIZE} /></ScrollView>;
}

// Every listing from every category, filterable by status; open one to see all of its details
function AdminListings({ canManage }) {
  const nav = useNavigation(); const [status, setStatus] = useState('pending'); const [rows, setRows] = useState([]); const [page, setPage] = useState(0);
  const load = useCallback(async () => {
    let q = supabase.from('listings').select('id,title,category,status,country,region,created_at,schedule_type,accommodation_available,providers(business_name)').is('deleted_at', null).order('created_at', { ascending: false }).range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
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
        <Muted>{item.category}{item.accommodation_available ? ' · accommodation available' : ''}{item.schedule_type !== 'always' ? ` · ${item.schedule_type.replace('_', ' ')}` : ''} · {item.region || item.country} · {item.providers?.business_name || 'host'}</Muted>
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