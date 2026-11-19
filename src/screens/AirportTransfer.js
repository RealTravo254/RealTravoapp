import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, Alert, View } from 'react-native';
import DateField from '../components/DateField';
import TimeField from '../components/TimeField';
import RoutePreview from '../components/RoutePreview';
import { getPosition, reverseInfo } from '../lib/geo';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { Btn, Card, Input, Label, Muted, Chip } from '../components/ui';
import { pickLocation } from '../lib/pickBus';
import { transferPrice } from '../lib/pricing';
import { startPayment } from '../lib/payments';
import { C } from '../lib/theme';

const AIRPORT_PAGE_SIZE = 8;

// Airports are added by the admin (by country and city). The app calculates the route; the guest only sees the total price.
export default function AirportTransfer({ navigation }) {
  const { session, formatMoney } = useAuth();
  const [dir, setDir] = useState('from');
  const [airports, setAirports] = useState([]); const [airport, setAirport] = useState(null); const [place, setPlace] = useState(null);
  const [country, setCountry] = useState(''); const [q, setQ] = useState(''); const [page, setPage] = useState(0);
  const [vehicles, setVehicles] = useState([]); const [vid, setVid] = useState(null); const [pax, setPax] = useState(1);
  const [date, setDate] = useState(new Date()); const [time, setTime] = useState('12:00');
  const [km, setKm] = useState(null); const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.from('airports').select('*').eq('active', true).order('country').order('city').order('name').then(({ data }) => setAirports(data || []));
    supabase.from('vehicles').select('*').eq('active', true).order('max_passengers').then(({ data }) => setVehicles(data || []));
    supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle().then(({ data }) => data?.country && setCountry((c) => c || data.country));
  }, []);

  const countries = useMemo(() => [...new Set(airports.map((a) => a.country))], [airports]);
  const filteredAirports = useMemo(() => {
    const s = q.trim().toLowerCase(); const g = {};
    return airports.filter((a) => (!country || a.country === country) && (!s || `${a.name} ${a.code || ''} ${a.city || ''}`.toLowerCase().includes(s)));
  }, [airports, country, q]);
  const totalPages = Math.max(1, Math.ceil(filteredAirports.length / AIRPORT_PAGE_SIZE));
  const grouped = useMemo(() => {
    const groups = {};
    filteredAirports.slice(page * AIRPORT_PAGE_SIZE, (page + 1) * AIRPORT_PAGE_SIZE)
      .forEach((a) => { const k = `${a.country}|${a.city || 'Other'}`; (groups[k] = groups[k] || []).push(a); });
    return Object.entries(groups);
  }, [filteredAirports, page]);

  useEffect(() => { setPage(0); }, [country, q]);

  const mine = async () => { const pos = await getPosition(); if (!pos) return; const info = await reverseInfo(pos.lat, pos.lng); setPlace({ lat: pos.lat, lng: pos.lng, label: info.label }); };
  const onMap = async () => { const r = await pickLocation(navigation, dir === 'from' ? 'Where should we drop you?' : 'Where should we pick you up?'); if (r) setPlace(r); };

  const A = airport ? { lat: airport.lat, lng: airport.lng } : null; const P = place ? { lat: place.lat, lng: place.lng } : null;
  const from = dir === 'from' ? A : P; const to = dir === 'from' ? P : A;
  const v = vehicles.find((x) => x.id === vid && x.max_passengers >= pax); const price = v && km != null ? transferPrice(v, km) : 0;

  const book = async () => {
    if (!airport || !place) return Alert.alert('Choose the airport and the place');
    if (!v) return Alert.alert('Choose a vehicle that fits your group');
    if (km == null) return Alert.alert('Please wait', 'We are still working out your price.');
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

  const H = ({ n, t }) => <Text style={{ fontSize: 16, fontWeight: '800', marginTop: 16, marginBottom: 4 }}>{n}. {t}</Text>;

  return (
    <ScrollView keyboardShouldPersistTaps="handled" style={{ backgroundColor: '#F6F7F5' }}>
      <View style={{ backgroundColor: C.primary, padding: 18, paddingTop: 22, paddingBottom: 24, borderBottomLeftRadius: 28, borderBottomRightRadius: 28 }}>
        <Text style={{ color: '#fff', fontSize: 24, fontWeight: '800' }}>✈️ Airport transfer</Text>
        <Text style={{ color: '#fff', opacity: 0.85, marginTop: 4 }}>Safe rides to and from the airport at a clear price.</Text>
        <View style={{ flexDirection: 'row', marginTop: 12 }}>
          <Chip label="✈️ From airport" active={dir === 'from'} onPress={() => setDir('from')} /><Chip label="🏁 To airport" active={dir === 'to'} onPress={() => setDir('to')} />
        </View>
      </View>

      <View style={{ padding: 12 }}>
        <H n={1} t={dir === 'from' ? 'Pickup airport' : 'Drop-off airport'} />
        {countries.length > 1 && <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Chip label="All countries" active={!country} onPress={() => setCountry('')} />
          {countries.map((c) => <Chip key={c} label={c} active={country === c} onPress={() => setCountry(c)} />)}</ScrollView>}
        <Input placeholder="Search airport, code or city" value={q} onChangeText={(value) => { setPage(0); setQ(value); }} />
        {filteredAirports.length > 0 && <Muted>{filteredAirports.length} airports · page {page + 1} of {totalPages}</Muted>}
        {grouped.map(([k, list]) => { const [ctry, city] = k.split('|'); return (
          <View key={k}>
            <Text style={{ fontWeight: '800', color: C.primary, marginTop: 8 }}>📍 {city}, {ctry}</Text>
            {list.map((a) => (
              <Card key={a.id} onPress={() => setAirport(a)} style={{ marginHorizontal: 0, borderWidth: 2, borderColor: airport?.id === a.id ? C.primary : '#E5E7EB', backgroundColor: airport?.id === a.id ? '#EAF3EE' : '#fff' }}>
                <Text style={{ fontWeight: '700' }}>{a.code ? `${a.code} · ` : ''}{a.name}</Text>{a.region ? <Muted>{a.region}</Muted> : null}</Card>))}
          </View>); })}
        {airports.length === 0 && <Muted>No airports yet. The admin adds them in Admin → Airports.</Muted>}
        {airports.length > 0 && filteredAirports.length === 0 && <Muted>No airport matches your search.</Muted>}
        {filteredAirports.length > AIRPORT_PAGE_SIZE && <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 8 }}>
          <Btn style={{ flex: 1 }} kind="ghost" title="← Previous" disabled={page === 0} onPress={() => setPage((n) => Math.max(0, n - 1))} />
          <Text style={{ paddingHorizontal: 10, fontWeight: '700' }}>{page + 1}/{totalPages}</Text>
          <Btn style={{ flex: 1 }} kind="ghost" title="Next →" disabled={page + 1 >= totalPages} onPress={() => setPage((n) => Math.min(totalPages - 1, n + 1))} />
        </View>}

        <H n={2} t={dir === 'from' ? 'Where to?' : 'Pickup place'} />
        <View style={{ flexDirection: 'row' }}>
          <Btn style={{ flex: 1, marginRight: 4 }} kind="ghost" title="📍 My location" onPress={mine} />
          <Btn style={{ flex: 1, marginLeft: 4 }} kind="ghost" title="🗺️ Choose on map" onPress={onMap} />
        </View>
        {place && <Muted>📍 {place.label}</Muted>}

        <H n={3} t="Date and time" />
        <View style={{ flexDirection: 'row' }}>
          <DateField style={{ flex: 1, marginRight: 8 }} value={date} minimumDate={new Date()} onChange={setDate} />
          <TimeField value={time} onChange={setTime} />
        </View>

        <RoutePreview from={from} to={to} onKm={setKm} />

        <H n={4} t="Passengers" />
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Btn title="−" kind="ghost" onPress={() => setPax(Math.max(1, pax - 1))} /><Text style={{ width: 44, textAlign: 'center', fontSize: 20, fontWeight: '800' }}>{pax}</Text><Btn title="+" kind="ghost" onPress={() => setPax(pax + 1)} />
        </View>

        <H n={5} t="Choose a vehicle" />
        {vehicles.map((x) => { const fits = x.max_passengers >= pax; const total = km != null ? transferPrice(x, km) : null; return (
          <Card key={x.id} onPress={() => fits && setVid(x.id)} style={{ marginHorizontal: 0, opacity: fits ? 1 : 0.4, borderWidth: 2, borderColor: vid === x.id ? C.primary : '#E5E7EB', backgroundColor: vid === x.id ? '#EAF3EE' : '#fff', flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1 }}><Text style={{ fontWeight: '800' }}>{x.name}</Text><Muted>Up to {x.max_passengers} passengers{fits ? '' : ' · too small for your group'}</Muted></View>
            <Text style={{ fontSize: 18, fontWeight: '800', color: C.primary }}>{total != null ? formatMoney(total) : '—'}</Text></Card>); })}
        {km == null && <Muted>Choose the airport and place to see prices.</Muted>}

        <View style={{ marginVertical: 12, padding: 14, borderRadius: 14, backgroundColor: C.primary }}>
          <Text style={{ color: '#fff', opacity: 0.9 }}>Total</Text><Text style={{ color: '#fff', fontSize: 28, fontWeight: '800' }}>{formatMoney(price)}</Text></View>
        <Btn title={busy ? 'Please wait…' : 'Book & pay'} onPress={book} disabled={busy} />
        <View style={{ height: 30 }} />
      </View>
    </ScrollView>
  );
}