import React, { useCallback, useState } from 'react';
import { FlatList, Text, View, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase, PAGE_SIZE } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import { Btn, Card, Muted, Pager } from '../../components/ui';

export default function HostInquiries() {
  const { session, formatMoney } = useAuth(); const [rows, setRows] = useState([]); const [page, setPage] = useState(0); const [more, setMore] = useState(false);
  const load = useCallback(async () => {
    const { data: mine } = await supabase.from('listings').select('id').eq('owner_id', session.user.id);
    const { data } = await supabase.from('inquiries').select('*, listings(title)').in('listing_id', (mine || []).map((x) => x.id)).order('urgent', { ascending: false }).order('created_at', { ascending: false }).range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
    setMore((data || []).length > PAGE_SIZE); setRows((data || []).slice(0, PAGE_SIZE));
  }, [page]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const answer = async (id, ok) => { const { error } = await supabase.rpc('respond_inquiry', { p_id: id, p_accept: ok }); if (error) Alert.alert('Error', error.message); load(); };
  return (
    <FlatList data={rows} keyExtractor={(i) => i.id} ListEmptyComponent={<Muted style={{ textAlign: 'center', margin: 30 }}>No inquiries.</Muted>} ListFooterComponent={<Pager page={page} setPage={setPage} hasMore={more} />}
      renderItem={({ item: i }) => (
        <Card><Text style={{ fontWeight: '700' }}>{i.listings?.title}{i.urgent ? ' 🔴 URGENT' : ''}</Text>
          <Muted>{i.kind.replace('_', ' ')} · {i.visit_date} {i.visit_time?.slice(0, 5)} · {i.guests} guests{i.offered_price ? ` · offer ${formatMoney(i.offered_price)}` : ''}</Muted>
          {i.note ? <Text>“{i.note}”</Text> : null}<Text>Status: {i.status}</Text>
          {i.status === 'pending' && <View style={{ flexDirection: 'row' }}><Btn style={{ flex: 1, margin: 2 }} title="Accept" onPress={() => answer(i.id, true)} /><Btn style={{ flex: 1, margin: 2 }} kind="danger" title="Decline" onPress={() => answer(i.id, false)} /></View>}
        </Card>)} />
  );
}
