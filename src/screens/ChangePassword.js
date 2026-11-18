import React, { useState } from 'react';
import { ScrollView, Alert, Text } from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { Btn, Input, Label, Muted } from '../components/ui';

export default function ChangePassword({ navigation }) {
  const { session } = useAuth();
  const [cur, setCur] = useState(''); const [pw, setPw] = useState(''); const [pw2, setPw2] = useState(''); const [busy, setBusy] = useState(false);
  const hasPassword = (session.user.app_metadata?.provider || 'email') === 'email'; // Google-only accounts have no current password
  const save = async () => {
    if (pw.length < 6) return Alert.alert('Password', 'Use at least 6 characters.');
    if (pw !== pw2) return Alert.alert('Password', 'The two new passwords do not match.');
    setBusy(true);
    try {
      if (hasPassword) {
        const { error: e1 } = await supabase.auth.signInWithPassword({ email: session.user.email, password: cur });
        if (e1) { setBusy(false); return Alert.alert('Current password is wrong'); }
      }
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) Alert.alert('Error', error.message); else { Alert.alert('Password changed'); navigation.goBack(); }
    } catch (e) { Alert.alert('Error', e.message); }
    setBusy(false);
  };
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
      {hasPassword ? <><Label>Current password</Label><Input secureTextEntry value={cur} onChangeText={setCur} /></> : <Muted>You signed in with Google. Set a password to also log in with your email.</Muted>}
      <Label>New password</Label><Input secureTextEntry value={pw} onChangeText={setPw} />
      <Label>Confirm new password</Label><Input secureTextEntry value={pw2} onChangeText={setPw2} />
      <Btn title="Change password" onPress={save} disabled={busy} />
    </ScrollView>
  );
}
