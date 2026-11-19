import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, Alert, ScrollView, FlatList, Animated, Easing, Linking, Vibration, AppState,
  TouchableOpacity, StyleSheet, useWindowDimensions, ActivityIndicator,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import { isNetworkError, markCheckinUsed, pendingCheckinCount, readCheckinCache, refreshCheckinCache, syncPendingCheckins } from '../../lib/offlineCheckins';
import { C } from '../../lib/theme';

const DIM = 'rgba(6, 18, 13, 0.72)';
const ACCENT = '#8FE0B5';

export default function ScanQR() {
  const { session, formatMoney } = useAuth();
  const [perm, requestPerm] = useCameraPermissions();
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [torch, setTorch] = useState(false);
  const [view, setView] = useState('camera');
  const [cachedBookings, setCachedBookings] = useState([]);
  const [pendingSync, setPendingSync] = useState(0);
  const [syncError, setSyncError] = useState('');
  const locked = useRef(false);
  const syncing = useRef(false);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const box = Math.min(width * 0.72, 300);

  // scan line moving up and down inside the frame
  const line = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (res) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(line, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(line, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [res, line]);

  useEffect(() => {
    if (!session?.user?.id) return undefined;
    let active = true;
    const refresh = async () => {
      if (syncing.current) return;
      syncing.current = true;
      try {
        await syncPendingCheckins(session.user.id);
        const [bookings, pending] = await Promise.all([
          refreshCheckinCache(session.user.id),
          pendingCheckinCount(session.user.id),
        ]);
        if (active) { setCachedBookings(bookings); setPendingSync(pending); setSyncError(''); }
      } catch (e) {
        try {
          const [bookings, pending] = await Promise.all([
            readCheckinCache(session.user.id),
            pendingCheckinCount(session.user.id),
          ]);
          if (active) { setCachedBookings(bookings); setPendingSync(pending); }
        } catch (cacheError) {
          console.warn('Could not read offline check-in data:', cacheError.message);
        }
        if (!isNetworkError(e)) {
          console.warn('Could not sync offline check-ins:', e.message);
          if (active) setSyncError(e.message);
        }
      } finally {
        syncing.current = false;
      }
    };
    readCheckinCache(session.user.id).then((bookings) => { if (active) setCachedBookings(bookings); })
      .catch((e) => console.warn('Could not read offline check-in data:', e.message));
    refresh();
    const timer = setInterval(refresh, 30000);
    const appState = AppState.addEventListener('change', (state) => { if (state === 'active') refresh(); });
    return () => { active = false; clearInterval(timer); appState.remove(); };
  }, [session?.user?.id]);

  if (view === 'unused') {
    return (
      <View style={{ flex: 1, backgroundColor: '#F4F7F5', padding: 16 }}>
        <Text style={{ color: C.text, fontSize: 22, fontWeight: '800' }}>Unused bookings</Text>
        <Text style={{ color: C.muted, marginTop: 4 }}>
          {pendingSync ? `${pendingSync} check-in${pendingSync === 1 ? '' : 's'} waiting to sync.` : 'Only unused, paid bookings cached on this device are shown.'}
        </Text>
        {!!syncError && <Text style={{ color: '#B42318', marginTop: 8 }}>Sync needs attention: {syncError}</Text>}
        <TouchableOpacity onPress={() => setView('camera')} style={s.primaryBtn}>
          <Ionicons name="qr-code-outline" size={18} color="#fff" />
          <Text style={s.primaryBtnText}>Open scanner</Text>
        </TouchableOpacity>
        <FlatList
          data={cachedBookings}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={<Text style={{ textAlign: 'center', color: C.muted, marginTop: 32 }}>No unused bookings saved yet. Connect to the internet to refresh.</Text>}
          renderItem={({ item }) => (
            <View style={s.resultCard}>
              <Text style={s.guestName}>{item.listings?.title || 'Booking'}</Text>
              <Text style={s.guestSub}>{item.start_date}{item.end_date && item.end_date !== item.start_date ? ` to ${item.end_date}` : ''}</Text>
              <Row icon="people-outline" label="Guests" value={String(item.guests)} />
              <Row icon="card-outline" label="Payment" value={item.payment_status} />
            </View>
          )}
        />
      </View>
    );
  }

  // ---------- 1. permission still loading ----------
  if (!perm) {
    return (
      <View style={[s.center, { backgroundColor: '#fff' }]}>
        <ActivityIndicator color={C.primary} />
      </View>
    );
  }

  // ---------- 2. permission not granted ----------
  if (!perm.granted) {
    const blocked = perm.canAskAgain === false;
    return (
      <View style={[s.center, { backgroundColor: '#fff', paddingHorizontal: 28 }]}>
        <View style={s.permIcon}>
          <Ionicons name="camera-outline" size={40} color={C.primary} />
        </View>
        <Text style={s.permTitle}>Camera access needed</Text>
        <Text style={s.permText}>
          We use the camera only to scan a guest's booking QR code at check-in. Nothing is recorded or saved.
        </Text>
        {blocked ? (
          <>
            <Text style={[s.permText, { marginTop: 4 }]}>
              Camera permission is turned off. Open settings, tap Permissions, then allow Camera.
            </Text>
            <TouchableOpacity style={s.primaryBtn} onPress={() => Linking.openSettings()} activeOpacity={0.85}>
              <Ionicons name="settings-outline" size={18} color="#fff" />
              <Text style={s.primaryBtnText}>Open settings</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity style={s.primaryBtn} onPress={requestPerm} activeOpacity={0.85}>
            <Ionicons name="camera" size={18} color="#fff" />
            <Text style={s.primaryBtnText}>Allow camera</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={() => setView('unused')} style={{ padding: 14 }}>
          <Text style={{ color: C.primary, fontWeight: '700' }}>View unused bookings saved on this device</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const showOfflineBooking = async (token) => {
    const booking = await markCheckinUsed(session.user.id, token, true);
    if (!booking) {
      Alert.alert('Booking not available offline', 'This QR code is not in this device’s saved list of unused bookings. Connect to the internet and refresh bookings.');
      return false;
    }
    setCachedBookings(await readCheckinCache(session.user.id));
    setPendingSync(await pendingCheckinCount(session.user.id));
    setTorch(false);
    setRes({
      booking: { ...booking, checked_in_at: new Date().toISOString() },
      items: booking.booking_items || [],
      guest: {},
      offline: true,
    });
    return true;
  };

  // ---------- scan handler ----------
  const onScan = async ({ data }) => {
    if (locked.current || !data) return;
    locked.current = true;
    setBusy(true);
    Vibration.vibrate(60);
    try {
      const { data: r, error } = await supabase.rpc('scan_qr', { p_token: data.trim() });
      if (error) {
        if (isNetworkError(error)) {
          const shown = await showOfflineBooking(data.trim());
          if (!shown) locked.current = false;
          setBusy(false);
          return;
        }
        if (String(error.message).toLowerCase().includes('already checked in')) {
          await markCheckinUsed(session.user.id, data.trim());
          setCachedBookings(await readCheckinCache(session.user.id));
        }
        Alert.alert('Invalid QR code', error.message, [{ text: 'Scan again', onPress: () => { locked.current = false; setBusy(false); } }]);
        return;
      }
      await markCheckinUsed(session.user.id, data.trim());
      setCachedBookings(await readCheckinCache(session.user.id));
      setTorch(false);
      setRes(r);
      setBusy(false);
    } catch (e) {
      if (isNetworkError(e)) {
        try {
          const shown = await showOfflineBooking(data.trim());
          if (!shown) locked.current = false;
        } catch (cacheError) {
          locked.current = false;
          Alert.alert('Could not record check-in offline', cacheError.message);
        }
        setBusy(false);
        return;
      }
      Alert.alert('Could not check the code', String(e && e.message ? e.message : e), [
        { text: 'Scan again', onPress: () => { locked.current = false; setBusy(false); } },
      ]);
    }
  };

  const scanNext = () => {
    setRes(null);
    setBusy(false);
    locked.current = false;
  };

  // ---------- 3. result ----------
  if (res) {
    const b = res.booking || {};
    const g = res.guest || {};
    const paid = String(b.payment_status || '').toLowerCase() === 'paid';
    return (
      <View style={{ flex: 1, backgroundColor: '#F4F7F5' }}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24 + insets.bottom }}>
          <View style={s.resultCard}>
            <View style={s.okBadge}>
              <Ionicons name="checkmark" size={30} color="#fff" />
            </View>
            <Text style={s.okTitle}>Valid booking</Text>
            {res.offline && <Text style={s.offlineNotice}>Saved on this device. It will sync when online.</Text>}
            <Text style={s.guestName}>{[g.first_name, g.last_name].filter(Boolean).join(' ') || 'Guest'}</Text>
            {!!g.country && <Text style={s.guestSub}>{g.country}</Text>}

            <View style={s.divider} />

            <Row icon="calendar-outline" label="Stay" value={`${b.start_date} to ${b.end_date}`} />
            <Row icon="people-outline" label="Guests" value={String(b.guests ?? '-')} />
            <Row icon="flag-outline" label="Status" value={String(b.status ?? '-')} />
            <Row
              icon="card-outline"
              label="Payment"
              value={String(b.payment_status ?? '-')}
              valueStyle={{ color: paid ? '#1B7F4B' : '#B45309', fontWeight: '800' }}
            />

            {Array.isArray(res.items) && res.items.length > 0 && (
              <>
                <View style={s.divider} />
                <Text style={s.sectionLabel}>Included</Text>
                {res.items.map((i, k) => (
                  <View key={k} style={s.itemRow}>
                    <Text style={s.itemText}>{i.label}</Text>
                    <Text style={s.itemQty}>x {i.quantity}</Text>
                  </View>
                ))}
              </>
            )}

            <View style={s.divider} />
            <View style={s.totalRow}>
              <Text style={s.totalLabel}>Total</Text>
              <Text style={s.totalValue}>{formatMoney(b.total)}</Text>
            </View>
          </View>

          <TouchableOpacity style={[s.primaryBtn, { alignSelf: 'stretch', marginTop: 16 }]} onPress={scanNext} activeOpacity={0.85}>
            <Ionicons name="qr-code-outline" size={18} color="#fff" />
            <Text style={s.primaryBtnText}>Scan next</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  // ---------- 4. camera with framed scan box ----------
  const translateY = line.interpolate({ inputRange: [0, 1], outputRange: [8, box - 10] });

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={torch}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={busy ? undefined : onScan}
      />

      {/* dimmed mask with a clear window in the middle */}
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <View style={{ flex: 1, backgroundColor: DIM, justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 22 }}>
          <Text style={s.hint}>Point the camera at the guest's QR code</Text>
        </View>

        <View style={{ flexDirection: 'row', height: box }}>
          <View style={{ flex: 1, backgroundColor: DIM }} />
          <View style={{ width: box, height: box }}>
            {/* corner brackets */}
            <View style={[s.corner, s.tl]} />
            <View style={[s.corner, s.tr]} />
            <View style={[s.corner, s.bl]} />
            <View style={[s.corner, s.br]} />
            {/* moving scan line */}
            {!busy && <Animated.View style={[s.scanLine, { transform: [{ translateY }] }]} />}
            {busy && (
              <View style={s.busyWrap}>
                <ActivityIndicator size="large" color={ACCENT} />
                <Text style={s.busyText}>Checking booking</Text>
              </View>
            )}
          </View>
          <View style={{ flex: 1, backgroundColor: DIM }} />
        </View>

        <View style={{ flex: 1, backgroundColor: DIM, alignItems: 'center', paddingTop: 26, paddingBottom: insets.bottom + 16 }}>
          <TouchableOpacity onPress={() => setView('unused')} style={{ marginBottom: 14 }}>
            <Text style={{ color: '#fff', fontWeight: '700' }}>Unused bookings on this device ({cachedBookings.length})</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setTorch((t) => !t)}
            activeOpacity={0.85}
            style={[s.torchBtn, torch && { backgroundColor: ACCENT, borderColor: ACCENT }]}
            accessibilityLabel={torch ? 'Turn flashlight off' : 'Turn flashlight on'}
          >
            <Ionicons name={torch ? 'flashlight' : 'flashlight-outline'} size={22} color={torch ? C.deep : '#fff'} />
          </TouchableOpacity>
          <Text style={s.torchLabel}>{torch ? 'Flashlight on' : 'Flashlight'}</Text>
        </View>
      </View>
    </View>
  );
}

function Row({ icon, label, value, valueStyle }) {
  return (
    <View style={s.row}>
      <View style={s.rowLeft}>
        <Ionicons name={icon} size={18} color="#5F7A6D" />
        <Text style={s.rowLabel}>{label}</Text>
      </View>
      <Text style={[s.rowValue, valueStyle]}>{value}</Text>
    </View>
  );
}

const CORNER = 34;
const THICK = 5;

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // permission screen
  permIcon: {
    width: 84, height: 84, borderRadius: 42, backgroundColor: '#E8F5EE',
    alignItems: 'center', justifyContent: 'center', marginBottom: 20,
  },
  permTitle: { fontSize: 22, fontWeight: '800', color: C.text, marginBottom: 8, textAlign: 'center' },
  permText: { fontSize: 15, lineHeight: 22, color: '#5F6B66', textAlign: 'center', marginBottom: 12 },
  offlineNotice: { color: '#8A5A00', textAlign: 'center', fontWeight: '700', marginVertical: 8 },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.primary, paddingVertical: 14, paddingHorizontal: 28, borderRadius: 14, marginTop: 10,
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  // camera overlay
  hint: { color: '#fff', fontSize: 15, fontWeight: '600', textAlign: 'center', paddingHorizontal: 30 },
  corner: { position: 'absolute', width: CORNER, height: CORNER, borderColor: ACCENT },
  tl: { top: 0, left: 0, borderTopWidth: THICK, borderLeftWidth: THICK, borderTopLeftRadius: 16 },
  tr: { top: 0, right: 0, borderTopWidth: THICK, borderRightWidth: THICK, borderTopRightRadius: 16 },
  bl: { bottom: 0, left: 0, borderBottomWidth: THICK, borderLeftWidth: THICK, borderBottomLeftRadius: 16 },
  br: { bottom: 0, right: 0, borderBottomWidth: THICK, borderRightWidth: THICK, borderBottomRightRadius: 16 },
  scanLine: {
    position: 'absolute', left: 14, right: 14, height: 3, borderRadius: 2, backgroundColor: ACCENT,
    shadowColor: ACCENT, shadowOpacity: 0.9, shadowRadius: 8, shadowOffset: { width: 0, height: 0 }, elevation: 4,
  },
  busyWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(6,18,13,0.55)' },
  busyText: { color: '#fff', marginTop: 10, fontWeight: '600' },
  torchBtn: {
    width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.5)',
  },
  torchLabel: { color: '#fff', marginTop: 8, fontSize: 13, fontWeight: '600' },

  // result card
  resultCard: {
    backgroundColor: '#fff', borderRadius: 20, padding: 20, alignItems: 'stretch',
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 3,
  },
  okBadge: {
    alignSelf: 'center', width: 60, height: 60, borderRadius: 30, backgroundColor: '#1B7F4B',
    alignItems: 'center', justifyContent: 'center', marginBottom: 10,
  },
  okTitle: { textAlign: 'center', fontSize: 13, fontWeight: '700', color: '#1B7F4B', marginBottom: 6 },
  guestName: { textAlign: 'center', fontSize: 24, fontWeight: '800', color: C.text },
  guestSub: { textAlign: 'center', fontSize: 14, color: '#5F6B66', marginTop: 2 },
  divider: { height: 1, backgroundColor: '#E6ECE8', marginVertical: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 7 },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowLabel: { fontSize: 15, color: '#5F6B66' },
  rowValue: { fontSize: 15, fontWeight: '700', color: C.text, flexShrink: 1, textAlign: 'right', marginLeft: 12, textTransform: 'capitalize' },
  sectionLabel: { fontSize: 14, fontWeight: '700', color: C.text, marginBottom: 6 },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  itemText: { fontSize: 15, color: C.text, flex: 1 },
  itemQty: { fontSize: 15, color: '#5F6B66', marginLeft: 12 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel: { fontSize: 16, fontWeight: '700', color: C.text },
  totalValue: { fontSize: 22, fontWeight: '800', color: C.primary },
});