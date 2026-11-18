import React, { useState } from 'react';
import { ScrollView, View, Alert, Switch, Text } from 'react-native';
import DateField from '../components/DateField';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { Btn, Input, Label, Chip, Muted, Stepper } from '../components/ui';
import TimeField from '../components/TimeField';
import { ymd } from '../lib/pricing';

const KINDS = [['availability', 'Availability'], ['closed_hours', 'Outside opening hours'], ['special_package', 'Special package'], ['special_pricing', 'Special price']];
export default function Inquiry({ navigation, route }) {
  const { listing } = route.params; const { session } = useAuth();
  const [kind, setKind] = useState('availability'); const [date, setDate] = useState(new Date()); const [time, setTime] = useState('10:00');
  const [guests, setGuests] = useState('1'); const [urgent, setUrgent] = useState(false); const [offer, setOffer] = useState(''); const [note, setNote] = useState('');
  const send = async () => {
    const { error } = await supabase.from('inquiries').insert({ listing_id: listing.id, guest_id: session.user.id, kind, visit_date: ymd(date), visit_time: time + ':00', guests: Number(guests) || 1, urgent, offered_price: offer ? Number(offer) : null, note: note || null });
    if (error) Alert.alert('Error', error.message); else { Alert.alert('Sent', `The host replies within ${urgent ? 6 : 12} hours. You will get a notification.`); navigation.goBack(); }
  };
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <Muted>Ask {listing.title}</Muted>
      <Label>What do you want to ask?</Label><View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{KINDS.map(([k, l]) => <View key={k} style={{ marginBottom: 6 }}><Chip label={l} active={kind === k} onPress={() => setKind(k)} /></View>)}</View>
      <Label>Date and time</Label>
      <View style={{ flexDirection: 'row' }}><DateField style={{ flex: 1, marginRight: 8 }} value={date} minimumDate={new Date()} onChange={setDate} /><TimeField value={time} onChange={setTime} /></View>
      
      <Stepper label="Guests" value={Number(guests) || 1} onChange={(n) => setGuests(String(n))} min={1} max={500} />
      {(kind === 'special_pricing' || kind === 'special_package') && <><Label>Your offered price (USD, optional)</Label><Input keyboardType="decimal-pad" value={offer} onChangeText={setOffer} /></>}
      <Label>Note (max 200 characters)</Label><Input multiline maxLength={200} value={note} onChangeText={setNote} />
      <View style={{ flexDirection: 'row', alignItems: 'center' }}><Text style={{ flex: 1 }}>Urgent (reply within 6 hours)</Text><Switch value={urgent} onValueChange={setUrgent} /></View>
      <Btn title="Send inquiry" onPress={send} />
    </ScrollView>
  );
}
