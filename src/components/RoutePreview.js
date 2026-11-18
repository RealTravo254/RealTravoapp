import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import MapView, { Marker, Polyline } from './SafeMap';
import { getRoute, haversineKm } from '../lib/geo';
import { C } from '../lib/theme';

// Map with the real road route (every bend) from pickup to destination. The distance is calculated here, never typed in.
export default function RoutePreview({ from, to, onKm, height = 190 }) {
  const ref = useRef(); const [info, setInfo] = useState(null); const [steps, setSteps] = useState(false);
  useEffect(() => {
    if (!from || !to) { setInfo(null); return; }
    let live = true; setInfo(null);
    (async () => {
      try {
        const r = await getRoute(from, to); const km = Math.round(r.km * 10) / 10;
        if (live) { setInfo({ coords: r.coords, km, dur: r.durationText, est: false, steps: r.steps, source: r.source }); onKm?.(km); }
      } catch (e) {
        const km = Math.round(haversineKm(from, to) * 1.3 * 10) / 10;
        if (live) { setInfo({ coords: [{ latitude: from.lat, longitude: from.lng }, { latitude: to.lat, longitude: to.lng }], km, est: true, err: e.message, steps: [] }); onKm?.(km); }
      }
    })();
    return () => { live = false; };
  }, [from?.lat, from?.lng, to?.lat, to?.lng]);
  useEffect(() => { if (info) setTimeout(() => ref.current?.fitToCoordinates(info.coords, { edgePadding: { top: 40, bottom: 40, left: 40, right: 40 }, animated: true }), 300); }, [info]);
  if (!from || !to) return null;
  return (
    <View style={{ marginVertical: 8 }}>
      <View style={{ height, borderRadius: 14, overflow: 'hidden' }}>
        <MapView ref={ref} style={{ flex: 1 }} initialRegion={{ latitude: from.lat, longitude: from.lng, latitudeDelta: 0.3, longitudeDelta: 0.3 }}>
          <Marker coordinate={{ latitude: from.lat, longitude: from.lng }} title="Pickup" pinColor="green" />
          <Marker coordinate={{ latitude: to.lat, longitude: to.lng }} title="Destination" />
          {info && <Polyline coordinates={info.coords} strokeWidth={5} strokeColor={C.primary} />}
        </MapView>
      </View>
      <View style={{ backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12, marginTop: 8 }}>
        {!info ? <Text style={{ color: C.muted }}>Calculating the route…</Text> : (<>
          <Text style={{ fontSize: 18, fontWeight: '800', color: C.text }}>🚗 {info.km} km{info.dur ? ` · ${info.dur}` : ''}</Text>
          {info.est && <Text style={{ color: C.danger, marginTop: 4 }}>No road route could be found ({info.err}). Showing a straight-line estimate.</Text>}
          {!info.est && <Text style={{ color: C.muted, marginTop: 2 }}>Real road route · {info.source === 'google' ? 'Google Maps' : 'OpenStreetMap'}</Text>}
          {info.steps.length > 0 && (<>
            <TouchableOpacity onPress={() => setSteps(!steps)}><Text style={{ color: C.primary, fontWeight: '700', marginTop: 8 }}>{steps ? 'Hide directions' : 'Show directions'}</Text></TouchableOpacity>
            {steps && info.steps.map((s, i) => <Text key={i} style={{ paddingVertical: 3, color: C.text }}>{i + 1}. {s.text} <Text style={{ color: C.muted }}>({s.dist})</Text></Text>)}
          </>)}
        </>)}
      </View>
    </View>
  );
}
