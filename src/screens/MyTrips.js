import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, Alert, TouchableOpacity, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { supabase, PAGE_SIZE } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import ScreenHeader from '../components/ScreenHeader';
import { Btn, Card, Muted, Pager, Loader, Chip } from '../components/ui';
import DateField from '../components/DateField';
import { startPayment } from '../lib/payments';
import { ymd } from '../lib/pricing';
import { tr } from '../i18n';
import { C } from '../lib/theme';

const CANCELLED = ['cancelled', 'declined'];
const dropOf = (b) => [].concat(b.booking_dropoffs || [])[0]?.dropoff_location;
const pkgOf = (b) => [].concat(b.trip_packages || [])[0] || null;
const TABS = [
  ['upcoming', '📅 Upcoming', 'No upcoming bookings.'],
  ['pending', '⏳ Pending', 'No pending bookings.'],
  ['completed', '✅ Completed', 'No completed bookings.'],
  ['cancelled', '❌ Cancelled', 'No cancelled bookings.'],
];
const WHEN = [['all', 'Any date'], ['month', 'This month'], ['range', 'Pick dates']];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ICONS = { hotel: 'bed-outline', campsite: 'bonfire-outline', attraction: 'flag-outline', airbnb: 'home-outline', activity: 'walk-outline', event: 'ticket-outline', guide: 'person-outline' };
const dayParts = (d) => { const x = new Date(`${String(d).slice(0, 10)}T12:00:00`); return { day: x.getDate(), mon: MONTHS[x.getMonth()] }; };
const same = (a, b) => String(a).slice(0, 10) === String(b || a).slice(0, 10);

const STATUS_STYLE = {
  pending: { label: 'Pending', color: '#B45309', bg: '#FEF3E2' },
  accepted: { label: 'Confirmed', color: '#1B7F4B', bg: '#E6F4EC' },
  completed: { label: 'Completed', color: '#1D5FA8', bg: '#E8F0FB' },
  cancelled: { label: 'Cancelled', color: '#B42318', bg: '#FDECEA' },
  declined: { label: 'Declined', color: '#B42318', bg: '#FDECEA' },
};
const statusStyle = (st) => STATUS_STYLE[st] || { label: String(st || '-'), color: '#4A5A52', bg: '#EEF2EF' };

