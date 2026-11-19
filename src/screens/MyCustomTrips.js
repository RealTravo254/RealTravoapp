import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, View, Alert } from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { Btn, Card, Muted, Loader } from '../components/ui';
import { C } from '../lib/theme';

export default function MyCustomTrips({ navigation }) {
  const { session, formatMoney } = useAuth();
  const [rows, setRows] = useState(null); const [pct, setPct] = useState(20);
  const load = useCallback(async () => {
    const { data } = await supabase.from('trip_packages').select('*, bookings(id,start_date,start_time,nights,status,payment_status,total,cancel_fee,refund_due,listings(title,category))')
      .eq('user_id', session.user.id).eq('is_custom', true).order('created_at', { ascending: false });
    setRows(data || []);
    const { data: s } = await supabase.from('app_settings').select('custom_cancel_fee_percent').eq('id', 1).maybeSingle(); if (s) setPct(Number(s.custom_cancel_fee_percent ?? 20));
  }, []);
  useEffect(() => { const u = navigation.addListener('focus', load); load(); return u; }, [load]);

  const cancel = (b) => {
    const fee = Math.round(Number(b.total) * pct) / 100;
    Alert.alert('Cancel this item?', `${b.listings?.title}\nCancellation fee: ${formatMoney(fee)} (${pct}%)${b.payment_status === 'paid' ? `\nYou get back: ${formatMoney(Number(b.total) - fee)}` : ''}\n\nOther items in your trip stay booked.`, [
      { text: 'Keep it' },
      { text: 'Cancel item', style: 'destructive', onPress: async () => { const { error } = await supabase.rpc('cancel_package_item', { p_booking: b.id }); if (error) Alert.alert('Could not cancel', error.message); else load(); } }]);
  };

  if (rows === null) return <Loader />;
  return (
    <ScrollView style={{ backgroundColor: '#F6F7F5' }} contentContainerStyle={{ padding: 12 }}>
      {rows.length === 0 && <Muted style={{ textAlign: 'center', margin: 30 }}>No custom trips yet.</Muted>}
      {rows.map((p) => {
        const bs = [...(p.bookings || [])].sort((a, b) => (a.start_date + (a.start_time || '')).localeCompare(b.start_date + (b.start_time || '')));
        return (
          <Card key={p.id} style={{ marginHorizontal: 0, padding: 14 }}>
            <Text style={{ fontWeight: '800', fontSize: 16 }}>🧳 {p.start_date} → {p.end_date}</Text>
            <Muted>{p.people} people · Total {formatMoney(p.total)}</Muted>
            {p.trip_type && <Muted>🚐 {p.trip_type === 'round' ? 'Pickup & return' : 'Pickup'} · {p.pickup_location}</Muted>}
            <Muted style={{ marginTop: 4 }}>The whole trip cannot be cancelled. You can cancel single items (fee {pct}%).</Muted>
            {bs.map((b) => { const gone = b.status === 'cancelled'; const past = b.start_date <= new Date().toISOString().slice(0, 10); return (
              <View key={b.id} style={{ borderTopWidth: 1, borderTopColor: '#E5E7EB', marginTop: 10, paddingTop: 8, opacity: gone ? 0.55 : 1 }}>
                <Text style={{ fontWeight: '700', textDecorationLine: gone ? 'line-through' : 'none' }}>{b.listings?.title}</Text>
                <Muted>{b.start_date} {(b.start_time || '').slice(0, 5)} · {formatMoney(b.total)} · {b.payment_status}</Muted>
                {gone ? <Text style={{ color: C.danger }}>Cancelled · fee {formatMoney(b.cancel_fee)}{Number(b.refund_due) > 0 ? ` · refund due ${formatMoney(b.refund_due)}` : ''}</Text>
                  : !past && <Btn kind="danger" title={`Cancel this item (fee ${formatMoney(Number(b.total) * pct / 100)})`} onPress={() => cancel(b)} />}
              </View>); })}
          </Card>);
      })}
    </ScrollView>
  );
}