import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, Alert, TouchableOpacity, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { supabase, PAGE_SIZE } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import ScreenHeader from '../components/ScreenHeader';
import { Btn, Muted, Pager, Loader } from '../components/ui';
import DateField from '../components/DateField';
import { startPayment } from '../lib/payments';
import { ymd } from '../lib/pricing';
import { tr } from '../i18n';
import { C } from '../lib/theme';

const CANCELLED = ['cancelled', 'declined'];
const dropOf = (b) => [].concat(b.booking_dropoffs || [])[0]?.dropoff_location;
const pkgOf = (b) => [].concat(b.trip_packages || [])[0] || null;
const TABS = [
  ['upcoming', 'Upcoming', 'No upcoming bookings.', 'calendar-outline'],
  ['pending', 'Pending', 'No pending bookings.', 'time-outline'],
  ['completed', 'Completed', 'No completed bookings.', 'checkmark-circle-outline'],
  ['cancelled', 'Cancelled', 'No cancelled bookings.', 'close-circle-outline'],
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

/* ---------- small building blocks ---------- */
const Tag = ({ icon, text, color, bg }) => (
  <View style={[s.tag, { backgroundColor: bg }]}>
    {icon ? <Ionicons name={icon} size={12} color={color} style={{ marginRight: 3 }} /> : null}
    <Text style={[s.tagText, { color }]}>{text}</Text>
  </View>
);

const InfoLine = ({ icon, children }) => (
  <View style={s.infoLine}>
    <Ionicons name={icon} size={15} color="#6B7A72" style={{ marginTop: 1 }} />
    <Text style={s.infoText}>{children}</Text>
  </View>
);

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
    <View style={[s.card, gone && { opacity: 0.75 }]}>
      <View style={[s.accent, { backgroundColor: st.color }]} />
      <View style={s.cardBody}>
        <TouchableOpacity activeOpacity={0.8} style={s.row} onPress={() => navigation.navigate('BookingDetail', { id: b.id })}>
          <View style={s.dateBox}>
            <Text style={s.dateDay}>{a.day}</Text><Text style={s.dateMon}>{a.mon}</Text>
            {e && <Text style={s.dateTo}>to {e.day} {e.mon}</Text>}
          </View>
          <View style={{ flex: 1, marginHorizontal: 12 }}>
            <Text style={[s.title, gone && { textDecorationLine: 'line-through' }]} numberOfLines={2}>{b.listings?.title || 'Booking'}</Text>
            <View style={s.metaRow}>
              <Ionicons name={ICONS[cat] || 'location-outline'} size={13} color="#6B7A72" />
              <Text style={s.meta} numberOfLines={1}>
                {cat ? `${cat} · ` : ''}{b.start_time ? `${String(b.start_time).slice(0, 5)} · ` : ''}{b.guests} {Number(b.guests) === 1 ? 'guest' : 'guests'}
              </Text>
            </View>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={s.price}>{formatMoney(b.total)}</Text>
            <Ionicons name="chevron-forward" size={18} color="#9AA8A0" style={{ marginTop: 6 }} />
          </View>
        </TouchableOpacity>

        <View style={s.tags}>
          <Tag text={st.label} color={st.color} bg={st.bg} />
          <Tag icon={paid ? 'checkmark-circle' : 'alert-circle-outline'} text={paid ? 'Paid' : 'Unpaid'} color={paid ? '#1B7F4B' : '#B45309'} bg={paid ? '#E6F4EC' : '#FEF3E2'} />
          {custom && <Tag icon="briefcase-outline" text="Custom trip" color="#1D5FA8" bg="#E8F0FB" />}
          {!!b.parent_booking_id && <Tag text="Add-on" color="#4A5A52" bg="#EEF2EF" />}
          {!!b.urgent && <Tag icon="flash" text="Urgent" color="#B42318" bg="#FDECEA" />}
        </View>

        {gone && custom && (Number(b.cancel_fee) > 0 || Number(b.refund_due) > 0) && (
          <Text style={s.cancelInfo}>Cancellation fee {formatMoney(b.cancel_fee)}{Number(b.refund_due) > 0 ? ` · refund due ${formatMoney(b.refund_due)}` : ''}</Text>)}

        {unpaid && !!b.pay_by && (
          <View style={s.payBy}>
            <Ionicons name="time-outline" size={16} color="#B45309" />
            <Text style={s.payByText}>Pay before {new Date(b.pay_by).toLocaleString()} or it is cancelled</Text>
          </View>
        )}
        {unpaid && <View style={{ marginTop: 6 }}><Btn title={b.package_id ? 'Pay now (whole trip)' : 'Pay now'} onPress={() => onPay(b)} /></View>}

        {canCancel && (
          <View style={{ marginTop: 6 }}>
            <Btn kind="danger" title={paid ? `Cancel this item (fee ${formatMoney(fee)})` : 'Cancel this item'} onPress={() => onCancel(b, fee)} />
            <Muted style={{ textAlign: 'center' }}>The whole trip cannot be cancelled. Only single items. The other items stay booked.</Muted>
          </View>)}

        {hasTransport && (
          <View style={s.transport}>
            <TouchableOpacity onPress={() => setOpen(!open)} style={s.transportHead} activeOpacity={0.7}>
              <Ionicons name="car-outline" size={18} color={C.primary} />
              <Text style={s.transportTitle}>Pickup and return</Text>
              <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={C.primary} />
            </TouchableOpacity>
            {open && (
              <View style={{ paddingTop: 6 }}>
                {b.pickup_location ? <InfoLine icon="location-outline">Pickup: {b.pickup_location}{b.pickup_time ? ` at ${String(b.pickup_time).slice(0, 5)}` : ''}</InfoLine> : null}
                {drop ? <InfoLine icon="flag-outline">Drop-off: {drop}</InfoLine> : null}
                {b.return_date ? <InfoLine icon="return-down-back-outline">Return: {b.return_date}{b.return_time ? ` at ${String(b.return_time).slice(0, 5)}` : ''}</InfoLine> : null}
                {tripPickup ? <InfoLine icon="location-outline">Trip pickup: {tripPickup.pickup_location}{tripPickup.pickup_time ? ` · ${new Date(tripPickup.pickup_time).toLocaleString()}` : ''}{tripPickup.trip_type === 'round' ? ' · with return' : ''}</InfoLine> : null}
              </View>
            )}
          </View>
        )}
      </View>
    </View>
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
  const [loadError, setLoadError] = useState('');
  const [transfers, setTransfers] = useState([]); const [feePct, setFeePct] = useState(20);
  const changeTab = (k) => { setPage(0); setTab(k); };
  const changeWhen = (k) => { setPage(0); setWhen(k); };
  useEffect(() => { if (route?.params?.tab) { setPage(0); setTab(route.params.tab); } }, [route?.params?.tab, route?.params?.ts]);

  const load = useCallback(async () => {
    if (!session) return;
    setLoadError('');
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
      let q = supabase.from('bookings').select('*, listings(title,category,photos)').eq('user_id', session.user.id);
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
      const base = data.slice(0, PAGE_SIZE);
      const bookingIds = base.map((b) => b.id);
      const packageIds = [...new Set(base.map((b) => b.package_id).filter(Boolean))];
      const [dropoffsResult, packagesResult] = await Promise.all([
        bookingIds.length ? supabase.from('booking_dropoffs').select('booking_id,dropoff_location').in('booking_id', bookingIds) : Promise.resolve({ data: [], error: null }),
        packageIds.length ? supabase.from('trip_packages').select('id,is_custom,trip_type,pickup_location,pickup_time').in('id', packageIds) : Promise.resolve({ data: [], error: null }),
      ]);
      if (dropoffsResult.error) console.warn('Could not load booking drop-offs:', dropoffsResult.error.message);
      if (packagesResult.error) console.warn('Could not load trip details:', packagesResult.error.message);
      const dropoffs = new Map((dropoffsResult.data || []).map((d) => [d.booking_id, [d]]));
      const packages = new Map((packagesResult.data || []).map((p) => [p.id, p]));
      const list = base.map((b) => ({
        ...b,
        booking_dropoffs: dropoffs.get(b.id) || [],
        trip_packages: packages.has(b.package_id) ? [packages.get(b.package_id)] : [],
      }));
      const hasMore = data.length > PAGE_SIZE;
      setRows(list); setMore(hasMore); setOffline(false);
      await AsyncStorage.setItem(key, JSON.stringify({ list, hasMore })); // copy kept on the phone
      supabase.from('airport_transfers').select('*').eq('user_id', session.user.id).order('created_at', { ascending: false }).limit(5).then(({ data: t }) => setTransfers(t || []));
      supabase.from('app_settings').select('custom_cancel_fee_percent').eq('id', 1).maybeSingle().then(({ data: st }) => st && setFeePct(Number(st.custom_cancel_fee_percent ?? 20)));
      refresh();
    } catch (e) {
      const message = e?.message || 'Could not refresh your bookings.';
      console.warn('Could not load bookings:', message);
      setLoadError(message);
      if (!cached) { setRows([]); setMore(false); setOffline(false); }
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
    <View style={{ flex: 1, backgroundColor: '#F6F8F7' }}>
      <ScreenHeader title="My bookings" icon="ticket-outline" />
      <View style={s.signedOut}>
        <View style={s.emptyIcon}><Ionicons name="ticket-outline" size={26} color={C.primary} /></View>
        <Text style={s.emptyTitle}>Sign in to see your bookings</Text>
        <Muted style={{ textAlign: 'center', marginBottom: 14 }}>View, pay for and download your bookings in one place.</Muted>
        <Btn title={tr('login')} style={{ alignSelf: 'stretch' }} onPress={() => navigation.navigate('Auth', { reason: 'trips' })} />
      </View>
    </View>);

  const emptyText = TABS.find((t) => t[0] === tab)[2];

  const Filters = (
    <View style={s.filters}>
      {/* four equal tabs, so nothing scrolls sideways */}
      <View style={s.tabs}>
        {TABS.map(([k, label, , icon]) => {
          const on = tab === k;
          return (
            <TouchableOpacity key={k} style={[s.tabItem, on && s.tabItemOn]} onPress={() => changeTab(k)} activeOpacity={0.7}>
              <Ionicons name={icon} size={20} color={on ? C.primary : '#8A9892'} />
              <Text style={[s.tabText, on && s.tabTextOn]} numberOfLines={1}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <View style={s.whenRow}>
        <Ionicons name="options-outline" size={16} color="#6B7A72" style={{ marginRight: 8 }} />
        {WHEN.map(([k, label]) => {
          const on = when === k;
          return (
            <TouchableOpacity key={k} onPress={() => changeWhen(k)} activeOpacity={0.7} style={[s.whenPill, on && s.whenPillOn]}>
              <Text style={[s.whenText, on && s.whenTextOn]}>{label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
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
    <View style={{ flex: 1, backgroundColor: '#F6F8F7' }}>
      <ScreenHeader title="My trips" icon="ticket-outline" subtitle={`${tr('balance')}: ${formatMoney(profile?.balance)}`} />
      {offline && (
        <View style={s.offline}>
          <Ionicons name="cloud-offline-outline" size={16} color="#8A5A0B" />
          <Text style={s.offlineText}>{loadError ? `Refresh failed: ${loadError}` : 'Showing your saved copy. Reconnect to refresh.'}</Text>
        </View>
      )}
      {Filters}
      {loading ? <Loader /> : <FlatList data={rows} keyExtractor={(i) => i.id}
        contentContainerStyle={{ paddingTop: 10, paddingBottom: 24 }}
        ListHeaderComponent={tab === 'upcoming' && transfers.length ? (
          <View>
            <View style={s.listHead}><Ionicons name="airplane-outline" size={18} color={C.primary} /><Text style={s.listHeadText}>Airport transfers</Text></View>
            {transfers.map((t) => (
              <View key={t.id} style={s.transferCard}>
                <Text style={s.transferRoute}>{t.pickup} → {t.dropoff}</Text>
                <Text style={s.transferMeta}>{new Date(t.pickup_time).toLocaleString()} · {t.adults ?? t.passengers} adults{t.children ? ` + ${t.children} children` : ''} · {formatMoney(t.price)}</Text>
                <Text style={s.transferPay}>Payment: {t.payment_status}</Text>
              </View>
            ))}
            <View style={s.listHead}><Ionicons name="bed-outline" size={18} color={C.primary} /><Text style={s.listHeadText}>Bookings</Text></View>
          </View>) : null}
        ListEmptyComponent={loadError ? <View style={s.empty}>
          <View style={s.emptyIcon}><Ionicons name="cloud-offline-outline" size={26} color={C.primary} /></View>
          <Text style={s.emptyTitle}>Could not load your bookings</Text>
          <Muted style={{ textAlign: 'center' }}>{loadError}</Muted>
          <Btn title="Try again" onPress={load} />
        </View> : <View style={s.empty}>
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
  signedOut: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 28 },
  offline: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF3DC', paddingHorizontal: 14, paddingVertical: 8 },
  offlineText: { marginLeft: 8, color: '#8A5A0B', fontSize: 12.5, fontWeight: '600', flex: 1 },

  filters: { backgroundColor: '#fff', paddingHorizontal: 12, paddingTop: 4, paddingBottom: 10, borderBottomWidth: 1, borderColor: '#E6ECE8' },
  tabs: { flexDirection: 'row' },
  tabItem: { flex: 1, alignItems: 'center', paddingVertical: 10, borderBottomWidth: 3, borderBottomColor: 'transparent' },
  tabItemOn: { borderBottomColor: C.primary },
  tabText: { fontSize: 12, color: '#8A9892', marginTop: 3, fontWeight: '600' },
  tabTextOn: { color: C.primary, fontWeight: '800' },
  whenRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  whenPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: '#EEF2EF', marginRight: 6 },
  whenPillOn: { backgroundColor: C.primary },
  whenText: { fontSize: 12.5, fontWeight: '600', color: '#4A5A52' },
  whenTextOn: { color: '#fff', fontWeight: '800' },
  fLabel: { fontSize: 13, fontWeight: '700', color: '#5F6B66', marginTop: 6, marginBottom: 2 },

  listHead: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 4, marginBottom: 8 },
  listHeadText: { fontWeight: '800', fontSize: 15, color: C.text, marginLeft: 8 },
  transferCard: { marginHorizontal: 12, marginBottom: 10, padding: 14, borderRadius: 16, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E6ECE8' },
  transferRoute: { fontWeight: '800', color: C.text, fontSize: 15 },
  transferMeta: { color: '#6B7A72', fontSize: 12.5, marginTop: 4, lineHeight: 18 },
  transferPay: { color: C.text, fontSize: 12.5, fontWeight: '600', marginTop: 4, textTransform: 'capitalize' },

  empty: { alignItems: 'center', margin: 18, padding: 22, borderRadius: 18, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E6ECE8' },
  emptyIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#E3EDE8', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  emptyTitle: { fontSize: 16, fontWeight: '800', textAlign: 'center', marginBottom: 5, color: C.text },

  card: { flexDirection: 'row', marginHorizontal: 12, marginBottom: 12, borderRadius: 18, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E6ECE8', overflow: 'hidden' },
  accent: { width: 5 },
  cardBody: { flex: 1, padding: 14 },
  row: { flexDirection: 'row', alignItems: 'center' },
  dateBox: { width: 58, alignItems: 'center', paddingVertical: 8, borderRadius: 12, backgroundColor: '#E8F5EE' },
  dateDay: { fontSize: 22, fontWeight: '800', color: C.primary, lineHeight: 24 },
  dateMon: { fontSize: 12, fontWeight: '700', color: C.primary },
  dateTo: { fontSize: 10, color: '#5F7A6D', marginTop: 2 },
  title: { fontSize: 16, fontWeight: '800', color: C.text, lineHeight: 21 },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 3 },
  meta: { fontSize: 12.5, color: '#6B7A72', marginLeft: 4, flexShrink: 1, textTransform: 'capitalize' },
  price: { fontSize: 16, fontWeight: '800', color: C.text },

  tags: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12 },
  tag: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 10, marginRight: 6, marginBottom: 4 },
  tagText: { fontSize: 11.5, fontWeight: '700' },

  cancelInfo: { marginTop: 6, color: '#B42318', fontWeight: '700', fontSize: 13 },
  payBy: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF3E2', borderRadius: 10, padding: 10, marginTop: 8 },
  payByText: { flex: 1, marginLeft: 8, color: '#8A4B0B', fontSize: 12.5, lineHeight: 17 },

  transport: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderColor: '#E6ECE8' },
  transportHead: { flexDirection: 'row', alignItems: 'center' },
  transportTitle: { flex: 1, fontWeight: '700', color: C.primary, fontSize: 14, marginLeft: 8 },
  infoLine: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 5 },
  infoText: { flex: 1, marginLeft: 8, color: '#4A5A52', fontSize: 13, lineHeight: 18 },
});