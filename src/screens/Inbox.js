import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase, PAGE_SIZE } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import Img from '../components/Img';
import { Btn, Muted, Pager, Loader } from '../components/ui';
import { C } from '../lib/theme';

// Messages: every paid booking has a chat between the guest and the host
export default function Inbox({ navigation }) {
  const { session } = useAuth();
  const [rows, setRows] = useState([]); const [page, setPage] = useState(0); const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!session) return; setLoading(true);
    const uid = session.user.id; const sel = '*, listings(title,category,photos,owner_id)';
    const { data: mine } = await supabase.from('bookings').select(sel).eq('user_id', uid).eq('payment_status', 'paid').in('status', ['pending', 'accepted', 'completed']);
    const { data: own } = await supabase.from('listings').select('id').eq('owner_id', uid);
    const { data: hosted } = (own || []).length ? await supabase.from('bookings').select(sel).in('listing_id', own.map((x) => x.id)).eq('payment_status', 'paid').in('status', ['pending', 'accepted', 'completed']) : { data: [] };
    const all = [...(mine || []).map((b) => ({ ...b, role: 'guest' })), ...(hosted || []).filter((b) => b.user_id !== uid).map((b) => ({ ...b, role: 'host' }))];
    const ids = all.map((b) => b.id); const last = {};
    if (ids.length) { const { data: msgs } = await supabase.from('messages').select('booking_id,body,created_at,sender_id').in('booking_id', ids).order('created_at', { ascending: false }).limit(300); (msgs || []).forEach((m) => { if (!last[m.booking_id]) last[m.booking_id] = m; }); }
    all.forEach((b) => { b.last = last[b.id]; });
    all.sort((a, b) => new Date(b.last?.created_at || b.created_at) - new Date(a.last?.created_at || a.created_at));
    setRows(all); setLoading(false);
  }, [session]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!session) return <View style={{ flex: 1, justifyContent: 'center', padding: 28 }}><Muted style={{ textAlign: 'center', marginBottom: 12 }}>Sign in to see your messages.</Muted><Btn title="Log in" onPress={() => navigation.navigate('Auth', { reason: 'trips' })} /></View>;
  const shown = rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  return loading ? <Loader /> : (
    <FlatList data={shown} keyExtractor={(i) => i.id} ListEmptyComponent={<Muted style={{ textAlign: 'center', margin: 30 }}>No chats yet. A chat opens as soon as a booking is paid.</Muted>}
      ListFooterComponent={<Pager page={page} setPage={setPage} hasMore={rows.length > (page + 1) * PAGE_SIZE} />}
      renderItem={({ item: b }) => (
        <TouchableOpacity onPress={() => navigation.navigate('Chat', { bookingId: b.id, title: b.listings?.title })} style={{ flexDirection: 'row', alignItems: 'center', padding: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderColor: C.border }}>
          <Img uri={b.listings?.photos?.[0]} category={b.listings?.category} style={{ width: 56, height: 56, borderRadius: 12 }} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={{ fontWeight: '800', color: C.text }} numberOfLines={1}>{b.listings?.title}</Text>
            <Muted>{b.role === 'host' ? 'A guest booked your listing' : 'Chat with your host'} · {b.start_date}</Muted>
            <Text numberOfLines={1} style={{ color: b.last ? C.text : C.muted, marginTop: 2 }}>{b.last ? (b.last.sender_id === session.user.id ? 'You: ' : '') + b.last.body : 'Say hello 👋'}</Text>
          </View>
        </TouchableOpacity>)} />
  );
}