function TripRow({ b, navigation, onPay, onCancel, feePct, formatMoney }) {
  const [open, setOpen] = useState(false);               // pickup and return stays closed until tapped
  const st = statusStyle(b.status); const a = dayParts(b.start_date);
  const e = !same(b.start_date, b.end_date) ? dayParts(b.end_date) : null;
  const unpaid = b.payment_status === 'unpaid' && b.status === 'pending';
  const paid = b.payment_status === 'paid';
  const cat = b.listings?.category; const drop = dropOf(b);
  const pkg = pkgOf(b); const custom = !!pkg?.is_custom;
  const gone = CANCELLED.includes(b.status);
  const canCancel = custom && !gone && b.status !== 'completed' && String(b.start_date).slice(0, 10) > ymd(new Date());
  const fee = paid ? Math.round(Number(b.total) * feePct) / 100 : 0;
  const tripPickup = custom && pkg?.trip_type ? pkg : null;
  const hasTransport = !!(b.pickup_location || drop || b.return_date || tripPickup);
  return (
    <Card style={{ paddingVertical: 10, opacity: gone ? 0.75 : 1 }}>
      <TouchableOpacity activeOpacity={0.8} style={s.row} onPress={() => navigation.navigate('BookingDetail', { id: b.id })}>
        <View style={s.dateBox}>
          <Text style={s.dateDay}>{a.day}</Text><Text style={s.dateMon}>{a.mon}</Text>
          {e && <Text style={s.dateTo}>to {e.day} {e.mon}</Text>}
        </View>
        <View style={{ flex: 1, marginHorizontal: 10 }}>
          <Text style={[s.title, gone && { textDecorationLine: 'line-through' }]} numberOfLines={1}>{b.listings?.title || 'Booking'}</Text>
          <View style={s.metaRow}>
            <Ionicons name={ICONS[cat] || 'location-outline'} size={13} color="#6B7A72" />
            <Text style={s.meta} numberOfLines={1}>
              {cat ? `${cat} · ` : ''}{b.start_time ? `${String(b.start_time).slice(0, 5)} · ` : ''}{b.guests} {Number(b.guests) === 1 ? 'guest' : 'guests'}
            </Text>
          </View>
          <View style={s.tags}>
            <View style={[s.tag, { backgroundColor: st.bg }]}><Text style={[s.tagText, { color: st.color }]}>{st.label}</Text></View>
            <View style={[s.tag, { backgroundColor: paid ? '#E6F4EC' : '#FEF3E2' }]}><Text style={[s.tagText, { color: paid ? '#1B7F4B' : '#B45309' }]}>{paid ? 'Paid' : 'Unpaid'}</Text></View>
            {custom && <View style={[s.tag, { backgroundColor: '#E8F0FB' }]}><Text style={[s.tagText, { color: '#1D5FA8' }]}>🧳 Custom trip</Text></View>}
            {!!b.parent_booking_id && <View style={s.tagGrey}><Text style={s.tagGreyText}>Add-on</Text></View>}
            {!!b.urgent && <View style={[s.tag, { backgroundColor: '#FDECEA' }]}><Text style={[s.tagText, { color: '#B42318' }]}>Urgent</Text></View>}
          </View>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={s.price}>{formatMoney(b.total)}</Text>
          <Ionicons name="chevron-forward" size={18} color="#9AA8A0" style={{ marginTop: 6 }} />
        </View>
      </TouchableOpacity>

      {gone && custom && (Number(b.cancel_fee) > 0 || Number(b.refund_due) > 0) && (
        <Text style={s.cancelInfo}>Cancellation fee {formatMoney(b.cancel_fee)}{Number(b.refund_due) > 0 ? ` · refund due ${formatMoney(b.refund_due)}` : ''}</Text>)}

      {unpaid && !!b.pay_by && <Muted style={{ marginTop: 6 }}>⏳ Pay before {new Date(b.pay_by).toLocaleString()} or it is cancelled</Muted>}
      {unpaid && <Btn title={b.package_id ? 'Pay now (whole trip)' : 'Pay now'} onPress={() => onPay(b)} />}

      {canCancel && (
        <View style={{ marginTop: 6 }}>
          <Btn kind="danger" title={paid ? `Cancel this item (fee ${formatMoney(fee)})` : 'Cancel this item'} onPress={() => onCancel(b, fee)} />
          <Muted style={{ textAlign: 'center' }}>The whole trip cannot be cancelled. Only single items. The other items stay booked.</Muted>
        </View>)}

      {hasTransport && (
        <View style={s.transport}>
          <TouchableOpacity onPress={() => setOpen(!open)} style={s.transportHead} activeOpacity={0.7}>
            <Text style={s.transportTitle}>🚐 Pickup and return</Text>
            <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={C.primary} />
          </TouchableOpacity>
          {open && (
            <View style={{ paddingTop: 4 }}>
              {b.pickup_location ? <Muted>📍 Pickup: {b.pickup_location}{b.pickup_time ? ` at ${String(b.pickup_time).slice(0, 5)}` : ''}</Muted> : null}
              {drop ? <Muted>🏁 Drop-off: {drop}</Muted> : null}
              {b.return_date ? <Muted>↩️ Return: {b.return_date}{b.return_time ? ` at ${String(b.return_time).slice(0, 5)}` : ''}</Muted> : null}
              {tripPickup ? <Muted>📍 Trip pickup: {tripPickup.pickup_location}{tripPickup.pickup_time ? ` · ${new Date(tripPickup.pickup_time).toLocaleString()}` : ''}{tripPickup.trip_type === 'round' ? ' · with return' : ''}</Muted> : null}
            </View>
          )}
        </View>
      )}
    </Card>
  );
}

