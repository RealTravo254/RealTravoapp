import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase, PAGE_SIZE } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import { Btn, Card, Muted, Pager } from '../../components/ui';

export default function HostBookings({ navigation }) {
  const { session } = useAuth();
  const [rows, setRows] = useState([]); const [page, setPage] = useState(0); const [more, setMore] = useState(false);
  const load = useCallback(async () => {
    const { data: mine } = await supabase.from('listings').select('id').eq('owner_id', session.user.id);
    const { data } = await supabase.from('bookings').select('*, listings(title), booking_items(*)').in('listing_id', (mine || []).map(x => x.id)).in('payment_status', ['paid', 'refunded'])
      .order('urgent', { ascending: false }).order('created_at', { ascending: false }).range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
    setMore((data || []).length > PAGE_SIZE); setRows((data || []).slice(0, PAGE_SIZE));
  }, [page]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const cancelReq = async (id, reason) => { const { error } = await supabase.rpc('host_request_cancel', { p_booking: id, p_reason: reason }); if (error) Alert.alert('Error', error.message); else { Alert.alert('Request sent', 'The guest was notified and can approve a refund.'); load(); } };
  const askCancel = (id) => Alert.alert('Request cancellation', 'Why? The guest must approve and is refunded.', [
    { text: 'Cannot host that day', onPress: () => cancelReq(id, 'The host cannot host on that day') }, { text: 'Place closed', onPress: () => cancelReq(id, 'The place is closed') }, { text: 'Other reason', onPress: () => cancelReq(id, 'Other reason - the host will explain in chat') }]);
  const respond = async (id, accept) => { const { error } = await supabase.rpc('respond_booking', { p_booking: id, p_accept: accept, p_reason: accept ? null : 'Declined by host' }); if (error) Alert.alert('Error', error.message); load(); };
  return (
    <FlatList data={rows} keyExtractor={(i) => i.id} ListFooterComponent={<Pager page={page} setPage={setPage} hasMore={more} />}
      renderItem={({ item: b }) => (
        <Card><Text style={{ fontWeight: '700' }}>{b.listings?.title}{b.urgent ? ' 🔴 URGENT' : ''}</Text>
          <Muted>{b.start_date} → {b.end_date} · {b.guests} guests · ${Number(b.total).toFixed(2)} · {b.payment_status}</Muted>
          {(b.booking_items || []).map(i => <Muted key={i.id}>• {i.label} × {i.quantity}</Muted>)}
          {b.note ? <Text>“{b.note}”</Text> : null}{b.start_time ? <Muted>🕒 {b.start_time.slice(0, 5)}</Muted> : null}{b.meeting_point ? <Text>📍 Pickup: {b.meeting_point}{b.pickup_time ? ` at ${b.pickup_time.slice(0, 5)}` : ''}</Text> : null}
          <Text>Status: {b.status}</Text>
          {b.status === 'pending' && <View style={{ flexDirection: 'row' }}><Btn style={{ flex: 1, margin: 2 }} title="Accept" onPress={() => respond(b.id, true)} /><Btn style={{ flex: 1, margin: 2 }} kind="danger" title="Decline" onPress={() => respond(b.id, false)} /></View>}
          {['pending', 'accepted', 'completed'].includes(b.status) && <Btn kind="ghost" title="💬 Chat" onPress={() => navigation.navigate('Chat', { bookingId: b.id, title: b.listings?.title })} />}
          {b.cancel_requested && <Text style={{ color: '#D64545', fontWeight: '700' }}>Cancellation requested — waiting for the guest</Text>}
          {['pending', 'accepted'].includes(b.status) && !b.cancel_requested && <Btn kind="ghost" title="Request cancellation" onPress={() => askCancel(b.id)} />}
        </Card>)} />
  );
}
