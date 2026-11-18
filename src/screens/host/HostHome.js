import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase, PAGE_SIZE } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import { Btn, Card, H, Muted, Pager } from '../../components/ui';
import { startPayment } from '../../lib/payments';
import ScreenHeader from '../../components/ScreenHeader';

export default function HostHome({ navigation }) {
  const { session } = useAuth();
  const [rows, setRows] = useState([]); const [page, setPage] = useState(0); const [more, setMore] = useState(false); const [providers, setProviders] = useState([]);
  const load = useCallback(async () => {
    const { data } = await supabase.from('listings').select('*').eq('owner_id', session.user.id).is('deleted_at', null).order('created_at', { ascending: false }).range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
    setMore((data || []).length > PAGE_SIZE); setRows((data || []).slice(0, PAGE_SIZE));
    const p = await supabase.from('providers').select('*').eq('user_id', session.user.id); setProviders(p.data || []);
  }, [page]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const toggle = async (l) => { const { error } = await supabase.rpc('set_listing_visibility', { p_listing: l.id, p_visible: l.status !== 'approved' }); if (error) Alert.alert('Error', error.message); load(); };
  const del = (l) => Alert.alert('Delete listing?', '', [{ text: 'No' }, { text: 'Delete', style: 'destructive', onPress: async () => { await supabase.from('listings').update({ deleted_at: new Date().toISOString(), status: 'hidden' }).eq('id', l.id); load(); } }]);
  const promote = async (l) => { try { const p = await startPayment({ purpose: 'prioritization', amount: 15, listingId: l.id }); navigation.navigate('Pay', { url: p.authorization_url }); } catch (e) { Alert.alert('Error', e.message); } };
  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title="Host dashboard" icon="business-outline" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 8 }}>
        <Btn style={{ margin: 4 }} title="＋ New listing" onPress={() => navigation.navigate('ListingForm', { providers })} />
        <Btn style={{ margin: 4 }} kind="ghost" title="Bookings" onPress={() => navigation.navigate('HostBookings')} />
        <Btn style={{ margin: 4 }} kind="ghost" title="Scan QR" onPress={() => navigation.navigate('ScanQR')} />
        <Btn style={{ margin: 4 }} kind="ghost" title="Analytics" onPress={() => navigation.navigate('Analytics')} />
        <Btn style={{ margin: 4 }} kind="ghost" title="Booking forms" onPress={() => navigation.navigate('BookingForms')} />
      </View>
      <FlatList data={rows} keyExtractor={(i) => i.id} ListFooterComponent={<Pager page={page} setPage={setPage} hasMore={more} />}
        renderItem={({ item: l }) => (
          <Card><Text style={{ fontWeight: '700' }}>{l.title}</Text>
            <Muted>{l.category} · {l.status}{l.is_prioritized ? ' · ⭐ promoted' : ''}</Muted>
            {l.status === 'rejected' && <Text style={{ color: '#D64545' }}>Admin note: {l.admin_note}</Text>}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              <Btn style={{ margin: 2 }} kind="ghost" title="Edit" onPress={() => navigation.navigate('ListingForm', { listing: l, providers })} />
              {['approved', 'hidden'].includes(l.status) && <Btn style={{ margin: 2 }} kind="ghost" title={l.status === 'approved' ? 'Hide' : 'Show'} onPress={() => toggle(l)} />}
              {l.status === 'approved' && <Btn style={{ margin: 2 }} kind="ghost" title="Promote" onPress={() => promote(l)} />}
              <Btn style={{ margin: 2 }} kind="danger" title="Delete" onPress={() => del(l)} /></View></Card>)} />
    </View>
  );
}
