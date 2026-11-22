import React, { useCallback, useRef, useState } from 'react';
import { View, Text, FlatList, Alert, StyleSheet, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { supabase, PAGE_SIZE } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import { C, shadow } from '../../lib/theme';
import Pagination from '../../components/Pagination';
import { refreshCheckinCache } from '../../lib/offlineCheckins';

const FILTERS = [['all', 'All'], ['pending', 'Pending'], ['accepted', 'Accepted'], ['completed', 'Completed'], ['no_show', 'No-show review']];

const STATUS = {
  pending: { label: 'Needs your reply', fg: C.amberInk, bg: C.amberSoft },
  accepted: { label: 'Accepted', fg: C.green, bg: C.greenSoft },
  completed: { label: 'Completed', fg: C.blue, bg: C.blueSoft },
  declined: { label: 'Declined', fg: C.red, bg: C.redSoft },
  cancelled: { label: 'Cancelled', fg: C.grey, bg: C.greySoft },
};
const PAY = {
  paid: { label: 'Paid', fg: C.green, bg: C.greenSoft },
  refunded: { label: 'Refunded', fg: C.grey, bg: C.greySoft },
};

const fmt = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

function Pill({ conf, fallback }) {
  const c = conf || { label: fallback, fg: C.grey, bg: C.greySoft };
  return (
    <View style={[s.pill, { backgroundColor: c.bg }]}>
      <View style={[s.dot, { backgroundColor: c.fg }]} />
      <Text style={[s.pillText, { color: c.fg }]}>{c.label}</Text>
    </View>
  );
}

function Btn({ icon, title, onPress, tone = 'soft', flex }) {
  const t = {
    solid: { bg: C.primary, fg: '#fff' },
    soft: { bg: C.primarySoft, fg: C.primary },
    danger: { bg: C.redSoft, fg: C.red },
  }[tone];
  return (
    <TouchableOpacity activeOpacity={0.8} onPress={onPress} style={[s.btn, { backgroundColor: t.bg }, flex && { flex: 1 }]}>
      <Ionicons name={icon} size={16} color={t.fg} />
      <Text style={[s.btnText, { color: t.fg }]}>{title}</Text>
    </TouchableOpacity>
  );
}

function Line({ icon, children }) {
  return (
    <View style={s.line}>
      <Ionicons name={icon} size={15} color={C.muted} />
      <Text style={s.lineText}>{children}</Text>
    </View>
  );
}

export default function HostBookings({ navigation }) {
  const { session, formatMoney } = useAuth();
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const listRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: mine } = await supabase.from('listings').select('id').eq('owner_id', session.user.id);
    const ids = (mine || []).map((x) => x.id);
    if (!ids.length) { setRows([]); setTotal(0); setLoading(false); return; }
    try { await refreshCheckinCache(session.user.id); }
    catch (e) { console.warn('Could not refresh offline check-in bookings:', e.message); }

    const from = page * PAGE_SIZE;
    let q = supabase
      .from('bookings')
      .select('*, listings(title,category), booking_items(*)', { count: 'exact' })
      .in('listing_id', ids)
      .in('payment_status', ['paid', 'refunded']);
    if (filter === 'no_show') q = q.eq('no_show_resolution', 'pending');
    else if (filter !== 'all') q = q.eq('status', filter);
    const { data, error, count } = await q
      .order('urgent', { ascending: false })
      .order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) Alert.alert('Error', error.message);
    setRows(data || []);
    setTotal(count || 0);
    setLoading(false);
  }, [page, filter, session.user.id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const goTo = (n) => { setPage(n); listRef.current?.scrollToOffset({ offset: 0, animated: true }); };
  const changeFilter = (k) => { setFilter(k); setPage(0); };
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const cancelReq = async (id, reason) => {
    const { error } = await supabase.rpc('host_request_cancel', { p_booking: id, p_reason: reason });
    if (error) Alert.alert('Error', error.message);
    else { Alert.alert('Request sent', 'The guest was notified and can approve a refund.'); load(); }
  };
  const askCancel = (id) => Alert.alert('Request cancellation', 'Why? The guest must approve and is refunded.', [
    { text: 'Cannot host that day', onPress: () => cancelReq(id, 'The host cannot host on that day') },
    { text: 'Place closed', onPress: () => cancelReq(id, 'The place is closed') },
    { text: 'Other reason', onPress: () => cancelReq(id, 'Other reason - the host will explain in chat') },
    { text: 'Back', style: 'cancel' },
  ]);
  const respond = async (id, accept) => {
    const { error } = await supabase.rpc('respond_booking', { p_booking: id, p_accept: accept, p_reason: accept ? null : 'Declined by host' });
    if (error) Alert.alert('Error', error.message);
    load();
  };
  const askDecline = (id) => Alert.alert('Decline this booking?', 'The guest will be notified.', [
    { text: 'Keep it', style: 'cancel' },
    { text: 'Decline', style: 'destructive', onPress: () => respond(id, false) },
  ]);
  const reportNoShow = (booking) => Alert.alert(
    'Report guest no-show?',
    'Only report this after the scheduled activity or guided trip has started and the guest did not arrive. Admin will contact the guest before deciding the outcome.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Report no-show',
        style: 'destructive',
        onPress: async () => {
          const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
          const { error } = await supabase.rpc('report_booking_no_show', { p_booking: booking.id, p_time_zone: timeZone });
          if (error) Alert.alert('Could not report no-show', error.message);
          else { Alert.alert('Reported', 'Admin will review this booking and contact the guest.'); load(); }
        },
      },
    ],
  );

  const Header = (
    <View>
      <View style={s.titleRow}>
        <Text style={s.title}>Bookings</Text>
        {!loading && <Text style={s.count}>{total} total</Text>}
      </View>
      <View style={s.filters}>
        {FILTERS.map(([k, l]) => (
          <TouchableOpacity key={k} onPress={() => changeFilter(k)} style={[s.chip, filter === k && s.chipOn]}>
            <Text style={[s.chipText, filter === k && s.chipTextOn]}>{l}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  const Empty = loading ? (
    <ActivityIndicator style={{ marginTop: 40 }} color={C.primary} />
  ) : (
    <View style={s.empty}>
      <View style={s.emptyIcon}><Ionicons name="calendar-outline" size={30} color={C.primary} /></View>
      <Text style={s.emptyTitle}>{filter === 'all' ? 'No bookings yet' : `No ${filter} bookings`}</Text>
      <Text style={s.emptySub}>Paid bookings for your listings will show up here.</Text>
    </View>
  );

  const renderItem = ({ item: b }) => {
    const sameDay = !b.end_date || b.end_date === b.start_date;
    const scheduledAt = b.start_date
      ? new Date(`${b.start_date}T${b.start_time ? b.start_time.slice(0, 5) : '23:59:59'}`)
      : null;
    const canReportNoShow = ['activity', 'guide'].includes(b.listings?.category)
      && ['accepted', 'completed'].includes(b.status)
      && b.payment_status === 'paid'
      && !b.no_show_resolution
      && !b.checked_in_at
      && scheduledAt
      && scheduledAt <= new Date();
    return (
      <View style={[s.card, b.urgent && s.cardUrgent]}>
        {b.urgent && (
          <View style={s.urgent}>
            <Ionicons name="flame" size={13} color="#fff" />
            <Text style={s.urgentText}>Urgent</Text>
          </View>
        )}

        <Text style={s.cardTitle} numberOfLines={2}>{b.listings?.title}</Text>
        <View style={s.pills}>
          <Pill
            conf={b.no_show_resolution === 'pending'
              ? { label: 'No-show · Admin review', fg: C.amberInk, bg: C.amberSoft }
              : STATUS[b.status]}
            fallback={b.status}
          />
          <Pill conf={PAY[b.payment_status]} fallback={b.payment_status} />
        </View>

        <View style={s.infoRow}>
          <View style={{ flex: 1 }}>
            <Line icon="calendar-outline">{sameDay ? fmt(b.start_date) : `${fmt(b.start_date)} → ${fmt(b.end_date)}`}</Line>
            <Line icon="people-outline">{b.adults ?? b.guests} adults{b.children ? ` + ${b.children} children` : ''}</Line>
            {!!b.start_time && <Line icon="time-outline">{b.start_time.slice(0, 5)}</Line>}
            {!!b.contact_email && <Line icon="mail-outline">{b.contact_email}</Line>}
          </View>
          <View style={s.totalBox}>
            <Text style={s.totalLabel}>Total</Text>
            <Text style={s.total}>{formatMoney(b.total)}</Text>
          </View>
        </View>

        {!!b.meeting_point && (
          <View style={s.pickup}>
            <Ionicons name="location" size={16} color={C.primary} />
            <Text style={s.pickupText}>Pickup: {b.meeting_point}{b.pickup_time ? ` at ${b.pickup_time.slice(0, 5)}` : ''}</Text>
          </View>
        )}

        {(b.booking_items || []).length > 0 && (
          <View style={s.items}>
            {b.booking_items.map((i) => (
              <View key={i.id} style={s.itemRow}>
                <Text style={s.itemLabel} numberOfLines={1}>{i.label}</Text>
                <Text style={s.itemQty}>× {i.quantity}</Text>
              </View>
            ))}
          </View>
        )}

        {!!b.note && (
          <View style={s.note}>
            <Ionicons name="chatbox-ellipses-outline" size={15} color={C.muted} />
            <Text style={s.noteText}>{b.note}</Text>
          </View>
        )}

        {b.cancel_requested && (
          <View style={s.warn}>
            <Ionicons name="alert-circle" size={16} color={C.red} />
            <Text style={s.warnText}>Cancellation requested. Waiting for the guest.</Text>
          </View>
        )}
        {b.no_show_resolution === 'pending' && (
          <View style={s.warn}>
            <Ionicons name="time-outline" size={16} color={C.amberInk} />
            <Text style={[s.warnText, { color: C.amberInk }]}>Payment is held while Admin contacts the guest.</Text>
          </View>
        )}

        {(b.status === 'pending' || ['pending', 'accepted', 'completed'].includes(b.status) || (['pending', 'accepted'].includes(b.status) && !b.cancel_requested)) && <View style={s.divider} />}

        {b.status === 'pending' && (
          <View style={s.actionRow}>
            <Btn flex tone="solid" icon="checkmark" title="Accept" onPress={() => respond(b.id, true)} />
            <View style={{ width: 8 }} />
            <Btn flex tone="danger" icon="close" title="Decline" onPress={() => askDecline(b.id)} />
          </View>
        )}
        <View style={s.actionRow}>
          {canReportNoShow && (
            <Btn
              flex
              tone="danger"
              icon="person-remove-outline"
              title="Report no-show"
              onPress={() => reportNoShow(b)}
            />
          )}
          {['pending', 'accepted', 'completed'].includes(b.status) && (
            <Btn flex icon="chatbubbles-outline" title="Chat" onPress={() => navigation.navigate('Chat', { bookingId: b.id, title: b.listings?.title })} />
          )}
          {['pending', 'accepted'].includes(b.status) && !b.cancel_requested && (
            <>
              <View style={{ width: 8 }} />
              <Btn flex tone="danger" icon="ban-outline" title="Request cancel" onPress={() => askCancel(b.id)} />
            </>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={s.screen}>
      <FlatList
        ref={listRef}
        data={rows}
        keyExtractor={(i) => i.id}
        renderItem={renderItem}
        ListHeaderComponent={Header}
        ListEmptyComponent={Empty}
        ListFooterComponent={<Pagination page={page} setPage={goTo} total={total} disabled={loading} />}
        contentContainerStyle={s.list}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}
      />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  list: { padding: 16, paddingBottom: 40 },

  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingHorizontal: 2 },
  title: { fontSize: 24, fontWeight: '800', color: C.ink },
  count: { fontSize: 12, color: C.muted },
  filters: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12, marginBottom: 14, marginHorizontal: -3 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: C.card, margin: 3, borderWidth: 1, borderColor: C.line },
  chipOn: { backgroundColor: C.primary, borderColor: C.primary },
  chipText: { fontSize: 13, fontWeight: '700', color: C.ink },
  chipTextOn: { color: '#fff' },

  card: { backgroundColor: C.card, borderRadius: 18, padding: 16, marginBottom: 12, ...shadow },
  cardUrgent: { borderWidth: 1.5, borderColor: C.red },
  urgent: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', backgroundColor: C.red, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 8 },
  urgentText: { color: '#fff', fontSize: 12, fontWeight: '800', marginLeft: 4 },
  cardTitle: { fontSize: 17, fontWeight: '800', color: C.ink, lineHeight: 22 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8, marginHorizontal: -3 },
  pill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, margin: 3 },
  dot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  pillText: { fontSize: 12, fontWeight: '700' },

  infoRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 12 },
  line: { flexDirection: 'row', alignItems: 'center', marginTop: 5 },
  lineText: { fontSize: 14, color: C.ink, marginLeft: 8 },
  totalBox: { alignItems: 'flex-end' },
  totalLabel: { fontSize: 12, color: C.muted },
  total: { fontSize: 24, fontWeight: '800', color: C.primary },

  pickup: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.primarySoft, borderRadius: 12, padding: 10, marginTop: 12 },
  pickupText: { flex: 1, marginLeft: 8, color: C.primary, fontWeight: '600', fontSize: 13 },

  items: { backgroundColor: C.bg, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6, marginTop: 12 },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  itemLabel: { flex: 1, fontSize: 13, color: C.ink, paddingRight: 8 },
  itemQty: { fontSize: 13, fontWeight: '700', color: C.muted },

  note: { flexDirection: 'row', marginTop: 12 },
  noteText: { flex: 1, marginLeft: 8, fontSize: 13, color: C.muted, fontStyle: 'italic', lineHeight: 18 },

  warn: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.redSoft, borderRadius: 12, padding: 10, marginTop: 12 },
  warnText: { flex: 1, marginLeft: 8, color: C.red, fontWeight: '700', fontSize: 13 },

  divider: { height: 1, backgroundColor: C.line, marginTop: 14, marginBottom: 12 },
  actionRow: { flexDirection: 'row', marginBottom: 8 },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 11, paddingHorizontal: 14, borderRadius: 12 },
  btnText: { fontSize: 14, fontWeight: '700', marginLeft: 6 },

  empty: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24 },
  emptyIcon: { width: 64, height: 64, borderRadius: 20, backgroundColor: C.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  emptyTitle: { fontSize: 17, fontWeight: '800', color: C.ink },
  emptySub: { fontSize: 14, color: C.muted, textAlign: 'center', marginTop: 6 },
});