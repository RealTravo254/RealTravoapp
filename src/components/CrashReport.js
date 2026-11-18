import React, { useEffect, useState } from 'react';
import { Modal, View, Text, ScrollView, TouchableOpacity, Share } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// If the app crashed last time, show the reason so it can be sent for fixing.
export default function CrashReport() {
  const [msg, setMsg] = useState(null);
  useEffect(() => { AsyncStorage.getItem('last_crash').then((v) => v && setMsg(v)).catch(() => {}); }, []);
  if (!msg) return null;
  const close = () => { AsyncStorage.removeItem('last_crash').catch(() => {}); setMsg(null); };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 20 }}>
        <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 18, maxHeight: '80%' }}>
          <Text style={{ fontSize: 18, fontWeight: '800', color: '#1B1F24' }}>The app closed unexpectedly last time</Text>
          <ScrollView style={{ marginVertical: 10, backgroundColor: '#F7F8FA', borderRadius: 10, padding: 10 }}><Text selectable style={{ color: '#D64545', fontSize: 12 }}>{msg}</Text></ScrollView>
          <TouchableOpacity onPress={() => Share.share({ message: msg }).catch(() => {})} style={{ backgroundColor: '#1B4432', borderRadius: 10, padding: 12, alignItems: 'center' }}><Text style={{ color: '#fff', fontWeight: '800' }}>Share this error</Text></TouchableOpacity>
          <TouchableOpacity onPress={close} style={{ padding: 12, alignItems: 'center' }}><Text style={{ color: '#6B7280', fontWeight: '700' }}>Close</Text></TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
