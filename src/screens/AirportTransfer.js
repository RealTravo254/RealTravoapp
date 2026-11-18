import React, { useEffect, useState } from 'react';
import { ScrollView, Text, Alert, View, TouchableOpacity } from 'react-native';
import DateField from '../components/DateField';
import { getPosition, reverseInfo } from '../lib/geo';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { Btn, Card, Label, Muted, Chip } from '../components/ui';
import TimeField from '../components/TimeField';
import RoutePreview from '../components/RoutePreview';
import { pickLocation } from '../lib/pickBus';
import { transferPrice, ymd, toMin } from '../lib/pricing';
import { startPayment } from '../lib/payments';
import { C } from '../lib/theme';

// Airport pickups: airports are set by the admin, the distance and price are calculated by the app.
export default function AirportTransfer({ navigation }) {
  const { session } = useAuth();
  const [dir, setDir] = useState('from'); // from = airport to place, to = place to airport
  const [airports, setAirports] = useState([]); const [airport, setAirport] = useState(null); const [place, setPlace] = useState(null);
  const [vehicles, setVehicles] = useState([]); const [vid, setVid] = useState(null); const [pax, setPax] = useState(1);
  const [date, setDate] = useState(new Date()); const [time, setTime] = useState('12:00');
  const [km, setKm] = useState(null); const [busy, setBusy] = useState(false);
  useEffect(() => {
    supabase.from('airports').select('*').eq('active', true).order('country').order('name').then(({ data }) => setAirports(data || []));
    supabase.from('vehicles').select('*').eq('active', true).order('max_passengers').then(({ data }) => setVehicles(data || []));
  }, []);

  const mine = async () => {
    const pos = await getPosition(); if (!pos) return;
    const info = await reverseInfo(pos.lat, pos.lng); setPlace({ lat: pos.lat, lng: pos.lng, label: info.label });
  };
  const onMap = async () => { const r = await pickLocation(navigation, dir === 'from' ? 'Where should we drop you?' : 'Where should we pick you up?'); if (r) setPlace(r); };

  const A = airport ? { lat: airport.lat, lng: airport.lng } : null; const P = place ? { lat: place.lat, lng: place.lng } : null;
  const from = dir === 'from' ? A : P; const to = dir === 'from' ? P : A;
  const v = vehicles.find((x) => x.id === vid && x.max_passengers >= pax); const price = v && km != null ? transferPrice(v, km) : 0;

  const book = async () => {
    if (!airport || !place) return Alert.alert('Choose the airport and the place');
    if (!v) return Alert.alert('Choose a vehicle that fits your group');
    if (km == null) return Alert.alert('Distance is still being calculated');
    const [h, m] = time.split(':').map(Number); const when = new Date(date); when.setHours(h, m, 0, 0);
    if (when.getTime() < Date.now() + 3600000) return Alert.alert('Pickup time', 'Choose a time at least 1 hour from now.');
    setBusy(true);
    try {
      const { data, error } = await supabase.from('airport_transfers').insert({ user_id: session.user.id, vehicle_id: v.id, airport_id: airport.id,
        pickup: dir === 'from' ? airport.name : place.label, dropoff: dir === 'from' ? place.label : airport.name, pickup_time: when.toISOString(), passengers: pax, distance_km: km, price,
        pickup_lat: from.lat, pickup_lng: from.lng, dropoff_lat: to.lat, dropoff_lng: to.lng }).select().single();
      if (error) throw error;
      const p = await startPayment({ purpose: 'transfer', transferId: data.id }); navigation.replace('Pay', { url: p.authorization_url });
    } catch (e) { Alert.alert('Error', e.message); } finally { setBusy(false); }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 12 }}>
      <View style={{ flexDirection: 'row' }}>
        <Chip label="✈️ From airport" active={dir === 'from'} onPress={() => setDir('from')} /><Chip label="🏁 To airport" active={dir === 'to'} onPress={() => setDir('to')} />
      </View>
      <Label>{dir === 'from' ? 'Pickup airport' : 'Drop-off airport'} (set by admin)</Label>
      {airports.map((a) => (
        <Card key={a.id} onPress={() => setAirport(a)} style={{ marginHorizontal: 0, borderWidth: 2, borderColor: airport?.id === a.id ? C.primary : C.border }}>
          <Text style={{ fontWeight: '700' }}>{a.code ? `${a.code} · ` : ''}{a.name}</Text><Muted>{a.city}, {a.country}</Muted></Card>))}
      {airports.length === 0 && <Muted>No airports yet. The admin adds them in Admin → Airports.</Muted>}

      <Label>{dir === 'from' ? 'Where to?' : 'Pickup place'}</Label>
      <View style={{ flexDirection: 'row' }}>
        <Btn style={{ flex: 1, marginRight: 4 }} kind="ghost" title="📍 My location" onPress={mine} />
        <Btn style={{ flex: 1, marginLeft: 4 }} kind="ghost" title="🗺️ Choose on map" onPress={onMap} />
      </View>
      {place && <Muted>📍 {place.label}</Muted>}

      <Label>Pickup date and time</Label>
      <View style={{ flexDirection: 'row' }}>
        <DateField style={{ flex: 1, marginRight: 8 }} value={date} minimumDate={new Date()} onChange={setDate} />
        <TimeField value={time} onChange={setTime} />
      </View>
      

      <RoutePreview from={from} to={to} onKm={setKm} />

      <Label>Passengers</Label>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Btn title="−" kind="ghost" onPress={() => setPax(Math.max(1, pax - 1))} /><Text style={{ width: 40, textAlign: 'center', fontSize: 18, fontWeight: '800' }}>{pax}</Text><Btn title="+" kind="ghost" onPress={() => setPax(pax + 1)} />
      </View>
      <Label>Vehicle (only vehicles that fit your group)</Label>
      {vehicles.map((x) => { const fits = x.max_passengers >= pax; return (
        <Card key={x.id} onPress={() => fits && setVid(x.id)} style={{ marginHorizontal: 0, opacity: fits ? 1 : 0.4, borderWidth: 2, borderColor: vid === x.id ? C.primary : C.border }}>
          <Text style={{ fontWeight: '700' }}>{x.name}</Text><Muted>Up to {x.max_passengers} passengers · ${x.price_per_km}/km + ${x.base_fee}</Muted></Card>); })}
      <Text style={{ fontSize: 22, fontWeight: '800', marginVertical: 8 }}>Price: ${price.toFixed(2)}</Text>
      <Btn title="Book & pay" onPress={book} disabled={busy} />
      <View style={{ height: 30 }} />
    </ScrollView>
  );
}
