import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, Alert, ScrollView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import QRCode from 'react-native-qrcode-svg';
import { supabase, PAGE_SIZE } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import ScreenHeader from '../components/ScreenHeader';
import { Btn, Card, Muted, Pager, Loader, Chip } from '../components/ui';
import { startPayment } from '../lib/payments';
import { ymd } from '../lib/pricing';
import { tr } from '../i18n';

const CANCELLED = ['cancelled', 'declined'];
const dropOf = (b) => [].concat(b.booking_dropoffs || [])[0]?.dropoff_location;
const TABS = [
  ['upcoming', '📅 Upcoming', 'No upcoming bookings.'],
  ['pending', '⏳ Pending', 'No pending bookings.'],
  ['completed', '✅ Completed', 'No completed bookings.'],
  ['cancelled', '❌ Cancelled', 'No cancelled bookings.'],
];

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ticketHtml = (b, qr) => `<html><body style="font-family:Arial;padding:24px">
<h1 style="color:#1B4432">Booking confirmation</h1><h2>${esc(b.listings?.title)}</h2>
<p><b>Reference:</b> ${esc(b.id)}</p><p><b>Dates:</b> ${esc(b.start_date)} to ${esc(b.end_date)}</p>
<p><b>Guests:</b> ${b.guests}</p><p><b>Status:</b> ${esc(b.status)} · <b>Payment:</b> ${esc(b.payment_status)}</p>
${(b.booking_items || []).map((i) => `<p>• ${esc(i.label)} × ${i.quantity} — $${Number(i.amount).toFixed(2)}</p>`).join('')}
<h3>Total: $${Number(b.total).toFixed(2)}</h3>${qr ? `<img src="${qr}" width="180" height="180"/><p>Show this QR at check-in.</p>` : ''}</body></html>`;

