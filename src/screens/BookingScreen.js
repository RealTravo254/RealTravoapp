import React, { useState, useMemo, useEffect } from 'react';
import { ScrollView, View, Text, Switch, Alert, TouchableOpacity } from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { Btn, Card, Input, Label, Muted, Stepper } from '../components/ui';
import TimeField from '../components/TimeField';
import DateField from '../components/DateField';
import PickupTimeField from '../components/PickupTimeField';
import RoutePreview from '../components/RoutePreview';
import { getPosition, reverseInfo, getDistanceKm } from '../lib/geo';
import { pickLocation } from '../lib/pickBus';
import { computeTotal, bestOffer, ymd, scheduleProblem, transferPrice } from '../lib/pricing';
import { mainBlocks } from '../lib/schedule';
import { tr } from '../i18n';
import { C } from '../lib/theme';

const Check = ({ on, onPress, disabled, children }) => (
  <TouchableOpacity disabled={disabled} onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6, opacity: disabled ? 0.7 : 1 }}>
    <Text style={{ fontSize: 22, marginRight: 8 }}>{on ? '☑️' : '⬜'}</Text><View style={{ flex: 1 }}>{children}</View>
  </TouchableOpacity>
);
const Seg = ({ options, value, onChange }) => (
  <View style={{ flexDirection: 'row', marginVertical: 6 }}>
    {options.map(([k, label]) => <Btn key={k} style={{ flex: 1, marginRight: 6 }} kind={value === k ? undefined : 'ghost'} title={label} onPress={() => onChange(k)} />)}
  </View>
);

