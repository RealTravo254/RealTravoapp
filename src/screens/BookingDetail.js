import React, { useState, useCallback, useRef } from 'react';
import { View, Text, ScrollView, Alert, TouchableOpacity, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import QRCode from 'react-native-qrcode-svg';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { Btn, Muted, Loader } from '../components/ui';
import { choosePayment } from '../lib/payments';
import { tr } from '../i18n';
import { C } from '../lib/theme';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CANCELLED = ['cancelled', 'declined'];
const fmtDate = (d) => { if (!d) return '-'; const x = new Date(`${String(d).slice(0, 10)}T12:00:00`); return `${x.getDate()} ${MONTHS[x.getMonth()]} ${x.getFullYear()}`; };
const hm = (t) => (t ? String(t).slice(0, 5) : '-');
const isoTime = (t) => { if (!t) return '-'; const x = new Date(t); return isNaN(x) ? '-' : `${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`; };
const sameDay = (a, b) => String(a).slice(0, 10) === String(b || a).slice(0, 10);
const esc = (x) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const STATUS_STYLE = {
  pending: { label: 'Pending', color: '#B45309', bg: '#FEF3E2' },
  accepted: { label: 'Confirmed', color: '#1B7F4B', bg: '#E6F4EC' },
  completed: { label: 'Completed', color: '#1D5FA8', bg: '#E8F0FB' },
  cancelled: { label: 'Cancelled', color: '#B42318', bg: '#FDECEA' },
  declined: { label: 'Declined', color: '#B42318', bg: '#FDECEA' },
};
const statusStyle = (st) => STATUS_STYLE[st] || { label: String(st || '-'), color: '#4A5A52', bg: '#EEF2EF' };

const ticketHtml = (b, items, qr, formatMoney) => `<html><body style="font-family:Arial;padding:24px">
<h1 style="color:#1B4432">Booking confirmation</h1><h2>${esc(b.listings?.title)}</h2>
<p><b>Reference:</b> ${esc(b.id)}</p><p><b>Dates:</b> ${esc(b.start_date)} to ${esc(b.end_date)}</p>
<p><b>Guests:</b> ${b.adults ?? b.guests} adults${b.children ? `, ${b.children} children` : ''}</p><p><b>Status:</b> ${esc(b.status)} · <b>Payment:</b> ${esc(b.payment_status)}</p>
${b.contact_email ? `<p><b>Contact email:</b> ${esc(b.contact_email)}</p>` : ''}
${b.contact_phone ? `<p><b>Contact phone:</b> ${esc(b.contact_phone)}</p>` : ''}
${items.map((i) => `<p>• ${esc(i.label)} × ${i.quantity} — ${esc(formatMoney(i.amount))}</p>`).join('')}
<h3>Total: ${esc(formatMoney(b.total))}</h3>${qr ? `<img src="${qr}" width="180" height="180"/><p>Show this QR or give the host your booking ID at check-in.</p>` : `<p>Give the host your booking ID at check-in.</p>`}</body></html>`;

const Section = ({ icon, title, children }) => (
  <View style={s.card}>
    <View style={s.cardHead}><Ionicons name={icon} size={18} color={C.primary} /><Text style={s.cardTitle}>{title}</Text></View>
    {children}
  </View>
);
const Collapsible = ({ icon, title, children }) => {
  const [open, setOpen] = useState(false);               // closed until tapped
  return (
    <View style={s.card}>
      <TouchableOpacity onPress={() => setOpen(!open)} activeOpacity={0.7} style={[s.cardHead, { marginBottom: open ? 8 : 0 }]}>
        <Ionicons name={icon} size={18} color={C.primary} />
        <Text style={[s.cardTitle, { flex: 1 }]}>{title}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={20} color={C.primary} />
      </TouchableOpacity>
      {open && children}
    </View>
  );
};
const Row = ({ label, value, bold, color }) => (
  <View style={s.row}>
    <Text style={s.rowLabel}>{label}</Text>
    <Text style={[s.rowValue, bold && { fontWeight: '800' }, color && { color }]}>{value}</Text>
  </View>
);
const Items = ({ items, formatMoney }) => (items.length === 0 ? <Muted>No items listed.</Muted> : items.map((i, k) => (
  <View key={i.id || k} style={s.itemRow}>
    <Text style={s.itemLabel}>{i.label}</Text>
    <Text style={s.itemQty}>{Number(i.quantity)} x {formatMoney(i.unit_price)}</Text>
    <Text style={s.itemAmt}>{formatMoney(i.amount)}</Text>
  </View>
)));

export default function BookingDetail({ route, navigation }) {
  const { id } = route.params;
  const { session, formatMoney } = useAuth();
  const [d, setD] = useState(undefined);
  const [err, setErr] = useState(null);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const qrRef = useRef(null);

  const load = useCallback(async () => {
    const key = `booking-detail:${session?.user?.id}:${id}`;
    try {
      const { data: b, error } = await supabase.from('bookings').select('*, listings(*), booking_items(*), booking_dropoffs(*)').eq('id', id).single();
      if (error) throw error;
      const { data: kids } = await supabase.from('bookings').select('*, listings(id,title,category), booking_items(*)').eq('parent_booking_id', id).order('start_date');
      let pkg = null; let veh = null;
      if (b.package_id) pkg = (await supabase.from('trip_packages').select('*').eq('id', b.package_id).maybeSingle()).data;
      if (pkg?.vehicle_id) veh = (await supabase.from('vehicles').select('*').eq('id', pkg.vehicle_id).maybeSingle()).data;
      const saved = { b, kids: kids || [], pkg, veh };
      setD(saved); setErr(null); setOffline(false);
      if (session?.user?.id) AsyncStorage.setItem(key, JSON.stringify(saved)).catch((storageError) => console.warn('Could not cache booking details:', storageError.message));
    } catch (e) {
      const cached = session?.user?.id ? await AsyncStorage.getItem(key) : null;
      if (cached) {
        try { setD(JSON.parse(cached)); setErr(null); setOffline(true); }
        catch (cacheError) { setErr(cacheError.message); setD(null); }
      } else { setErr(e.message); setD(null); }
    }
  }, [id, session?.user?.id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (d === undefined) return <Loader />;
  if (!d) return <Muted style={{ margin: 24 }}>{err || 'This booking is not available.'}</Muted>;

  const { b, kids, pkg, veh } = d;
  const st = b.no_show_resolution === 'pending'
    ? { label: 'No-show under review', color: '#B45309', bg: '#FEF3E2' }
    : statusStyle(b.status);
  const L = b.listings || {};
  const items = [].concat(b.booking_items || []);
  const drop = [].concat(b.booking_dropoffs || [])[0];
  const isReturn = (b.trip_type || pkg?.trip_type) === 'return';
  const hasTransport = !!(b.pickup_location || pkg?.pickup_location || drop || veh || b.return_date);
  const mainTotal = Number(b.total || 0);
  const addonTotal = kids.reduce((x, k) => x + Number(k.total || 0), 0);
  const transfer = Number(pkg?.transfer_price || 0);
  const grand = pkg && pkg.total != null ? Number(pkg.total) : mainTotal + addonTotal + transfer;
  const paid = b.payment_status === 'paid';
  const unpaid = b.payment_status === 'unpaid' && b.status === 'pending';
  const showQR = ['accepted', 'completed'].includes(b.status) && !b.checked_in_at && ['hotel', 'campsite', 'event', 'attraction'].includes(L.category) && !!b.qr_token;
  const hoursLeft = (new Date(`${String(b.start_date).slice(0, 10)}T${(b.start_time || '09:00').slice(0, 5)}:00`) - Date.now()) / 3600000;

  const openListing = (lid) => navigation.navigate('ListingDetail', { id: lid });
  const pay = async () => {
    setBusy(true);
    try { choosePayment(navigation, b.package_id ? { purpose: 'package', packageId: b.package_id } : { purpose: 'booking', bookingId: b.id }); }
    catch (e) { Alert.alert('Error', e.message); } finally { setBusy(false); }
  };
  const answerCancel = async (ok) => { const { error } = await supabase.rpc('respond_cancel_request', { p_booking: b.id, p_accept: ok }); if (error) Alert.alert('Error', error.message); load(); };
  const cancel = () => Alert.alert('Cancel this unpaid booking?', 'You can cancel until 6 hours before the visit.', [{ text: 'No' }, { text: 'Yes', onPress: async () => { const { error } = await supabase.rpc('cancel_booking', { p_booking: b.id }); if (error) Alert.alert('Error', error.message); load(); } }]);
  const addOns = () => navigation.navigate('AddOns', { main: b, listing: L });
  const download = () => {
    const run = async (qr) => {
      try {
        const { uri } = await Print.printToFileAsync({ html: ticketHtml(b, items, qr, formatMoney) });
        const dir = FileSystem.documentDirectory + 'bookings/';
        await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
        const dest = `${dir}booking-${String(b.id).slice(0, 8)}.pdf`;
        await FileSystem.copyAsync({ from: uri, to: dest });
        if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(dest, { mimeType: 'application/pdf', dialogTitle: 'Save or share your booking' });
        else Alert.alert('Saved', 'Your booking was saved on this phone.');
      } catch (e) { Alert.alert('Could not save', e.message); }
    };
    if (qrRef.current?.toDataURL) qrRef.current.toDataURL((x) => run('data:image/png;base64,' + x)); else run(null);
  };

  return (
    <ScrollView style={{ backgroundColor: '#F4F7F5' }} contentContainerStyle={{ padding: 12, paddingBottom: 40 }}>
      {/* summary */}
      {offline && <Text style={s.notice}>Showing the booking saved on this device. Reconnect to refresh its status.</Text>}
      <View style={s.top}>
        <Text style={s.topTitle}>{L.title || 'Booking'}</Text>
        <Text style={s.topSub}>{L.category ? `${L.category} · ` : ''}Ref {String(b.id).slice(0, 8).toUpperCase()}{b.parent_booking_id ? ' · add-on' : ''}</Text>
        <View style={s.topRow}>
          <View style={{ flexDirection: 'row' }}>
            <View style={[s.pill, { backgroundColor: st.bg, marginRight: 6 }]}><Text style={[s.pillText, { color: st.color }]}>{st.label}</Text></View>
            <View style={[s.pill, { backgroundColor: paid ? '#E6F4EC' : '#FEF3E2' }]}><Text style={[s.pillText, { color: paid ? '#1B7F4B' : '#B45309' }]}>{paid ? 'Paid' : 'Unpaid'}</Text></View>
          </View>
          <Text style={s.topTotal}>{formatMoney(grand)}</Text>
        </View>
      </View>

      {/* notices */}
      {b.status === 'pending' && paid && !!b.respond_by && <Text style={s.notice}>The host must respond by {new Date(b.respond_by).toLocaleString()}</Text>}
      {unpaid && !!b.pay_by && <Text style={s.notice}>⏳ Pay before {new Date(b.pay_by).toLocaleString()} or it is cancelled</Text>}
      {b.status === 'declined' && !!b.decline_reason && <Text style={s.notice}>Reason: {b.decline_reason}</Text>}
      {b.no_show_resolution === 'pending' && <Text style={s.notice}>Your host reported a no-show. Admin will contact you before deciding whether to refund your balance or release the booking earnings to the host.</Text>}
      {!!b.cancel_requested && (
        <View style={[s.card, { borderColor: '#D64545' }]}>
          <Text style={{ color: '#D64545', fontWeight: '700' }}>The host asked to cancel: {b.cancel_reason}</Text>
          <View style={{ flexDirection: 'row' }}>
            <Btn style={{ flex: 1, margin: 2 }} title="Approve (refund)" onPress={() => answerCancel(true)} />
            <Btn style={{ flex: 1, margin: 2 }} kind="ghost" title="Keep booking" onPress={() => answerCancel(false)} />
          </View>
        </View>
      )}

      <Section icon="calendar-outline" title="Booking">
        <Row label="Date" value={sameDay(b.start_date, b.end_date) ? fmtDate(b.start_date) : `${fmtDate(b.start_date)} to ${fmtDate(b.end_date)}`} />
        {!!b.start_time && <Row label="Start time" value={hm(b.start_time)} />}
        {Number(b.nights) > 1 && <Row label="Nights / days" value={String(b.nights)} />}
        <Row label="Guests" value={`${b.adults ?? b.guests} adults${b.children ? ` · ${b.children} children` : ''}`} />
        {!!b.contact_phone && <Row label="Contact phone" value={b.contact_phone} />}
        {!!b.contact_email && <Row label="Contact email" value={b.contact_email} />}
        <Row label="Booking ID (host check-in)" value={b.id} />
        {!!b.note && <Row label="Your note" value={b.note} />}
        {!!b.urgent && <Row label="Priority" value="Urgent" color="#B42318" />}
        {!!b.parent_booking_id && (
          <TouchableOpacity onPress={() => navigation.navigate('BookingDetail', { id: b.parent_booking_id })} style={s.link}>
            <Text style={s.linkText}>View the main booking of this trip</Text><Ionicons name="chevron-forward" size={16} color={C.primary} />
          </TouchableOpacity>
        )}
        {!!L.id && (
          <TouchableOpacity onPress={() => openListing(L.id)} style={s.link}>
            <Text style={s.linkText}>View {L.title}</Text><Ionicons name="chevron-forward" size={16} color={C.primary} />
          </TouchableOpacity>
        )}
      </Section>

      <Section icon="receipt-outline" title="What you booked">
        <Items items={items} formatMoney={formatMoney} />
        <View style={s.sumRow}><Text style={s.sumLabel}>Subtotal</Text><Text style={s.sumVal}>{formatMoney(mainTotal)}</Text></View>
      </Section>

      {kids.length > 0 && (
        <Section icon="add-circle-outline" title={`Add-ons (${kids.length})`}>
          {kids.map((k, i) => {
            const ks = statusStyle(k.status);
            return (
              <View key={k.id} style={[s.kid, i > 0 && { borderTopWidth: 1, borderColor: '#E6ECE8' }]}>
                <TouchableOpacity onPress={() => navigation.navigate('BookingDetail', { id: k.id })} style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.kidTitle}>{k.listings?.title || 'Add-on'}</Text>
                    <Text style={s.kidMeta}>
                      {k.listings?.category ? `${k.listings.category} · ` : ''}{fmtDate(k.start_date)}{!sameDay(k.start_date, k.end_date) ? ` to ${fmtDate(k.end_date)}` : ''}
                      {k.start_time ? ` · ${hm(k.start_time)}` : ''}{Number(k.nights) > 1 ? ` · ${k.nights} nights` : ''} · {k.guests} {Number(k.guests) === 1 ? 'guest' : 'guests'}
                    </Text>
                  </View>
                  <View style={[s.pill, { backgroundColor: ks.bg }]}><Text style={[s.pillText, { color: ks.color }]}>{ks.label}</Text></View>
                  <Ionicons name="chevron-forward" size={16} color="#9AA8A0" style={{ marginLeft: 4 }} />
                </TouchableOpacity>
                <View style={{ marginTop: 6 }}><Items items={[].concat(k.booking_items || [])} formatMoney={formatMoney} /></View>
                <View style={s.sumRow}><Text style={s.sumLabel}>Add-on total</Text><Text style={s.sumVal}>{formatMoney(k.total)}</Text></View>
              </View>
            );
          })}
        </Section>
      )}

      <Section icon="card-outline" title="Payment summary">
        <Row label="Main booking" value={formatMoney(mainTotal)} />
        {kids.length > 0 && <Row label={`Add-ons (${kids.length})`} value={formatMoney(addonTotal)} />}
        {transfer > 0 && <Row label="Transfer" value={formatMoney(transfer)} />}
        <Row label="Payment" value={String(b.payment_status || 'unpaid')} color={paid ? '#1B7F4B' : '#B45309'} bold />
        <View style={s.grand}><Text style={s.grandLabel}>Total</Text><Text style={s.grandVal}>{formatMoney(grand)}</Text></View>
      </Section>

      {showQR && (
        <Section icon="qr-code-outline" title="Check-in QR">
          <View style={{ alignItems: 'center', marginVertical: 6 }}>
            <QRCode value={b.qr_token} size={160} getRef={(c) => { qrRef.current = c; }} />
            <Muted>Show this QR at check-in</Muted>
          </View>
        </Section>
      )}

      {/* actions */}
      <View style={{ marginBottom: 6 }}>
        {unpaid && <Btn title={busy ? 'Please wait' : `${b.package_id ? 'Pay now (whole trip)' : 'Pay now'} · ${formatMoney(grand)}`} onPress={pay} disabled={busy} />}
        {unpaid && <Btn kind="ghost" title="✏️ Edit booking" onPress={() => navigation.navigate('EditBooking', { id: b.id })} />}
        {paid && !CANCELLED.includes(b.status) && <Btn kind="ghost" title="⬇️ Download booking (PDF)" onPress={download} />}
        {paid && ['pending', 'accepted', 'completed'].includes(b.status) && <Btn kind="ghost" title="💬 Chat with host" onPress={() => navigation.navigate('Chat', { bookingId: b.id, title: L.title })} />}
        {['accepted', 'completed'].includes(b.status) && paid && <Btn kind="ghost" title={`⭐ ${tr('review')}`} onPress={() => navigation.navigate('Review', { booking: b })} />}
        {['pending', 'accepted'].includes(b.status) && paid && <Btn kind="ghost" title="➕ Add pickup / stopover / stay / activity" onPress={addOns} />}
        {paid && ['pending', 'accepted'].includes(b.status) && <Muted style={{ marginTop: 4 }}>Paid bookings cannot be cancelled.</Muted>}
        {unpaid && (hoursLeft > 6
          ? <Btn kind="danger" title={tr('cancel')} onPress={cancel} />
          : <Muted style={{ marginTop: 4 }}>Cancelling is only possible up to 6 hours before the visit.</Muted>)}
      </View>

      {/* LAST SECTION, closed until tapped */}
      {hasTransport && (
        <Collapsible icon="car-outline" title="Pickup and return">
          <Row label="Trip" value={isReturn ? 'Pickup and return' : 'Pickup only'} />
          <Row label="Pickup place" value={b.pickup_location || pkg?.pickup_location || '-'} />
          <Row label="Pickup time" value={b.pickup_time ? hm(b.pickup_time) : isoTime(pkg?.pickup_time)} />
          {isReturn && <Row label="Drop-off place" value={drop?.dropoff_location || pkg?.dropoff_location || b.pickup_location || '-'} />}
          {isReturn && <Row label="Return" value={`${fmtDate(b.return_date || pkg?.return_date)} at ${hm(b.return_time || pkg?.return_time)}`} />}
          {!!veh && <Row label="Vehicle" value={`${veh.name} (max ${veh.max_passengers})`} />}
          {pkg?.distance_km != null && <Row label="Distance" value={`${pkg.distance_km} km`} />}
          {transfer > 0 && <View style={s.sumRow}><Text style={s.sumLabel}>Transfer price</Text><Text style={s.sumVal}>{formatMoney(transfer)}</Text></View>}
        </Collapsible>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  top: { backgroundColor: C.primary, borderRadius: 16, padding: 16, marginBottom: 10 },
  topTitle: { color: '#fff', fontSize: 22, fontWeight: '800' },
  topSub: { color: '#fff', opacity: 0.9, marginTop: 2, textTransform: 'capitalize' },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  topTotal: { color: '#fff', fontSize: 24, fontWeight: '800' },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  pillText: { fontSize: 12, fontWeight: '700' },
  notice: { color: '#8A5A00', backgroundColor: '#FEF3E2', padding: 10, borderRadius: 10, marginBottom: 10, fontWeight: '600' },
  card: { backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#E6ECE8' },
  cardHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  cardTitle: { fontSize: 16, fontWeight: '800', color: C.text, marginLeft: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  rowLabel: { fontSize: 14.5, color: '#5F6B66', marginRight: 12 },
  rowValue: { fontSize: 14.5, fontWeight: '600', color: C.text, flexShrink: 1, textAlign: 'right' },
  itemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  itemLabel: { flex: 1, fontSize: 14.5, color: C.text },
  itemQty: { fontSize: 13, color: '#6B7A72', marginHorizontal: 8 },
  itemAmt: { fontSize: 14.5, fontWeight: '700', color: C.text, minWidth: 64, textAlign: 'right' },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderColor: '#E6ECE8' },
  sumLabel: { fontSize: 14, color: '#5F6B66' },
  sumVal: { fontSize: 15, fontWeight: '800', color: C.text },
  kid: { paddingVertical: 10 },
  kidTitle: { fontSize: 15.5, fontWeight: '700', color: C.text },
  kidMeta: { fontSize: 12.5, color: '#6B7A72', marginTop: 2, textTransform: 'capitalize' },
  link: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, paddingTop: 10, borderTopWidth: 1, borderColor: '#E6ECE8' },
  linkText: { color: C.primary, fontWeight: '700', fontSize: 14.5 },
  grand: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, paddingTop: 10, borderTopWidth: 1, borderColor: '#E6ECE8' },
  grandLabel: { fontSize: 17, fontWeight: '800', color: C.text },
  grandVal: { fontSize: 22, fontWeight: '800', color: C.primary },
});