import React, { useCallback, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import { Btn, Card, H, Muted } from '../../components/ui';
import { C } from '../../lib/theme';

// Host analytics: sales, what the platform deducts, what is left for the host
const money = (n) => `$${Number(n || 0).toFixed(2)}`;
export default function Analytics({ navigation }) {
  const { session } = useAuth(); const [s, setS] = useState(null);
  const load = useCallback(async () => {
    const uid = session.user.id;
    const { data: sum } = await supabase.rpc('host_summary'); const t = (sum || [])[0] || {};
    const { data: l } = await supabase.from('listings').select('id,title,category,rating_avg,rating_count').eq('owner_id', uid).is('deleted_at', null);
    const { data: b } = await supabase.from('bookings').select('listing_id,status,payment_status,total,commission,created_at').in('listing_id', (l || []).map((x) => x.id));
    const { data: fees } = await supabase.from('category_fees').select('*');
    const paid = (b || []).filter((x) => x.payment_status === 'paid' && ['accepted', 'completed'].includes(x.status));
    const byL = (l || []).map((x) => ({ ...x, n: (b || []).filter((y) => y.listing_id === x.id).length, net: paid.filter((y) => y.listing_id === x.id).reduce((a, y) => a + Number(y.total) - Number(y.commission), 0),
      fee: (fees || []).find((f) => f.category === x.category)?.commission_percent }));
    setS({ t, total: (b || []).length, pending: (b || []).filter((x) => x.status === 'pending' && x.payment_status === 'paid').length, byL, cats: [...new Set((l || []).map((x) => x.category))].map((c) => ({ c, pct: (fees || []).find((f) => f.category === c)?.commission_percent })) });
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  if (!s) return null;
  const Stat = ({ k, v, color, big }) => <Card style={{ flex: 1 }}><Muted>{k}</Muted><Text style={{ fontSize: big ? 24 : 20, fontWeight: '800', color: color || C.text }}>{v}</Text></Card>;
  return (
    <ScrollView>
      <H>Your earnings</H>
      <Card style={{ backgroundColor: '#E3EDE8' }}><Muted>Remaining balance (to be paid to you)</Muted><Text style={{ fontSize: 30, fontWeight: '800', color: C.primary }}>{money(s.t.balance)}</Text></Card>
      <View style={{ flexDirection: 'row' }}><Stat k="Total sales" v={money(s.t.gross)} /><Stat k="Platform deduction" v={`− ${money(s.t.platform_fee)}`} color={C.danger} /></View>
      <View style={{ flexDirection: 'row' }}><Stat k="Your earnings" v={money(s.t.net)} /><Stat k="Already paid out" v={money(s.t.paid_out)} /></View>
      <Card><Text style={{ fontWeight: '800', marginBottom: 4 }}>Platform charge per category</Text>
        {s.cats.length === 0 ? <Muted>No listings yet.</Muted> : s.cats.map((x) => <Text key={x.c}>{x.c}: {x.pct}% of each booking</Text>)}</Card>
      <Btn kind="ghost" style={{ marginHorizontal: 12 }} title="Where to send my money (payout account)" onPress={() => navigation.navigate('PaymentSettings')} />
      <H>Bookings</H>
      <View style={{ flexDirection: 'row' }}><Stat k="All bookings" v={s.total} /><Stat k="Waiting for you" v={s.pending} /></View>
      {s.byL.map((x) => <Card key={x.id}><Text style={{ fontWeight: '700' }}>{x.title}</Text><Muted>{x.category} · {x.fee}% charge · {x.n} bookings · you earned {money(x.net)} · ⭐ {x.rating_avg} ({x.rating_count})</Muted></Card>)}
      <View style={{ height: 30 }} />
    </ScrollView>
  );
}