// Step 1: items, date, time, guests, nights, and pickup / drop-off / return. Nothing is saved yet.
export default function BookingScreen({ route, navigation }) {
  const { listing, prices, offers, pickup: pre } = route.params; const { profile } = useAuth();
  const [sel, setSel] = useState({}); const [guests, setGuests] = useState(1);
  const [days, setDays] = useState(() => (listing.schedule_type === 'tour' && listing.starts_on && listing.ends_on ? Math.max(1, Math.round((new Date(listing.ends_on) - new Date(listing.starts_on)) / 86400000) + 1) : 1));
  const fixedStart = (listing.category === 'event' || listing.schedule_type === 'one_time') ? (listing.event_date ? new Date(listing.event_date) : null) : (listing.schedule_type === 'tour' && listing.starts_on ? new Date(listing.starts_on + 'T12:00:00') : null);
  const isEvent = !!fixedStart; const isTour = listing.schedule_type === 'tour'; const isRange = listing.schedule_type === 'range' && !!listing.starts_on;
  const rangeStart = isRange ? new Date(listing.starts_on + 'T00:00:00') : null;
  const [start, setStart] = useState(fixedStart || (rangeStart && rangeStart > new Date() ? rangeStart : new Date()));
  const [time, setTime] = useState(fixedStart && !isTour ? `${String(fixedStart.getHours()).padStart(2, '0')}:${String(fixedStart.getMinutes()).padStart(2, '0')}` : isTour && listing.open_time ? listing.open_time.slice(0, 5) : '10:00');
  const [urgent, setUrgent] = useState(false); const [note, setNote] = useState(''); const [useBalance, setUseBalance] = useState(false);
  const [left, setLeft] = useState(undefined);

  // pickup / drop-off / return: main booking only. The pickup section is open from the start (ticked), for every listing type.
  const needsMeeting = true; const mustMeet = listing.category === 'guide';
  const [transfer, setTransfer] = useState(true); const [tripType, setTripType] = useState('oneway');
  const [pickupLoc, setPickupLoc] = useState(pre?.loc || null); const [pickupTime, setPickupTime] = useState(pre?.time || null);
  const [sameDrop, setSameDrop] = useState(true); const [dropLoc, setDropLoc] = useState(null);
  const [returnDate, setReturnDate] = useState(null); const [returnTime, setReturnTime] = useState('17:00');
  const [vehicles, setVehicles] = useState([]); const [vid, setVid] = useState(null);
  const [km, setKm] = useState(null); const [kmDrop, setKmDrop] = useState(null);

  const offer = bestOffer(offers, start);
  const calc = useMemo(() => computeTotal(sel, prices, days, offer), [sel, days, start]);
  const bump = (id, d) => setSel((s) => ({ ...s, [id]: Math.max(0, (s[id] || 0) + d) }));
  const bal = Number(profile?.balance || 0);
  const endDate = () => { const e = new Date(start); e.setDate(e.getDate() + days - 1); return e; };
  const maxGuests = typeof left === 'number' ? Math.max(left, 1) : 99;
  const isReturn = transfer && tripType === 'return';
  const retDate = returnDate && returnDate >= start ? returnDate : endDate();
  const startDay = ymd(start); const endDay = ymd(endDate());

  useEffect(() => { supabase.from('vehicles').select('*').eq('active', true).order('max_passengers').then(({ data }) => setVehicles(data || [])); }, []);
  useEffect(() => { supabase.rpc('get_availability', { p_listing: listing.id, p_start: ymd(start), p_end: ymd(endDate()) }).then(({ data }) => setLeft(data)); }, [start, days]);
  useEffect(() => { if (guests > maxGuests) setGuests(maxGuests); }, [maxGuests]);
  useEffect(() => {
    if (!(isReturn && !sameDrop && dropLoc)) { setKmDrop(null); return; }
    getDistanceKm({ lat: listing.lat, lng: listing.lng }, dropLoc).then((r) => setKmDrop(r.km));
  }, [isReturn, sameDrop, dropLoc]);

  const mine = async (set) => { const p = await getPosition(); if (!p) return; const i = await reverseInfo(p.lat, p.lng); set({ lat: p.lat, lng: p.lng, label: i.label }); };
  const onMap = async (set, title) => { const r = await pickLocation(navigation, title); if (r) set(r); };

  const v = vehicles.find((x) => x.id === vid && x.max_passengers >= guests);
  const needVehicle = !mustMeet;                        // guides can meet you without a paid vehicle
  const tprice = transfer && v && km != null ? transferPrice(v, km) + (isReturn ? transferPrice(v, sameDrop ? km : (kmDrop ?? km)) : 0) : 0;
  const grandTotal = calc.total + tprice;

  /* ---------- checks ---------- */
  const problems = [];
  const mp = scheduleProblem(listing, startDay, time); if (mp) problems.push(mp);
  if (transfer) {
    if (!pickupLoc) problems.push('Choose your pickup place.');
    if (!pickupTime) problems.push('Choose your pickup time.');
    else if (listing.pickup_times?.length && !listing.pickup_times.includes(pickupTime)) problems.push('Choose one of the host pickup times.');
    if (isReturn && !sameDrop && !dropLoc) problems.push('Choose your drop-off place.');
    if (needVehicle && !v) problems.push('Choose a vehicle that fits your group.');
    if (v && pickupLoc && km == null) problems.push('Calculating the pickup distance, please wait.');
    if (pickupTime && new Date(`${startDay}T${pickupTime}:00`).getTime() < Date.now() + 3600000) problems.push('Pickup must be at least 1 hour from now.');
  }
  const tdraft = transfer && pickupTime ? { pickupTime, returnDate: isReturn ? ymd(retDate) : null, returnTime: isReturn ? returnTime : null } : null;
  const mb = mainBlocks(listing, startDay, endDay, time, tdraft);
  mb.problems.forEach((m) => problems.push(m));
  const problem = problems[0];

  const next = () => {
    if (problem) return Alert.alert('Please check', problems.join('\n'));
    if (!calc.items.length && !listing.entrance_fee_free) return Alert.alert('Select at least one item (activities can be skipped, but pick entrance / room / ticket)');
    navigation.navigate('AddOns', { listing, draft: {
      guests, start: startDay, end: endDay, days, time, urgent, note,
      transfer: transfer ? { tripType, pickup: pickupLoc, pickupTime, dropoff: isReturn ? (sameDrop ? pickupLoc : dropLoc) : null,
        returnDate: isReturn ? ymd(retDate) : null, returnTime: isReturn ? returnTime : null,
        vehicle: v ? { id: v.id } : null, km, kmDrop: isReturn ? (sameDrop ? km : kmDrop) : null, price: tprice } : null,
      items: calc.items, subtotal: calc.subtotal, discount: calc.discount, total: calc.total, useBalance } });
  };

  const LocBtns = ({ set, title, loc }) => (
    <>
      <View style={{ flexDirection: 'row' }}>
        <Btn style={{ flex: 1, marginRight: 4 }} kind="ghost" title="📍 My location" onPress={() => mine(set)} />
        <Btn style={{ flex: 1, marginLeft: 4 }} kind="ghost" title="🗺️ Search / map" onPress={() => onMap(set, title)} />
      </View>
      {loc ? <Muted>📍 {loc.label}</Muted> : null}
    </>
  );

  return (
    <ScrollView keyboardShouldPersistTaps="handled" style={{ backgroundColor: '#fff' }}>
      <View style={{ backgroundColor: C.primary, padding: 16, paddingTop: 20 }}>
        <Text style={{ color: '#fff', fontSize: 22, fontWeight: '800' }}>{listing.title}</Text>
        <Text style={{ color: '#fff', opacity: 0.9, marginTop: 4 }}>Choose your items, date and pickup</Text>
      </View>
      {prices.map((p) => (
        <Card key={p.id}><View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}><Text style={{ fontWeight: '600' }}>{p.label}</Text><Muted>{p.audience} · {p.unit.replace('_', ' ')} · {Number(p.price) === 0 ? 'Free' : `$${p.price}`}{p.is_optional ? ' · optional' : ''}</Muted></View>
          <Btn title="−" kind="ghost" onPress={() => bump(p.id, -1)} /><Text style={{ width: 24, textAlign: 'center', color: C.primary, fontWeight: '800' }}>{sel[p.id] || 0}</Text><Btn title="+" kind="ghost" onPress={() => bump(p.id, 1)} />
        </View></Card>))}

      <View style={{ paddingHorizontal: 12 }}>
        <Label>{tr('date')} and time</Label>
        <View style={{ flexDirection: 'row' }}>
          <DateField style={{ flex: 1, marginRight: 8 }} value={start} disabled={isEvent} suffix={isEvent ? ' (fixed date)' : ''}
            minimumDate={rangeStart && rangeStart > new Date() ? rangeStart : new Date()}
            maximumDate={isRange && listing.ends_on ? new Date(listing.ends_on + 'T23:00:00') : undefined} onChange={setStart} />
          {isEvent ? <Text style={{ alignSelf: 'center', fontWeight: '700', color: C.primary }}>🕒 {time}</Text> : <TimeField value={time} onChange={setTime} />}
        </View>
        <Stepper label={isTour ? 'Trip length (days)' : 'Number of nights / days'} value={days} onChange={setDays} min={isTour ? days : 1} max={isTour ? days : 30} />
        <Stepper label={tr('guests')} value={guests} onChange={setGuests} min={1} max={maxGuests} />
        {left !== undefined && <Text style={{ color: left === 0 ? C.danger : C.ok, fontWeight: '700' }}>{left === null ? '✅ Available' : left === 0 ? '❌ Fully booked for these dates' : `✅ ${left} places left for these dates`}</Text>}

        {needsMeeting && (
          <Card style={{ marginHorizontal: 0, marginTop: 10, borderWidth: 2, borderColor: C.primary }}>
            <Check on={transfer} disabled={mustMeet} onPress={() => setTransfer(!transfer)}>
              <Text style={{ fontWeight: '800', color: C.primary }}>🚐 {mustMeet ? 'Pickup (required)' : 'Pickup and drop-off'}</Text>
              <Muted>Pickup to {listing.title}. For the main booking only, not for add-ons. Untick if you do not need a pickup.</Muted>
            </Check>
            {transfer && <>
              <Seg value={tripType} onChange={setTripType} options={[['oneway', 'Pickup only'], ['return', 'Pickup and return']]} />
              <Label>Pickup place</Label>
              <LocBtns set={setPickupLoc} title="Choose your pickup location" loc={pickupLoc} />
              <Label>Pickup time</Label>
              <PickupTimeField times={listing.pickup_times} value={pickupTime} onChange={setPickupTime} />
              <RoutePreview from={pickupLoc} to={{ lat: listing.lat, lng: listing.lng }} onKm={setKm} />
              {isReturn && <>
                <Check on={sameDrop} onPress={() => setSameDrop(!sameDrop)}><Text>Drop me back at the pickup place</Text></Check>
                {!sameDrop && <><Label>Drop-off place</Label><LocBtns set={setDropLoc} title="Choose your drop-off location" loc={dropLoc} /></>}
                <Label>Return date and time</Label>
                <View style={{ flexDirection: 'row' }}>
                  <DateField style={{ flex: 1, marginRight: 8 }} value={retDate} minimumDate={start} onChange={setReturnDate} />
                  <TimeField value={returnTime} onChange={setReturnTime} />
                </View>
              </>}
              <Label>{needVehicle ? 'Vehicle' : 'Vehicle (optional)'}</Label>
              {vehicles.map((x) => { const fits = x.max_passengers >= guests; return (
                <Card key={x.id} onPress={() => fits && setVid(vid === x.id && !needVehicle ? null : x.id)} style={{ marginHorizontal: 0, opacity: fits ? 1 : 0.4, borderWidth: 2, borderColor: vid === x.id ? C.primary : C.border }}>
                  <Text>{x.name} · max {x.max_passengers}</Text><Muted>${x.price_per_km}/km + ${x.base_fee}</Muted></Card>); })}
              <Text style={{ fontWeight: '700', color: C.primary }}>Transfer price{isReturn ? ' (both ways)' : ''}: ${tprice.toFixed(2)}{km != null ? ` (${km} km)` : ''}</Text>
              <Muted>The host sees the pickup, drop-off and return in the booking, email and notification.</Muted>
            </>}
          </Card>
        )}

        {problems.map((p, i) => <Text key={i} style={{ color: C.danger, fontWeight: '700', marginTop: 4 }}>⚠️ {p}</Text>)}
        <Label>Note to host</Label><Input multiline value={note} onChangeText={setNote} />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}><Text style={{ flex: 1 }}>{tr('urgent')}</Text><Switch value={urgent} onValueChange={setUrgent} trackColor={{ true: C.primary }} /></View>
        {bal > 0 && <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}><Text style={{ flex: 1 }}>Use account balance (${bal.toFixed(2)})</Text><Switch value={useBalance} onValueChange={setUseBalance} trackColor={{ true: C.primary }} /></View>}
        {offer && <Text style={{ color: '#D2691E', marginTop: 8 }}>🔥 {offer.title} −{offer.percent_off}% (−${calc.discount.toFixed(2)})</Text>}
        <View style={{ marginVertical: 10, padding: 12, borderRadius: 12, backgroundColor: C.primary }}>
          <Text style={{ color: '#fff' }}>Booking: ${calc.total.toFixed(2)}</Text>
          {transfer ? <Text style={{ color: '#fff' }}>Transfer: ${tprice.toFixed(2)}</Text> : null}
          <Text style={{ color: '#fff', fontSize: 22, fontWeight: '800', marginTop: 4 }}>{tr('total')}: ${grandTotal.toFixed(2)}</Text>
        </View>
        <Muted>Next you can add stopovers, stays and activities, then pay now or pay later.</Muted>
        <Btn title="Continue" onPress={next} disabled={left === 0 || !!problem} />
      </View><View style={{ height: 40 }} />
    </ScrollView>
  );
}
