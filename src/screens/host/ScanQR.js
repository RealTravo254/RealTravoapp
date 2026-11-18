import React, { useState } from 'react';
import { View, Text, Alert, ScrollView } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { supabase } from '../../lib/supabase';
import { Btn, Card, Muted } from '../../components/ui';

export default function ScanQR() {
  const [perm, req] = useCameraPermissions(); const [res, setRes] = useState(null); const [busy, setBusy] = useState(false);
  if (!perm) return null;
  if (!perm.granted) return <View style={{ padding: 20 }}><Btn title="Allow camera" onPress={req} /></View>;
  const onScan = async ({ data }) => {
    if (busy) return; setBusy(true);
    const { data: r, error } = await supabase.rpc('scan_qr', { p_token: data });
    if (error) Alert.alert('Invalid', error.message); else setRes(r);
    setTimeout(() => setBusy(false), 1500);
  };
  return (
    <View style={{ flex: 1 }}>
      {!res ? <CameraView style={{ flex: 1 }} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={onScan} /> :
        <ScrollView><Card><Text style={{ fontSize: 18, fontWeight: '800' }}>✅ {res.guest?.first_name} {res.guest?.last_name} ({res.guest?.country})</Text>
          <Muted>{res.booking.start_date} → {res.booking.end_date} · {res.booking.guests} guests · {res.booking.status} · {res.booking.payment_status}</Muted>
          {res.items.map((i, k) => <Text key={k}>• {i.label} × {i.quantity}</Text>)}
          <Text>Total: ${Number(res.booking.total).toFixed(2)}</Text><Btn title="Scan next" onPress={() => setRes(null)} /></Card></ScrollView>}
    </View>
  );
}