export default function MyTrips({ navigation, route }) {
  const { session, profile, refresh } = useAuth();
  const [tab, setTab] = useState(route?.params?.tab || 'upcoming');
  const [rows, setRows] = useState([]); const [page, setPage] = useState(0); const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true); const [offline, setOffline] = useState(false);
  const refs = useRef({}); const [transfers, setTransfers] = useState([]);
  const changeTab = (k) => { setPage(0); setTab(k); };
  useEffect(() => { if (route?.params?.tab) { setPage(0); setTab(route.params.tab); } }, [route?.params?.tab, route?.params?.ts]);

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    const key = `bookings:${session.user.id}:${tab}:${page}`;
    try {
      const today = ymd(new Date());
      let q = supabase.from('bookings').select('*, listings(title,category,photos), booking_items(*), booking_dropoffs(*)').eq('user_id', session.user.id);
      if (tab === 'pending') q = q.eq('status', 'pending');
      else if (tab === 'upcoming') q = q.eq('status', 'accepted').gte('end_date', today);
      else if (tab === 'completed') q = q.or(`status.eq.completed,and(status.eq.accepted,end_date.lt.${today})`);
      else q = q.in('status', CANCELLED);
      const { data, error } = await q.order(tab === 'upcoming' ? 'start_date' : 'created_at', { ascending: tab === 'upcoming' })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
      if (error || !data) throw error || new Error('offline');
      const list = data.slice(0, PAGE_SIZE); const hasMore = data.length > PAGE_SIZE;
      setRows(list); setMore(hasMore); setOffline(false);
      AsyncStorage.setItem(key, JSON.stringify({ list, hasMore })); // copy kept on the phone
      supabase.from('airport_transfers').select('*').eq('user_id', session.user.id).order('created_at', { ascending: false }).limit(5).then(({ data: t }) => setTransfers(t || []));
      refresh();
    } catch (e) {
      const c = await AsyncStorage.getItem(key);
      if (c) { const j = JSON.parse(c); setRows(j.list); setMore(j.hasMore); setOffline(true); } else setRows([]);
    }
    setLoading(false);
  }, [page, session, tab]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const download = (b) => {
    const run = async (qr) => {
      try {
        const { uri } = await Print.printToFileAsync({ html: ticketHtml(b, qr) });
        const dir = FileSystem.documentDirectory + 'bookings/';
        await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
        const dest = `${dir}booking-${b.id.slice(0, 8)}.pdf`;
        await FileSystem.copyAsync({ from: uri, to: dest });
        if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(dest, { mimeType: 'application/pdf', dialogTitle: 'Save or share your booking' });
        else Alert.alert('Saved', 'Your booking was saved on this phone.');
      } catch (e) { Alert.alert('Could not save', e.message); }
    };
    const ref = refs.current[b.id];
    if (ref?.toDataURL) ref.toDataURL((d) => run('data:image/png;base64,' + d)); else run(null);
  };
  const answerCancel = async (id, ok) => { const { error } = await supabase.rpc('respond_cancel_request', { p_booking: id, p_accept: ok }); if (error) Alert.alert('Error', error.message); load(); };
  const cancel = (id) => Alert.alert('Cancel this unpaid booking?', 'You can cancel until 6 hours before the visit.', [{ text: 'No' }, { text: 'Yes', onPress: async () => { const { error } = await supabase.rpc('cancel_booking', { p_booking: id }); if (error) Alert.alert('Error', error.message); load(); } }]);
  const addOns = async (b) => { const { data: l } = await supabase.from('listings').select('*').eq('id', b.listing_id).single(); navigation.navigate('AddOns', { main: b, listing: l }); };
  const pay = async (b) => { try { const p = await startPayment(b.package_id ? { purpose: 'package', packageId: b.package_id } : { purpose: 'booking', bookingId: b.id }); navigation.navigate('Pay', { url: p.authorization_url }); } catch (e) { Alert.alert('Error', e.message); } };

  if (!session) return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title="My bookings" icon="ticket-outline" />
      <View style={{ flex: 1, justifyContent: 'center', padding: 28 }}>
        <Muted style={{ textAlign: 'center', marginBottom: 12 }}>Sign in to see and download your bookings.</Muted>
        <Btn title={tr('login')} onPress={() => navigation.navigate('Auth', { reason: 'trips' })} />
      </View>
    </View>);

  const emptyText = TABS.find((t) => t[0] === tab)[2];

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title="My bookings" icon="ticket-outline" subtitle={`${tr('balance')}: $${Number(profile?.balance || 0).toFixed(2)}${offline ? '  ·  offline copy' : ''}`} />
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8 }}>
          {TABS.map(([k, label]) => <Chip key={k} label={label} active={tab === k} onPress={() => changeTab(k)} />)}
        </ScrollView>
      </View>
      {loading ? <Loader /> : <FlatList data={rows} keyExtractor={(i) => i.id}
        ListHeaderComponent={tab === 'upcoming' && transfers.length ? (<View><Text style={{ fontWeight: '800', fontSize: 16, margin: 12, marginBottom: 0 }}>✈️ Airport transfers</Text>{transfers.map((t) => (<Card key={t.id}><Text style={{ fontWeight: '700' }}>{t.pickup} → {t.dropoff}</Text><Muted>{new Date(t.pickup_time).toLocaleString()} · {t.passengers} passengers · ${Number(t.price).toFixed(2)}</Muted><Text>Payment: {t.payment_status}</Text></Card>))}<Text style={{ fontWeight: '800', fontSize: 16, margin: 12, marginBottom: 0 }}>🏨 Bookings</Text></View>) : null}
        ListEmptyComponent={<Muted style={{ textAlign: 'center', margin: 30 }}>{emptyText}</Muted>}
        ListFooterComponent={<Pager page={page} setPage={setPage} hasMore={more} />}
        renderItem={({ item: b }) => {
          const showQR = ['accepted', 'completed'].includes(b.status) && ['hotel', 'campsite', 'event', 'attraction'].includes(b.listings?.category);
          const unpaid = b.payment_status === 'unpaid' && b.status === 'pending';
          return (
            <Card>
              <Text style={{ fontWeight: '700', fontSize: 16 }}>{b.listings?.title}</Text>
              <Muted>{b.start_date} → {b.end_date} · {b.guests} guests · ${Number(b.total).toFixed(2)}</Muted>
              <Text>Status: {b.status} · Payment: {b.payment_status}{b.urgent ? ' · URGENT' : ''}</Text>
              {b.status === 'pending' && b.payment_status === 'paid' && <Muted>Host must respond by {new Date(b.respond_by).toLocaleString()}</Muted>}
              {unpaid && <Muted>⏳ Pay before {new Date(b.pay_by).toLocaleString()} or it is cancelled</Muted>}
              {b.start_time && <Muted>🕒 {b.start_time.slice(0, 5)}{b.parent_booking_id ? ' · added to your trip' : ''}</Muted>}
              {b.pickup_location ? <Muted>📍 Pickup: {b.pickup_location}{b.pickup_time ? ` at ${b.pickup_time.slice(0, 5)}` : ''}</Muted> : null}
              {dropOf(b) ? <Muted>🏁 Drop-off: {dropOf(b)}</Muted> : null}
              {b.return_date ? <Muted>↩️ Return: {b.return_date}{b.return_time ? ` at ${b.return_time.slice(0, 5)}` : ''}</Muted> : null}
              {b.status === 'declined' && b.decline_reason ? <Muted>Reason: {b.decline_reason}</Muted> : null}
              {b.cancel_requested && (<View><Text style={{ color: '#D64545', fontWeight: '700' }}>The host asked to cancel: {b.cancel_reason}</Text><View style={{ flexDirection: 'row' }}><Btn style={{ flex: 1, margin: 2 }} title="Approve (refund)" onPress={() => answerCancel(b.id, true)} /><Btn style={{ flex: 1, margin: 2 }} kind="ghost" title="Keep booking" onPress={() => answerCancel(b.id, false)} /></View></View>)}
              {unpaid && <Btn title={b.package_id ? 'Pay now (whole trip)' : 'Pay now'} onPress={() => pay(b)} />}
              {unpaid && <Btn kind="ghost" title="✏️ Edit booking" onPress={() => navigation.navigate('EditBooking', { id: b.id })} />}
              {showQR && <View style={{ alignItems: 'center', marginVertical: 10 }}><QRCode value={b.qr_token} size={140} getRef={(c) => { refs.current[b.id] = c; }} /><Muted>Show this QR at check-in</Muted></View>}
              {b.payment_status === 'paid' && !CANCELLED.includes(b.status) && <Btn kind="ghost" title="⬇️ Download booking (PDF)" onPress={() => download(b)} />}
              {b.payment_status === 'paid' && ['pending', 'accepted', 'completed'].includes(b.status) && <Btn kind="ghost" title="💬 Chat with host" onPress={() => navigation.navigate('Chat', { bookingId: b.id, title: b.listings?.title })} />}
              {['accepted', 'completed'].includes(b.status) && b.payment_status === 'paid' && <Btn kind="ghost" title={`⭐ ${tr('review')}`} onPress={() => navigation.navigate('Review', { booking: b })} />}
              {['pending', 'accepted'].includes(b.status) && b.payment_status === 'paid' && <Btn kind="ghost" title="➕ Add pickup / stopover / stay / activity" onPress={() => addOns(b)} />}
              {b.payment_status === 'paid' && ['pending', 'accepted'].includes(b.status) && <Muted style={{ marginTop: 4 }}>Paid bookings cannot be cancelled.</Muted>}
              {unpaid && (((new Date(`${b.start_date}T${(b.start_time || '09:00').slice(0, 5)}:00`)) - Date.now()) / 3600000 > 6
                ? <Btn kind="danger" title={tr('cancel')} onPress={() => cancel(b.id)} />
                : <Muted style={{ marginTop: 4 }}>Cancelling is only possible up to 6 hours before the visit.</Muted>)}
            </Card>);
        }} />}
    </View>
  );
}
