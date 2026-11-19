import React, { useEffect, useState } from 'react';
import { ScrollView, Alert, View, Text } from 'react-native';
import DateField from '../components/DateField';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { Btn, Input, Label, Chip, Muted, Card } from '../components/ui';
import CountryPicker from '../components/CountryPicker';
import PhoneField from '../components/PhoneField';
import { ymd } from '../lib/pricing';

export default function EditProfile({ navigation }) {
  const { session, profile, refresh, isProvider } = useAuth();
  const [f, setF] = useState({ first_name: profile?.first_name || '', last_name: profile?.last_name || '', gender: profile?.gender || '', country: profile?.country || '', phone: profile?.phone || '' });
  const [dob, setDob] = useState(profile?.date_of_birth ? new Date(profile.date_of_birth + 'T12:00:00') : new Date(2000, 0, 1));
  const [pw, setPw] = useState('');
  const [verStatus, setVerStatus] = useState(null); // host_verifications.status (null = never applied)

  useEffect(() => {
    supabase.from('host_verifications').select('status').eq('user_id', session.user.id).maybeSingle().then(({ data }) => setVerStatus(data?.status || null));
  }, [session.user.id]);

  // The country is locked once the user has applied to host (pending or approved) or already is a host.
  // A rejected application can still change it.
  const countryLocked = !!isProvider || (!!verStatus && verStatus !== 'rejected');
  const lockedCountry = profile?.country || f.country;

  const save = async () => {
    if ((Date.now() - dob.getTime()) / 31557600000 < 16) return Alert.alert('Sorry', 'You must be 16 or older.');
    if (!f.first_name.trim() || !f.last_name.trim()) return Alert.alert('First name and last name are required');
    const country = countryLocked ? lockedCountry : f.country;
    const { error } = await supabase.from('profiles').update({ ...f, country, first_name: f.first_name.trim(), last_name: f.last_name.trim(), phone: f.phone || null, date_of_birth: ymd(dob) }).eq('id', session.user.id);
    if (error) Alert.alert('Error', error.message); else { await refresh(); Alert.alert('Saved'); navigation.goBack(); }
  };
  const changePw = async () => {
    if (pw.length < 6) return Alert.alert('Password', 'Use at least 6 characters.');
    const { error } = await supabase.auth.updateUser({ password: pw }); if (error) Alert.alert('Error', error.message); else { setPw(''); Alert.alert('Password updated'); }
  };
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <Label>First name</Label><Input value={f.first_name} onChangeText={(v) => setF({ ...f, first_name: v })} />
      <Label>Last name</Label><Input value={f.last_name} onChangeText={(v) => setF({ ...f, last_name: v })} />
      <Label>Gender</Label>
      <View style={{ flexDirection: 'row' }}>{['Male', 'Female', 'Other'].map((g) => <Chip key={g} label={g} active={f.gender === g} onPress={() => setF({ ...f, gender: g })} />)}</View>
      <Label>Country</Label>
      {countryLocked
        ? <><Input value={lockedCountry} editable={false} /><Muted>🔒 Your country is locked because you are a host. Everything you host must be in this country.</Muted></>
        : <CountryPicker value={f.country} onChange={(v) => setF({ ...f, country: v })} />}
      <Label>Phone / WhatsApp (optional)</Label><PhoneField country={countryLocked ? lockedCountry : f.country} value={f.phone} onChange={(v) => setF((x) => ({ ...x, phone: v }))} />
      <Label>Date of birth</Label><DateField value={dob} maximumDate={new Date()} onChange={setDob} />

      <Label>Email</Label><Muted>{session.user.email}</Muted>
      <Btn title="Save changes" onPress={save} />
      <Card style={{ marginHorizontal: 0, marginTop: 16 }}><Text style={{ fontWeight: '800' }}>Change password</Text>
        <Input secureTextEntry placeholder="New password" value={pw} onChangeText={setPw} /><Btn kind="ghost" title="Update password" onPress={changePw} /></Card>
    </ScrollView>
  );
}