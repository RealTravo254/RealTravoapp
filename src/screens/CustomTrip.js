import React, { useEffect, useState } from 'react';
import { ScrollView, Text, Image, Alert, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { Btn, Card, Input, Label, Muted, Chip, Pager, Stepper } from '../components/ui';

// Company / group trips (e.g. Masai Mara): choose admin destinations, people, days, activities, note and your offer.
export default function CustomTrip({ navigation }) {
  const { session } = useAuth();
  const [dest, setDest] = useState([]); const [chosen, setChosen] = useState([]); const [page, setPage] = useState(0);
  const [people, setPeople] = useState('2'); const [days, setDays] = useState('3'); const [acts, setActs] = useState([]);
  const [note, setNote] = useState(''); const [offer, setOffer] = useState(''); const [company, setCompany] = useState(false);
  useEffect(() => { supabase.from('destinations').select('*').eq('active', true).order('name').range(page * 8, page * 8 + 8).then(({ data }) => setDest(data || [])); }, [page]);
  const all = [...new Set(dest.filter(d => chosen.includes(d.id)).flatMap(d => d.activities))];
  const submit = async () => {
    if (!chosen.length) return Alert.alert('Pick at least one destination');
    const { error } = await supabase.from('custom_trip_requests').insert({ user_id: session.user.id, is_company: company, destination_ids: chosen, people: Number(people), days: Number(days), activities: acts, note, offered_price: offer ? Number(offer) : null });
    if (error) Alert.alert('Error', error.message); else { Alert.alert('Sent', 'The admin will accept, reject or counter your offer.'); navigation.goBack(); }
  };
  return (
    <ScrollView>
      <Label> </Label>
      {dest.slice(0, 8).map(d => (
        <Card key={d.id} onPress={() => setChosen(c => c.includes(d.id) ? c.filter(x => x !== d.id) : [...c, d.id])} style={{ borderWidth: 2, borderColor: chosen.includes(d.id) ? '#1B4432' : '#E5E7EB', padding: 0, overflow: 'hidden' }}>
          {d.image_url && <Image source={{ uri: d.image_url }} style={{ height: 120 }} />}
          <View style={{ padding: 10 }}><Text style={{ fontWeight: '700' }}>{d.name}</Text><Muted>{d.region}, {d.country}</Muted></View></Card>))}
      <Pager page={page} setPage={setPage} hasMore={dest.length > 8} />
      <View style={{ padding: 12 }}>
        <Chip label={company ? '🏢 Company trip' : '👤 Personal trip'} active={company} onPress={() => setCompany(!company)} />
        <Stepper label="People" value={Number(people) || 1} onChange={(n) => setPeople(String(n))} min={1} max={500} />
        <Stepper label="Days" value={Number(days) || 1} onChange={(n) => setDays(String(n))} min={1} max={60} />
        {all.length > 0 && <><Label>Activities</Label><View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{all.map(a => <View key={a} style={{ marginBottom: 6 }}><Chip label={a} active={acts.includes(a)} onPress={() => setActs(x => x.includes(a) ? x.filter(y => y !== a) : [...x, a])} /></View>)}</View></>}
        <Label>Note</Label><Input multiline value={note} onChangeText={setNote} />
        <Label>Your offer (USD, optional)</Label><Input keyboardType="decimal-pad" value={offer} onChangeText={setOffer} />
        <Btn title="Send request to admin" onPress={submit} />
      </View>
    </ScrollView>
  );
}
