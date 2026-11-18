import React, { useState } from 'react';
import { ScrollView, Alert, View } from 'react-native';
import DateField from '../components/DateField';
import { ymd } from '../lib/pricing';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { Btn, Input, Label, Chip, Muted } from '../components/ui';
import CountryPicker from '../components/CountryPicker';
import PhoneField from '../components/PhoneField';

export default function CompleteProfile({ navigation }) {
  const { session, profile, refresh } = useAuth();
  const [f, setF] = useState({ first_name: profile?.first_name || '', last_name: profile?.last_name || '', gender: profile?.gender || '', country: profile?.country || '', phone: profile?.phone || '' });
  const [dob, setDob] = useState(new Date(2000, 0, 1));
  const save = async () => {
    const age = (Date.now() - dob.getTime()) / 31557600000;
    if (age < 16) return Alert.alert('Sorry', 'You must be 16 or older to use this app.');
    if (!f.first_name || !f.last_name || !f.gender || !f.country) return Alert.alert('Please fill first name, second name, gender and country');
    const { error } = await supabase.from('profiles').update({ ...f, phone: f.phone || null, date_of_birth: ymd(dob) }).eq('id', session.user.id);
    if (error) Alert.alert('Error', error.message); else { await refresh(); navigation.goBack(); }
  };
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <Muted>Complete your profile to start booking.</Muted>
      <Label>First name</Label><Input value={f.first_name} onChangeText={(v) => setF({ ...f, first_name: v })} />
      <Label>Second name</Label><Input value={f.last_name} onChangeText={(v) => setF({ ...f, last_name: v })} />
      <Label>Gender</Label>
      <View style={{ flexDirection: 'row' }}>{['Male', 'Female', 'Other'].map((g) => <Chip key={g} label={g} active={f.gender === g} onPress={() => setF({ ...f, gender: g })} />)}</View>
      <Label>Country</Label><CountryPicker value={f.country} onChange={(v) => setF({ ...f, country: v })} />
      <Label>Phone / WhatsApp (optional)</Label><PhoneField country={f.country} value={f.phone} onChange={(v) => setF((x) => ({ ...x, phone: v }))} />
      <Label>Date of birth (16+)</Label>
      <DateField value={dob} maximumDate={new Date()} onChange={setDob} />
      
      <Btn title="Save & continue" onPress={save} />
    </ScrollView>
  );
}
