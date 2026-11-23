import React, { useCallback, useState } from 'react';
import { ScrollView, Text, View, Alert, Share } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { supabase, PAGE_SIZE } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import { Btn, Card, Input, Label, Muted, Pager } from '../../components/ui';
import SelectField from '../../components/SelectField';
import { C } from '../../lib/theme';

// A booking form = a link for one listing at your price. Customers open it in the app and pay; you create forms with your plan.
export default function BookingForms({ navigation }) {
  const { session, formatMoney } = useAuth();
  const [listings, setListings] = useState([]); const [forms, setForms] = useState([]); const [subs, setSubs] = useState([]); const [page, setPage] = useState(0);
  const [lid, setLid] = useState(null); const [title, setTitle] = useState(''); const [price, setPrice] = useState('');
  const load = useCallback(async () => {
    const uid = session.user.id;
    const [{ data: l }, { data: f }, { data: s }] = await Promise.all([
      supabase.from('listings').select('id,title').eq('owner_id', uid).eq('status', 'approved').is('deleted_at', null),
      supabase.from('provider_booking_forms').select('*, listings(title)').eq('owner_id', uid).order('created_at', { ascending: false }),
      supabase.from('form_subscriptions').select('*')]);
    setListings(l || []); setForms(f || []); setSubs(s || []);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const active = subs.filter((s) => (!s.ends_at || new Date(s.ends_at) > new Date()) && (s.forms_limit == null || s.forms_used < s.forms_limit));
  const left = active.some((s) => s.forms_limit == null) ? 'Unlimited' : String(active.reduce((a, s) => a + (s.forms_limit - s.forms_used), 0));
  const canCreate = left === 'Unlimited' || Number(left) > 0;
  const link = (f) => `travelapp://form/${f.slug}`;
  const share = (f) => Share.share({ message: `Book "${f.title}" (${f.listings?.title}) on RealTravo for ${formatMoney(f.price)} per person.\nOpen the booking form: ${link(f)}` }).catch(() => {});
  const create = async () => {
    if (!lid || !title.trim() || !(Number(price) > 0)) return Alert.alert('Choose the listing, a title and a price per person');
    const { data, error } = await supabase.rpc('create_booking_form', { p_listing: lid, p_title: title.trim(), p_price: Number(price) });
    if (error) return Alert.alert(error.message.toLowerCase().includes('plan') ? 'Booking form plan required' : 'Could not create form',
      error.message.toLowerCase().includes('plan') ? 'Contact support to add a plan. In-app plan purchases are unavailable.' : error.message);
    setTitle(''); setPrice(''); await load();
    const created = { ...data, listings: { title: listings.find((x) => x.id === lid)?.title } };
    Alert.alert('Booking form ready', 'Customers can open this form and book the linked listing.', [
      { text: 'Open form', onPress: () => navigation.navigate('BookingForm', { slug: data.slug }) },
      { text: 'Share now', onPress: () => share(created) },
      { text: 'Later' },
    ]);
  };
  const shown = forms.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  return (
    <ScrollView keyboardShouldPersistTaps="handled">
      <Card><Text style={{ fontWeight: '800', fontSize: 16 }}>Forms you can still create: <Text style={{ color: C.primary }}>{left}</Text></Text>
        <Muted>{canCreate ? 'Plans are managed outside the app.' : 'A booking-form plan is required. Contact support to add one; in-app plan purchases are unavailable.'}</Muted></Card>
      <Card>
        <Text style={{ fontWeight: '800', marginBottom: 4 }}>New booking form</Text>
        <Label>Listing</Label><SelectField value={lid} options={listings.map((l) => ({ value: l.id, label: l.title }))} onChange={setLid} placeholder="Choose one of your live listings" title="Your listings" />
        <Label>Title (e.g. “Maasai Mara 3-day trip”)</Label><Input value={title} onChangeText={setTitle} />
        <Label>Price per person (USD)</Label><Input keyboardType="decimal-pad" value={price} onChangeText={setPrice} />
        <Btn title="Create booking form" onPress={create} disabled={!canCreate} />
      </Card>
      {shown.map((f) => (
        <Card key={f.id}>
          <Text style={{ fontWeight: '800' }}>{f.title}</Text><Muted>{f.listings?.title} · {formatMoney(f.price)} per person · {f.active ? 'active' : 'turned off'}</Muted>
          <Text selectable style={{ color: C.primary, marginTop: 4 }}>{link(f)}</Text>
          <View style={{ flexDirection: 'row' }}>
            <Btn style={{ flex: 1, margin: 2 }} kind="ghost" title="Open form" onPress={() => navigation.navigate('BookingForm', { slug: f.slug })} disabled={!f.active} />
            <Btn style={{ flex: 1, margin: 2 }} title="Share" onPress={() => share(f)} />
            <Btn style={{ flex: 1, margin: 2 }} kind="ghost" title={f.active ? 'Turn off' : 'Turn on'} onPress={async () => { await supabase.from('provider_booking_forms').update({ active: !f.active }).eq('id', f.id); load(); }} />
          </View>
        </Card>))}
      {forms.length === 0 && <Muted style={{ textAlign: 'center', margin: 24 }}>No booking forms yet.</Muted>}
      <Pager page={page} setPage={setPage} hasMore={forms.length > (page + 1) * PAGE_SIZE} />
      <View style={{ height: 30 }} />
    </ScrollView>
  );
}
