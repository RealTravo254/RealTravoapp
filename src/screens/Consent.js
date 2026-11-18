import React, { useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { Btn, Muted } from '../components/ui';
import { C } from '../lib/theme';

// Shown when a signed-in user has not yet confirmed the current Terms / Privacy (first login or after the admin publishes a new version).
export default function Consent({ navigation }) {
  const { pendingLegal, acceptLegal } = useAuth(); const [ok, setOk] = useState(false); const [busy, setBusy] = useState(false);
  const go = async () => { if (!ok) return Alert.alert('Please confirm', 'Tick the box to continue.'); setBusy(true); try { await acceptLegal(); } catch (e) { Alert.alert('Error', e.message); } setBusy(false); };
  return (
    <ScrollView contentContainerStyle={{ padding: 22 }}>
      <Text style={{ fontSize: 24, fontWeight: '800', color: C.text }}>Before you continue</Text>
      <Muted style={{ marginVertical: 8 }}>Please read and confirm our latest documents.</Muted>
      {pendingLegal.map((d) => (
        <TouchableOpacity key={d.kind} onPress={() => navigation.navigate('Legal', { kind: d.kind })} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 14, marginVertical: 5 }}>
          <Ionicons name={d.kind === 'terms' ? 'document-text-outline' : 'shield-checkmark-outline'} size={22} color={C.primary} />
          <Text style={{ flex: 1, marginLeft: 12, fontWeight: '700' }}>{d.title}</Text><Ionicons name="open-outline" size={18} color={C.muted} />
        </TouchableOpacity>))}
      <TouchableOpacity onPress={() => setOk(!ok)} style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 16 }}>
        <Ionicons name={ok ? 'checkbox' : 'square-outline'} size={26} color={C.primary} /><Text style={{ flex: 1, marginLeft: 10 }}>I have read and agree to the {pendingLegal.map((d) => d.title).join(' and ')}.</Text>
      </TouchableOpacity>
      <Btn title="Accept and continue" onPress={go} disabled={busy} />
      <Btn kind="ghost" title="Decline and sign out" onPress={() => supabase.auth.signOut()} />
    </ScrollView>
  );
}
