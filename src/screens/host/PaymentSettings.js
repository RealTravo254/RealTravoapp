import React, { useEffect, useState } from 'react';
import { ScrollView, Alert, Text, View } from 'react-native';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import { Btn, Input, Label, Muted, Card, Chip } from '../../components/ui';
import CountryPicker from '../../components/CountryPicker';

// Where the platform sends your earnings. Methods per country are set by the admin.
export default function PaymentSettings() {
  const { session, profile } = useAuth();
  const [methods, setMethods] = useState([]); const [accounts, setAccounts] = useState([]); const [country, setCountry] = useState(profile?.country || '');
  const [m, setM] = useState(null); const [a, setA] = useState({ account_name: '', account_number: '', paypal_email: '', mobile_number: '' });
  const loadAcc = () => supabase.from('provider_payout_accounts').select('*, payment_methods(name,type,swift_code,bank_code)').eq('user_id', session.user.id).then(({ data }) => setAccounts(data || []));
  useEffect(() => { supabase.from('payment_methods').select('*').eq('active', true).order('name').then(({ data }) => setMethods(data || [])); loadAcc(); }, []);
  const shown = methods.filter((x) => x.country === '*' || x.country.toLowerCase() === country.trim().toLowerCase());
  const add = async () => {
    if (!m || !a.account_name) return Alert.alert('Choose a method and enter the account name');
    const { error } = await supabase.from('provider_payout_accounts').insert({ ...a, user_id: session.user.id, payment_method_id: m.id, is_default: accounts.length === 0 });
    if (error) Alert.alert('Error', error.message); else { setM(null); setA({ account_name: '', account_number: '', paypal_email: '', mobile_number: '' }); loadAcc(); }
  };
  return (
    <ScrollView contentContainerStyle={{ padding: 12 }} keyboardShouldPersistTaps="handled">
      <Muted>The platform pays your remaining balance to the account you add here.</Muted>
      <Label>Country</Label><CountryPicker value={country} onChange={(v) => { setCountry(v); setM(null); }} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{shown.map((x) => <View key={x.id} style={{ marginBottom: 6 }}><Chip label={x.name} active={m?.id === x.id} onPress={() => setM(x)} /></View>)}</View>
      {m && <><Muted>{m.type}{m.swift_code ? ` · SWIFT ${m.swift_code}` : ''}{m.bank_code ? ` · code ${m.bank_code}` : ''}{m.instructions ? ` · ${m.instructions}` : ''}</Muted>
        <Input placeholder="Account holder name" value={a.account_name} onChangeText={(v) => setA({ ...a, account_name: v })} />
        {m.type === 'paypal' ? <Input placeholder="PayPal email" autoCapitalize="none" value={a.paypal_email} onChangeText={(v) => setA({ ...a, paypal_email: v })} />
          : m.type === 'mobile_money' ? <Input placeholder="Mobile number" keyboardType="phone-pad" value={a.mobile_number} onChangeText={(v) => setA({ ...a, mobile_number: v })} />
          : <Input placeholder="Account number / IBAN" value={a.account_number} onChangeText={(v) => setA({ ...a, account_number: v })} />}
        <Btn title="Add payout account" onPress={add} /></>}
      {accounts.map((x) => <Card key={x.id} style={{ marginHorizontal: 0 }}><Text style={{ fontWeight: '700' }}>{x.payment_methods?.name}{x.is_default ? ' · default' : ''}</Text><Muted>{x.account_name} · {x.account_number || x.paypal_email || x.mobile_number}</Muted>
        <Btn kind="danger" title="Remove" onPress={async () => { await supabase.from('provider_payout_accounts').delete().eq('id', x.id); loadAcc(); }} /></Card>)}
    </ScrollView>
  );
}
