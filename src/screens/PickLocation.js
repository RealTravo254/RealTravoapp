import React, { useEffect, useRef, useState } from 'react';
import { View, Alert, TextInput, FlatList, TouchableOpacity, Text, ActivityIndicator, Keyboard } from 'react-native';
import MapView, { Marker } from '../components/SafeMap';
import { Btn, Muted } from '../components/ui';
import { finishPick } from '../lib/pickBus';
import { getPosition, reverseInfo } from '../lib/geo';

export default function PickLocation({ navigation, route }) {
  const ref = useRef(); const [pt, setPt] = useState(null); const [label, setLabel] = useState('');
  const [q, setQ] = useState(''); const [results, setResults] = useState([]); const [searching, setSearching] = useState(false);
  useEffect(() => { navigation.setOptions({ title: route.params?.title || 'Choose location' }); return () => finishPick(null); }, []);

  // search places by name or address (free OpenStreetMap search)
  useEffect(() => {
    if (q.trim().length < 3) { setResults([]); return; }
    let dead = false;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=6&q=${encodeURIComponent(q.trim())}`, { headers: { 'Accept-Language': 'en', 'User-Agent': 'realtravo/1.0' } });
        const j = await r.json(); if (!dead) setResults(Array.isArray(j) ? j : []);
      } catch (e) { if (!dead) setResults([]); }
      if (!dead) setSearching(false);
    }, 700);
    return () => { dead = true; clearTimeout(t); };
  }, [q]);

  const go = (lat, lng) => ref.current?.animateToRegion({ latitude: lat, longitude: lng, latitudeDelta: 0.02, longitudeDelta: 0.02 });
  const set = async (lat, lng) => { setPt({ lat, lng }); setLabel(`${lat.toFixed(4)}, ${lng.toFixed(4)}`); const i = await reverseInfo(lat, lng); setLabel(i.label); };
  const mine = async () => { const p = await getPosition(); if (!p) return; await set(p.lat, p.lng); go(p.lat, p.lng); };
  const choose = (r) => { Keyboard.dismiss(); setResults([]); setQ(''); const lat = Number(r.lat), lng = Number(r.lon); setPt({ lat, lng }); setLabel(r.display_name); go(lat, lng); };
  const confirm = () => { if (!pt) return Alert.alert('Search or tap the map to drop a pin first'); finishPick({ lat: pt.lat, lng: pt.lng, label }); navigation.goBack(); };

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>
        <MapView ref={ref} style={{ flex: 1 }} showsUserLocation onPress={(e) => set(e.nativeEvent.coordinate.latitude, e.nativeEvent.coordinate.longitude)}
          initialRegion={{ latitude: -4.5, longitude: 36.5, latitudeDelta: 12, longitudeDelta: 12 }}>
          {pt && <Marker coordinate={{ latitude: pt.lat, longitude: pt.lng }} />}
        </MapView>
        <View style={{ position: 'absolute', top: 10, left: 10, right: 10 }}>
          <TextInput value={q} onChangeText={setQ} placeholder="🔍 Search a place or address" returnKeyType="search" onSubmitEditing={Keyboard.dismiss}
            style={{ backgroundColor: '#fff', borderRadius: 10, padding: 12, fontSize: 16, elevation: 4, shadowOpacity: 0.2, shadowRadius: 4 }} />
          {(searching || results.length > 0) && (
            <View style={{ backgroundColor: '#fff', borderRadius: 10, marginTop: 4, maxHeight: 240, elevation: 4 }}>
              {searching && <ActivityIndicator style={{ margin: 8 }} />}
              <FlatList keyboardShouldPersistTaps="handled" data={results} keyExtractor={(i) => String(i.place_id)}
                renderItem={({ item }) => <TouchableOpacity onPress={() => choose(item)} style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: '#eee' }}><Text numberOfLines={2}>{item.display_name}</Text></TouchableOpacity>} />
            </View>
          )}
        </View>
      </View>
      <View style={{ backgroundColor: '#fff', padding: 14, borderTopLeftRadius: 18, borderTopRightRadius: 18 }}>
        <Muted>{pt ? `📍 ${label}` : 'Search above, tap the map, or use your location'}</Muted>
        <View style={{ flexDirection: 'row' }}>
          <Btn style={{ flex: 1, marginRight: 4 }} kind="ghost" title="📍 My location" onPress={mine} />
          <Btn style={{ flex: 1, marginLeft: 4 }} title="Confirm" onPress={confirm} />
        </View>
      </View>
    </View>
  );
}
