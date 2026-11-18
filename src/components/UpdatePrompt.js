import React, { useCallback, useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, Linking, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { C } from '../lib/theme';

// The admin announces a new version (Admin > Settings). The app compares it with its own version when it opens or comes back.
const current = Constants.expoConfig?.version || '1.0.0';
const cmp = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0 ? 1 : -1; } return 0; };
export default function UpdatePrompt() {
  const [info, setInfo] = useState(null); const [mode, setMode] = useState(null); // 'soft' | 'force'
  const check = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('app_settings').select('latest_version,min_version,update_url,update_message').eq('id', 1).single();
      if (error || !data) return;
      setInfo(data);
      if (data.min_version && cmp(current, data.min_version) < 0) return setMode('force');
      if (data.latest_version && cmp(current, data.latest_version) < 0) { const skipped = await AsyncStorage.getItem('update_skipped'); setMode(skipped === data.latest_version ? null : 'soft'); } else setMode(null);
    } catch (e) {}
  }, []);
  useEffect(() => { check(); const sub = AppState.addEventListener('change', (s) => { if (s === 'active') check(); }); return () => sub.remove(); }, [check]);
  if (!mode || !info) return null;
  const later = async () => { await AsyncStorage.setItem('update_skipped', info.latest_version || ''); setMode(null); };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => { if (mode === 'soft') later(); }}>
      <View style={{ flex: 1, backgroundColor: 'rgba(15,40,28,0.6)', justifyContent: 'center', padding: 24 }}>
        <View style={{ backgroundColor: '#fff', borderRadius: 24, padding: 22, alignItems: 'center' }}>
          <View style={{ width: 76, height: 76, borderRadius: 38, backgroundColor: '#E3EDE8', alignItems: 'center', justifyContent: 'center' }}><Ionicons name="cloud-download" size={38} color={C.primary} /></View>
          <Text style={{ fontSize: 21, fontWeight: '800', color: C.text, marginTop: 14 }}>{mode === 'force' ? 'Please update the app' : 'A new version is ready'}</Text>
          <Text style={{ color: C.muted, textAlign: 'center', marginTop: 6 }}>{info.update_message || 'We added improvements and fixes.'}</Text>
          <Text style={{ color: C.muted, marginTop: 8, fontSize: 12 }}>Your version {current} → new version {info.latest_version}</Text>
          <TouchableOpacity onPress={() => (info.update_url ? Linking.openURL(info.update_url) : null)} style={{ alignSelf: 'stretch', backgroundColor: C.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 16 }}><Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>Update now</Text></TouchableOpacity>
          {mode === 'soft' && <TouchableOpacity onPress={later} style={{ paddingVertical: 12 }}><Text style={{ color: C.muted, fontWeight: '700' }}>Later</Text></TouchableOpacity>}
        </View>
      </View>
    </Modal>
  );
}
