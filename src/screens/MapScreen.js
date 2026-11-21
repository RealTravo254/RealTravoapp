import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import MapView, { Marker, Callout } from '../components/SafeMap';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import ScreenHeader from '../components/ScreenHeader';
import { CATS } from '../lib/categories';
import { tr } from '../i18n';
import { C } from '../lib/theme';

const PIN = { hotel: 'blue', campsite: 'green', attraction: 'orange', airbnb: 'red', activity: 'violet', event: 'yellow', guide: 'cyan' };
export default function MapScreen({ navigation }) {
  const [rows, setRows] = useState([]); const [cat, setCat] = useState(null);
  useEffect(() => {
    let q = supabase.from('listing_cards').select('*').not('lat', 'is', null).limit(200);
    if (cat) q = q.eq('category', cat);
    q.then(({ data }) => setRows(data || []));
  }, [cat]);
  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title={cat ? tr(cat) : tr('map')} icon="map-outline" subtitle="Places around you" />
      <View style={{ flex: 1 }}>
        <MapView style={{ flex: 1 }} showsUserLocation showsMyLocationButton initialRegion={{ latitude: -6.37, longitude: 34.89, latitudeDelta: 12, longitudeDelta: 12 }}>
          {rows.map((r) => (
            <Marker key={r.id} coordinate={{ latitude: r.lat, longitude: r.lng }} pinColor={PIN[r.category]} title={r.title} description={r.category}>
              <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, paddingHorizontal: 7, paddingVertical: 4, borderWidth: 1, borderColor: C.primary, elevation: 3, maxWidth: 180 }}>
                <Ionicons name="navigate" size={13} color={C.primary} />
                <Text numberOfLines={1} style={{ maxWidth: 150, marginLeft: 4, color: C.text, fontSize: 10, fontWeight: '700' }}>{r.title}</Text>
                <Text style={{ marginLeft: 4, color: C.muted, fontSize: 9 }}>{r.category}</Text>
              </View>
              <Callout onPress={() => navigation.navigate('ListingDetail', { id: r.id })}>
                <Text style={{ fontWeight: '700' }}>{r.title}</Text><Text>{r.category} · tap for details</Text>
                <Text onPress={() => navigation.navigate('TravelMap', { dest: { lat: r.lat, lng: r.lng, title: r.title } })} style={{ color: C.primary }}>🧭 Navigate</Text>
              </Callout>
            </Marker>
          ))}
        </MapView>
        <View style={{ position: 'absolute', top: 8, left: 8, right: 8, flexDirection: 'row', flexWrap: 'wrap' }}>
          {[{ key: null, icon: 'apps-outline' }, ...CATS].map((c) => (
            <TouchableOpacity key={String(c.key)} onPress={() => setCat(c.key)} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: cat === c.key ? C.primary : '#fff', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6, margin: 3, elevation: 3 }}>
              <Ionicons name={c.icon} size={14} color={cat === c.key ? '#fff' : C.primary} />
              <Text style={{ marginLeft: 4, fontSize: 12, color: cat === c.key ? '#fff' : C.text }}>{c.key ? tr(c.key) : 'All'}</Text>
            </TouchableOpacity>))}
        </View>
      </View>
    </View>
  );
}
