import React, { useEffect, useState } from 'react';
import { ScrollView, Text, View, Alert } from 'react-native';
import DateField from '../components/DateField';
import RoutePreview from '../components/RoutePreview';
import { getPosition, reverseInfo } from '../lib/geo';
import { pickLocation } from '../lib/pickBus';
import { supabase, PAGE_SIZE } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { Btn, Card, Input, Label, Muted, Chip, Pager, Stepper } from '../components/ui';
import { transferPrice, ymd } from '../lib/pricing';
import { startPayment } from '../lib/payments';

// Full package: several listings + pickup transport, booked and paid in one go.
export default function TripBuilder({ navigation }) {
  const { session } = useAuth();
  const [people, setPeople] = useState('2'); const [start, setStart] = useState(new Date()); const [days, setDays] = useState('2');
  const [cart, setCart] = useState([]); const [q, setQ] = useState(''); const [rows, setRows] = useState([]); const [page, setPage] = useState(0);
  const [wantPickup, setWantPickup] = useState(false); const [pickup, setPickup] = useState(null); const [km, setKm] = useState(null); const [pickPeople, setPickPeople] = useState('2');
  const [vehicles, setVehicles] = useState([]); const [vid, setVid] = useState(null);
  useEffect(() => { supabase.from('vehicles').select('*').eq('active', true).order('max_passengers').then(({ data }) => setVehicles(data || [])); }, []);
  useEffect(() => { let x = supabase.from('listing_cards').select('*').range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE); if (q) x = x.ilike('title', `%${q}%`); x.then(({ data }) => setRows(data || [])); }, [q, page]);
  const v = vehicles.find(x => x.id === vid && x.max_passengers >= (Number(pickPeople) || 1));
  const tprice = wantPickup && km != null ? transferPrice(v, km) : 0;
  const dest = cart.find((c) => c.lat != null);
  const mine = async () => { const p = await getPosition(); if (!p) return; const i = await reverseInfo(p.lat, p.lng); setPickup({ lat: p.lat, lng: p.lng, label: i.label }); };
  const onMap = async () => { const r = await pickLocation(navigation, 'Choose your pickup location'); if (r) setPickup(r); };

  const add = async (l) => {
    if (cart.find(c => c.id === l.id)) return;
    const { data: prices } = await supabase.from('listing_prices').select('*').eq('listing_id', l.id);
    // default selection: required items, else the cheapest adult/regular price, x people
    const req = (prices || []).filter(p => !p.is_optional); const base = req.length ? req : (prices || []).sort((a, b) => a.price - b.price).slice(0, 1);
    setCart(c => [...c, { id: l.id, title: l.title, lat: l.lat, lng: l.lng, items: base }]);
  };
  const lineTotal = (c) => c.items.reduce((s, p) => s + Number(p.price) * (p.unit === 'per_group' ? 1 : Number(people) || 1) * (['per_night', 'per_day'].includes(p.unit) ? Number(days) || 1 : 1), 0);
  const total = cart.reduce((s, c) => s + lineTotal(c), 0) + tprice;

  const book = async () => {
    if (!cart.length) return Alert.alert('Add at least one place');
    if (wantPickup && (!v || !pickup || km == null)) return Alert.alert('Choose the pickup place on the map and a vehicle that fits your group');
    const end = new Date(start); end.setDate(end.getDate() + (Number(days) || 1) - 1);
    const { data: pkg, error } = await supabase.from('trip_packages').insert({ user_id: session.user.id, people: Number(people), start_date: ymd(start), end_date: ymd(end),
      pickup_location: wantPickup ? pickup.label : null, pickup_lat: wantPickup ? pickup.lat : null, pickup_lng: wantPickup ? pickup.lng : null, vehicle_id: wantPickup ? v.id : null, pickup_people: wantPickup ? Number(pickPeople) : null, distance_km: wantPickup ? km : null, transfer_price: tprice, total }).select().single();
    if (error) return Alert.alert('Error', error.message);
    for (const c of cart) {
      const t = lineTotal(c);
      const { data: b } = await supabase.from('bookings').insert({ user_id: session.user.id, listing_id: c.id, package_id: pkg.id, guests: Number(people), start_date: pkg.start_date, end_date: pkg.end_date, nights: Number(days), subtotal: t, total: t }).select().single();
      await supabase.from('booking_items').insert(c.items.map(p => ({ booking_id: b.id, price_id: p.id, label: p.label, quantity: Number(people), unit_price: p.price, amount: Number(p.price) * Number(people) })));
    }
    try { const p = await startPayment({ purpose: 'package', packageId: pkg.id }); navigation.replace('Pay', { url: p.authorization_url }); } catch (e) { Alert.alert('Payment', e.message); }
  };
  return (
    <ScrollView contentContainerStyle={{ padding: 12 }}>
      <Stepper label="People" value={Number(people) || 1} onChange={(n) => setPeople(String(n))} min={1} max={100} />
      <Label>Start date</Label><DateField value={start} minimumDate={new Date()} onChange={setStart} />
      
      <Stepper label="Days" value={Number(days) || 1} onChange={(n) => setDays(String(n))} min={1} max={30} />
      <Label>Add places (hotel, campsite, attraction, event…)</Label>
      <Input placeholder="Search…" value={q} onChangeText={(t) => { setQ(t); setPage(0); }} />
      {rows.slice(0, PAGE_SIZE).map(l => <Card key={l.id} onPress={() => add(l)} style={{ marginHorizontal: 0 }}><Text>＋ {l.title}</Text><Muted>{l.category} · {l.region}</Muted></Card>)}
      <Pager page={page} setPage={setPage} hasMore={rows.length > PAGE_SIZE} />
      <Label>Your package</Label>
      {cart.map(c => <Card key={c.id} style={{ marginHorizontal: 0 }}><Text style={{ fontWeight: '700' }}>{c.title}</Text><Muted>${lineTotal(c).toFixed(2)}</Muted><Btn kind="ghost" title="Remove" onPress={() => setCart(x => x.filter(y => y.id !== c.id))} /></Card>)}
      <Chip label={wantPickup ? '🚐 Pickup included' : '＋ Add pickup transport'} active={wantPickup} onPress={() => setWantPickup(!wantPickup)} />
      {wantPickup && <>
        <Label>Pickup place</Label>
        <View style={{ flexDirection: 'row' }}><Btn style={{ flex: 1, marginRight: 4 }} kind="ghost" title="📍 My location" onPress={mine} /><Btn style={{ flex: 1, marginLeft: 4 }} kind="ghost" title="🗺️ Search / map" onPress={onMap} /></View>
        {pickup ? <Muted>📍 {pickup.label}</Muted> : null}
        <Label>People to be picked</Label><Input keyboardType="number-pad" value={pickPeople} onChangeText={setPickPeople} />
        {dest ? <RoutePreview from={pickup} to={{ lat: dest.lat, lng: dest.lng }} onKm={setKm} /> : <Muted>Add a place to your package to see the route and price.</Muted>}
        {vehicles.map(x => { const fits = x.max_passengers >= (Number(pickPeople) || 1); return <Card key={x.id} onPress={() => fits && setVid(x.id)} style={{ marginHorizontal: 0, opacity: fits ? 1 : 0.4, borderWidth: 2, borderColor: vid === x.id ? '#1B4432' : '#E5E7EB' }}><Text>{x.name} · max {x.max_passengers}</Text><Muted>${x.price_per_km}/km + ${x.base_fee}</Muted></Card>; })}
        <Muted>Transport: ${tprice.toFixed(2)}</Muted></>}
      <Text style={{ fontSize: 22, fontWeight: '800', marginVertical: 10 }}>Package total: ${total.toFixed(2)}</Text>
      <Btn title="Book everything & pay once" onPress={book} />
    </ScrollView>
  );
}