export default function MyTrips({ navigation, route }) {
  const { session, profile, refresh, formatMoney } = useAuth();
  const [tab, setTab] = useState(route?.params?.tab || 'upcoming');
  const [when, setWhen] = useState('all');
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [to, setTo] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 30); return d; });
  const [rows, setRows] = useState([]); const [page, setPage] = useState(0); const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true); const [offline, setOffline] = useState(false);
  const [transfers, setTransfers] = useState([]); const [feePct, setFeePct] = useState(20);
  const changeTab = (k) => { setPage(0); setTab(k); };
  const changeWhen = (k) => { setPage(0); setWhen(k); };
  useEffect(() => { if (route?.params?.tab) { setPage(0); setTab(route.params.tab); } }, [route?.params?.tab, route?.params?.ts]);

  const load = useCallback(async () => {
    if (!session) return;
    const key = `bookings:${session.user.id}:${tab}:${page}:${when}:${when === 'range' ? ymd(from) + ymd(to) : ''}`;
    const cached = await AsyncStorage.getItem(key);
    if (cached) {
      try {
        const saved = JSON.parse(cached);
        setRows(saved.list || []); setMore(!!saved.hasMore); setOffline(true); setLoading(false);
      } catch (e) {
        await AsyncStorage.removeItem(key);
        setRows([]); setMore(false); setOffline(false); setLoading(true);
      }
    } else setLoading(true);
    try {
      const today = ymd(new Date());
      let q = supabase.from('bookings').select('*, listings(title,category,photos), booking_items(*), booking_dropoffs(*), trip_packages(is_custom,trip_type,pickup_location,pickup_time)').eq('user_id', session.user.id);
      if (tab === 'pending') q = q.eq('status', 'pending');
      else if (tab === 'upcoming') q = q.eq('status', 'accepted').gte('end_date', today);
      else if (tab === 'completed') q = q.or(`status.eq.completed,and(status.eq.accepted,end_date.lt.${today})`);
      else q = q.in('status', CANCELLED);
      if (when === 'month') {
        const n = new Date(); const first = new Date(n.getFullYear(), n.getMonth(), 1); const last = new Date(n.getFullYear(), n.getMonth() + 1, 0);
        q = q.lte('start_date', ymd(last)).gte('end_date', ymd(first));
      } else if (when === 'range') q = q.lte('start_date', ymd(to)).gte('end_date', ymd(from));
      const { data, error } = await q.order(tab === 'upcoming' ? 'start_date' : 'created_at', { ascending: tab === 'upcoming' })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
      if (error || !data) throw error || new Error('offline');
      const list = data.slice(0, PAGE_SIZE); const hasMore = data.length > PAGE_SIZE;
      setRows(list); setMore(hasMore); setOffline(false);
      await AsyncStorage.setItem(key, JSON.stringify({ list, hasMore })); // copy kept on the phone
      supabase.from('airport_transfers').select('*').eq('user_id', session.user.id).order('created_at', { ascending: false }).limit(5).then(({ data: t }) => setTransfers(t || []));
      supabase.from('app_settings').select('custom_cancel_fee_percent').eq('id', 1).maybeSingle().then(({ data: st }) => st && setFeePct(Number(st.custom_cancel_fee_percent ?? 20)));
      refresh();
    } catch (e) {
      if (!cached) setRows([]);
    }
    setLoading(false);
  }, [page, session, tab, when, from, to]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const pay = async (b) => { try { const p = await startPayment(b.package_id ? { purpose: 'package', packageId: b.package_id } : { purpose: 'booking', bookingId: b.id }); navigation.navigate('Pay', { url: p.authorization_url }); } catch (e) { Alert.alert('Error', e.message); } };

  const cancelItem = (b, fee) => {
    const paid = b.payment_status === 'paid';
    const msg = `${b.listings?.title}\n\n` + (paid
      ? `Cancellation fee: ${formatMoney(fee)} (${feePct}%)\nYou get back: ${formatMoney(Number(b.total) - fee)}`
      : 'This item is not paid yet, so there is no fee.') + '\n\nThe other items in your trip stay booked.';
    Alert.alert('Cancel this item?', msg, [
      { text: 'Keep it' },
      { text: 'Cancel item', style: 'destructive', onPress: async () => {
        const { error } = await supabase.rpc('cancel_package_item', { p_booking: b.id });
        if (error) Alert.alert('Could not cancel', error.message); else load();
      } },
    ]);
  };

  if (!session) return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title="My bookings" icon="ticket-outline" />
      <View style={{ flex: 1, justifyContent: 'center', padding: 28 }}>
        <Muted style={{ textAlign: 'center', marginBottom: 12 }}>Sign in to see and download your bookings.</Muted>
        <Btn title={tr('login')} onPress={() => navigation.navigate('Auth', { reason: 'trips' })} />
      </View>
    </View>);

  const emptyText = TABS.find((t) => t[0] === tab)[2];

  const Filters = (
    <View style={s.filters}>
      {/* tabs wrap onto the next line, so nothing scrolls sideways */}
      <View style={s.wrap}>{TABS.map(([k, label]) => <Chip key={k} label={label} active={tab === k} onPress={() => changeTab(k)} />)}</View>
      <Text style={s.fLabel}>Booking date</Text>
      <View style={s.wrap}>{WHEN.map(([k, label]) => <Chip key={k} label={label} active={when === k} onPress={() => changeWhen(k)} />)}</View>
      {when === 'range' && (
        <View style={{ flexDirection: 'row', marginTop: 4 }}>
          <View style={{ flex: 1, marginRight: 6 }}>
            <Text style={s.fLabel}>From</Text>
            <DateField value={from} onChange={(d) => { setPage(0); setFrom(d); if (d > to) setTo(d); }} />
          </View>
          <View style={{ flex: 1, marginLeft: 6 }}>
            <Text style={s.fLabel}>To</Text>
            <DateField value={to} minimumDate={from} onChange={(d) => { setPage(0); setTo(d); }} />
          </View>
        </View>
      )}
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title="My trips" icon="ticket-outline" subtitle={`${tr('balance')}: ${formatMoney(profile?.balance)}${offline ? '  ·  offline copy' : ''}`} />
      <View style={s.hero}>
        <View style={s.heroIcon}><Ionicons name="airplane-outline" size={24} color={C.primary} /></View>
        <View style={{ flex: 1 }}>
          <Text style={s.heroTitle}>Your trips, all in one place</Text>
          <Text style={s.heroText}>Check booking details, payment status and travel plans.</Text>
        </View>
      </View>
      {Filters}
      {loading ? <Loader /> : <FlatList data={rows} keyExtractor={(i) => i.id}
        ListHeaderComponent={tab === 'upcoming' && transfers.length ? (<View><Text style={{ fontWeight: '800', fontSize: 16, margin: 12, marginBottom: 0 }}>✈️ Airport transfers</Text>{transfers.map((t) => (<Card key={t.id}><Text style={{ fontWeight: '700' }}>{t.pickup} → {t.dropoff}</Text><Muted>{new Date(t.pickup_time).toLocaleString()} · {t.adults ?? t.passengers} adults{t.children ? ` + ${t.children} children` : ''} · {formatMoney(t.price)}</Muted><Text>Payment: {t.payment_status}</Text></Card>))}<Text style={{ fontWeight: '800', fontSize: 16, margin: 12, marginBottom: 0 }}>🏨 Bookings</Text></View>) : null}
        ListEmptyComponent={<View style={s.empty}>
          <View style={s.emptyIcon}><Ionicons name="calendar-outline" size={26} color={C.primary} /></View>
          <Text style={s.emptyTitle}>{when === 'all' ? emptyText : 'No bookings for these dates.'}</Text>
          <Muted style={{ textAlign: 'center' }}>Your bookings will appear here when you make them.</Muted>
          {tab === 'upcoming' && when === 'all' && <Btn title="Explore places" onPress={() => navigation.navigate('Tabs', { screen: 'Explore' })} />}
        </View>}
        ListFooterComponent={<Pager page={page} setPage={setPage} hasMore={more} />}
        renderItem={({ item: b }) => <TripRow b={b} navigation={navigation} onPay={pay} onCancel={cancelItem} feePct={feePct} formatMoney={formatMoney} />} />}
    </View>
  );
}

