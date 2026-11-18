import React, { useState } from 'react';
import { ScrollView, Alert, Text } from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { Btn, Input, Label, Muted } from '../components/ui';

// Change email: a 6-digit code is sent to the NEW address; typing it confirms the change.
// (Supabase > Auth > Email templates > "Change email address" must include {{ .Token }} so the email shows the code.)
export default function ChangeEmail({ navigation }) {
  const { session, refresh } = useAuth();
  const [email, setEmail] = useState(''); const [code, setCode] = useState(''); const [sent, setSent] = useState(false); const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return Alert.alert('Enter a valid email');
    if (email.trim().toLowerCase() === (session.user.email || '').toLowerCase()) return Alert.alert('That is already your email');
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ email: email.trim() });
    setBusy(false);
    if (error) return Alert.alert('Error', error.message);
    setSent(true); Alert.alert('Code sent', `We sent a code to ${email.trim()}.`);
  };
  const verify = async () => {
    if (code.trim().length < 6) return Alert.alert('Enter the 6-digit code');
    setBusy(true);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email_change' });
    if (error) { setBusy(false); return Alert.alert('Wrong or expired code', error.message); }
    await supabase.auth.refreshSession(); await refresh(); setBusy(false);
    Alert.alert('Email changed', `Your email is now ${email.trim()}.`); navigation.goBack();
  };
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      <Muted>Current email: {session.user.email}</Muted>
      <Label>New email</Label><Input autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} editable={!sent} />
      {!sent ? <Btn title="Send code to the new email" onPress={send} disabled={busy} /> : (<>
        <Label>6-digit code</Label><Input keyboardType="number-pad" maxLength={8} value={code} onChangeText={setCode} placeholder="123456" />
        <Btn title="Confirm new email" onPress={verify} disabled={busy} />
        <Btn kind="ghost" title="Send the code again" onPress={send} disabled={busy} />
        <Text style={{ color: '#6B7280', marginTop: 8 }}>If your old email also receives a code or link, confirm it too.</Text>
      </>)}
    </ScrollView>
  );
}
