import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, Alert } from 'react-native';
import MapView, { Marker, Polyline } from '../components/SafeMap';
import * as Location from 'expo-location';
import { getRoute, getPosition } from '../lib/geo';
import { Btn, Chip, Muted } from '../components/ui';
import { C } from '../lib/theme';

// In-app navigation: real road route from the traveller to a place, live position, step list.
export default function TravelMap({ route: r, navigation }) {
  const dest = r.params.dest; // { lat, lng, title }
  const map = useRef(); const sub = useRef();
  const [me, setMe] = useState(null); const [mode, setMode] = useState('driving'); const [info, setInfo] = useState(null);
  const [follow, setFollow] = useState(false); const [steps, setSteps] = useState(false);

  useEffect(() => { navigation.setOptions({ title: dest.title }); (async () => { const p = await getPosition(); if (p) setMe(p); })(); return () => sub.current?.remove(); }, []);

  useEffect(() => { if (!me) return;
    getRoute(me, dest, mode).then((x) => { setInfo(x); map.current?.fitToCoordinates(x.coords, { edgePadding: { top: 80, bottom: 220, left: 40, right: 40 } }); }).catch((e) => Alert.alert('Route', e.message));
  }, [me?.lat, mode]);

  const start = async () => {
    if (follow) { sub.current?.remove(); setFollow(false); return; }
    try {
      setFollow(true);
      sub.current = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, distanceInterval: 15 }, (p) => {
        map.current?.animateCamera({ center: { latitude: p.coords.latitude, longitude: p.coords.longitude }, zoom: 16, heading: p.coords.heading || 0 });
      });
    } catch (e) { setFollow(false); Alert.alert('Location is off', 'Turn on location (GPS) to follow your position.'); }
  };
  return (
    <View style={{ flex: 1 }}>
      <MapView ref={map} style={{ flex: 1 }} showsUserLocation showsMyLocationButton initialRegion={{ latitude: dest.lat, longitude: dest.lng, latitudeDelta: 0.2, longitudeDelta: 0.2 }}>
        <Marker coordinate={{ latitude: dest.lat, longitude: dest.lng }} title={dest.title} />
        {info && <Polyline coordinates={info.coords} strokeWidth={5} strokeColor={C.primary} />}
      </MapView>
      <View style={{ backgroundColor: '#fff', padding: 12, borderTopLeftRadius: 18, borderTopRightRadius: 18, maxHeight: 300 }}>
        <View style={{ flexDirection: 'row' }}>{[['driving', '🚗'], ['walking', '🚶'], ['transit', '🚌'], ['bicycling', '🚲']].map(([m, e]) => <Chip key={m} label={e} active={mode === m} onPress={() => setMode(m)} />)}</View>
        {info ? <Text style={{ fontSize: 18, fontWeight: '800', marginVertical: 6 }}>{info.durationText} · {info.distanceText}</Text> : <Muted>{me ? 'Finding route…' : 'Waiting for your location…'}</Muted>}
        <View style={{ flexDirection: 'row' }}>
          <Btn style={{ flex: 1, marginRight: 4 }} title={follow ? 'Stop' : '▶ Start navigation'} onPress={start} />
          <Btn style={{ flex: 1, marginLeft: 4 }} kind="ghost" title={steps ? 'Hide steps' : 'Steps'} onPress={() => setSteps(!steps)} />
        </View>
        {steps && info && <ScrollView style={{ maxHeight: 130 }}>{info.steps.map((s, i) => <Text key={i} style={{ paddingVertical: 3 }}>{i + 1}. {s.text} ({s.dist})</Text>)}</ScrollView>}
      </View>
    </View>
  );
}