const s = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 12, marginTop: 10, marginBottom: 4, padding: 14, borderRadius: 14, backgroundColor: '#E3EDE8' },
  heroIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  heroTitle: { fontSize: 15, fontWeight: '800', color: C.text },
  heroText: { marginTop: 3, fontSize: 12, color: C.muted },
  empty: { alignItems: 'center', margin: 18, padding: 20, borderRadius: 16, backgroundColor: '#fff' },
  emptyIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#E3EDE8', alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '800', textAlign: 'center', marginBottom: 5, color: C.text },
  filters: { backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderColor: '#E6ECE8' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap' },
  fLabel: { fontSize: 13, fontWeight: '700', color: '#5F6B66', marginTop: 6, marginBottom: 2 },
  row: { flexDirection: 'row', alignItems: 'center' },
  dateBox: { width: 58, alignItems: 'center', paddingVertical: 8, borderRadius: 12, backgroundColor: '#E8F5EE' },
  dateDay: { fontSize: 22, fontWeight: '800', color: C.primary, lineHeight: 24 },
  dateMon: { fontSize: 12, fontWeight: '700', color: C.primary },
  dateTo: { fontSize: 10, color: '#5F7A6D', marginTop: 2 },
  title: { fontSize: 16, fontWeight: '700', color: C.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  meta: { fontSize: 12.5, color: '#6B7A72', marginLeft: 4, flexShrink: 1, textTransform: 'capitalize' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 },
  tag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, marginRight: 6, marginBottom: 2 },
  tagText: { fontSize: 11.5, fontWeight: '700' },
  tagGrey: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, marginRight: 6, marginBottom: 2, backgroundColor: '#EEF2EF' },
  tagGreyText: { fontSize: 11.5, fontWeight: '600', color: '#4A5A52' },
  price: { fontSize: 16, fontWeight: '800', color: C.text },
  cancelInfo: { marginTop: 6, color: '#B42318', fontWeight: '700', fontSize: 13 },
  transport: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderColor: '#E6ECE8' },
  transportHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  transportTitle: { fontWeight: '700', color: C.primary, fontSize: 14 },
});