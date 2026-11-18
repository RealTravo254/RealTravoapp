import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, Text, Alert, ActivityIndicator, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { Btn, Card, Input, Label, Muted } from '../components/ui';
import { C } from '../lib/theme';

// Booking-form plans (hosts only). Prices are set by the admin; paid with an M-Pesa prompt.
const KIND = { per_form: 'Pay per form', monthly: 'Monthly', annual: 'Annual · unlimited' };
export default function Subscription({ navigation }) {
  const { isProvider, profile } = useAuth();
  const [plans, setPlans] = useState([]); const [subs, setSubs] = useState([]); const [phone, setPhone] = useState(''); const [busyPlan, setBusyPlan] = useState(null); const [waiting, setWaiting] = useState(false);
  const poll = useRef(null);
  const load = useCallback(async () => {
    const [{ data: p }, { data: s }] = await Promise.all([supabase.from('form_plans').select('*').eq('active', true).order('price_kes'), supabase.from('form_subscriptions').select('*').order('created_at', { ascending: false })]);
    setPlans(p || []); setSubs(s || []);
  }, []);
  useFocusEffect(useCallback(() => { load(); return () => clearInterval(poll.current); }, [load]));
  useEffect(() => { if (profile?.phone && !phone) setPhone(profile.phone.startsWith('+254') ? '0' + profile.phone.slice(4) : ''); }, [profile?.phone]);

  const active = subs.filter((s) => (!s.ends_at || new Date(s.ends_at) > new Date()) && (s.forms_limit == null || s.forms_used < s.forms_limit));
  const left = active.some((s) => s.forms_limit == null) ? 'Unlimited' : String(active.reduce((a, s) => a + (s.forms_limit - s.forms_used), 0));

  const buy = async (plan) => {
    if (!/^(\+?254|0)?[17]\d{8}$/.test(phone.replace(/\s/g, ''))) return Alert.alert('M-Pesa number', 'Enter a Safaricom number, e.g. 0712 345 678');
    setBusyPlan(plan.id);
    const { data, error } = await supabase.functions.invoke('mpesa-stk', { body: { phone, plan_id: plan.id } });
    if (error || data?.error) { setBusyPlan(null); return Alert.alert('M-Pesa', data?.error || error.message); }
    setWaiting(true); let tries = 0;
    poll.current = setInterval(async () => {
      tries++;
      const { data: p } = await supabase.from('payments').select('status').eq('reference', data.checkoutRequestId).maybeSingle();
      if (p?.status === 'success') { clearInterval(poll.current); setWaiting(false); setBusyPlan(null); await load(); Alert.alert('Plan active ✅', 'You can create booking forms now.', [{ text: 'Create a form', onPress: () => navigation.navigate('BookingForms') }, { text: 'Later' }]); }
      else if (p?.status === 'failed' || tries > 30) { clearInterval(poll.current); setWaiting(false); setBusyPlan(null); Alert.alert('Payment not completed', 'The M-Pesa payment was cancelled or timed out. You can try again.'); }
    }, 3000);
  };
  if (!isProvider) return <Muted style={{ margin: 24 }}>Booking form plans are for verified hosts only.</Muted>;
  return (
    <ScrollView keyboardShouldPersistTaps="handled">
      <Card><Text style={{ fontSize: 18, fontWeight: '800' }}>Booking forms</Text>
        <Muted>Send customers a booking form for a specific trip. Each form you create uses your plan.</Muted>
        <Text style={{ marginTop: 8, fontWeight: '800', color: C.primary }}>Forms you can still create: {left}</Text>
        <Btn kind="ghost" title="Open my booking forms" onPress={() => navigation.navigate('BookingForms')} /></Card>
      <Card>
        <Label>M-Pesa number for the prompt</Label><Input keyboardType="phone-pad" placeholder="0712 345 678" value={phone} onChangeText={setPhone} />
        {waiting && <View style={{ alignItems: 'center', padding: 10 }}><ActivityIndicator color={C.primary} /><Text style={{ marginTop: 8, fontWeight: '700', textAlign: 'center' }}>Check your phone and enter your M-Pesa PIN…</Text></View>}
      </Card>
      {plans.map((p) => (
        <Card key={p.id}>
          <Text style={{ fontWeight: '800', fontSize: 16 }}>{p.name}</Text>
          <Muted>{KIND[p.kind]}{p.kind === 'monthly' ? ` · up to ${p.form_limit} forms for 30 days` : p.kind === 'annual' ? ' · 365 days, no limit' : ' · 1 form'}</Muted>
          <Text style={{ fontSize: 22, fontWeight: '800', marginVertical: 6 }}>KES {Number(p.price_kes).toLocaleString()}</Text>
          <Btn title={busyPlan === p.id ? 'Waiting for M-Pesa…' : 'Pay with M-Pesa'} onPress={() => buy(p)} disabled={!!busyPlan} />
        </Card>))}
      {plans.length === 0 && <Muted style={{ textAlign: 'center', margin: 24 }}>The admin has not set any plans yet.</Muted>}
      <Muted style={{ margin: 12 }}>Booking payments from your customers use Paystack. Plans are paid with M-Pesa.</Muted>
    </ScrollView>
  );
}
