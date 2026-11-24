import React, { useEffect, useState, useMemo } from 'react';
import { ScrollView, View, Text, Alert, TouchableOpacity } from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { Btn, Card, Input, Label, Muted, Stepper, Loader, Chip } from '../components/ui';
import TimeField from '../components/TimeField';
import DateField from '../components/DateField';
import PickupTimeField from '../components/PickupTimeField';
import RoutePreview from '../components/RoutePreview';
import { computeTotal, ymd, scheduleProblem, transferPrice } from '../lib/pricing';
import { abs, durationOf, hhmm, addDays, freeSlot, addonClashes, STAY } from '../lib/schedule';
import { pickLocation } from '../lib/pickBus';
import { getPosition, reverseInfo } from '../lib/geo';
import { choosePayment } from '../lib/payments';
import { C } from '../lib/theme';

const GAP = 30;
const GROUPS = {
  all: { label: '🌍 All', cats: ['hotel', 'campsite', 'airbnb', 'activity', 'event', 'guide'] },
  stay: { label: '🛏️ Stay', cats: ['hotel', 'campsite', 'airbnb'] },
  activities: { label: '🎯 Activities & events', cats: ['activity', 'guide', 'event'] },
};

// Unpaid + pending bookings: the user can change the date and ADD pickup, items and add-ons. Nothing can be reduced.
export default function EditBooking({ route, navigation }) {
  const { id } = route.params;
  const { formatMoney } = useAuth();
  const [b, setB] = useState(undefined); const [l, setL] = useState(null); const [prices, setPrices] = useState([]); const [formItem, setFormItem] = useState(null);
  const [orig, setOrig] = useState({ guests: 1, days: 1, sel: {} }); const [kids, setKids] = useState([]);
  const [sel, setSel] = useState({}); const [guests, setGuests] = useState(1); const [days, setDays] = useState(1);
  const [start, setStart] = useState(new Date()); const [time, setTime] = useState('10:00'); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  // new pickup (only when the booking has none yet)
  const [addPickup, setAddPickup] = useState(false); const [pickup, setPickup] = useState(null); const [pickupTime, setPickupTime] = useState('08:00');
  const [vehicles, setVehicles] = useState([]); const [vid, setVid] = useState(null); const [km, setKm] = useState(null);
  // new add-ons
  const [group, setGroup] = useState('all'); const [near, setNear] = useState(null); const [chosen, setChosen] = useState({});

  useEffect(() => { (async () => {
    const { data: bk } = await supabase.from('bookings').select('*').eq('id', id).maybeSingle();
    if (!bk) return setB(null);
    const { data: li } = await supabase.from('listings').select('*').eq('id', bk.listing_id).single();
    const { data: items } = await supabase.from('booking_items').select('*').eq('booking_id', id);
    const { data: pr } = await supabase.from('listing_prices').select('*').eq('listing_id', bk.listing_id);
    const { data: ch } = await supabase.from('bookings').select('*, listings(title,category,duration_minutes)').eq('parent_booking_id', id);
    const s0 = Object.fromEntries((items || []).filter((i) => i.price_id).map((i) => [i.price_id, i.quantity]));
    setL(li); setPrices(pr || []); setKids(ch || []); setFormItem((items || []).find((i) => !i.price_id) || null);
    setSel(s0); setOrig({ guests: bk.guests || 1, days: bk.nights || 1, sel: s0 });
    setGuests(bk.guests || 1); setDays(bk.nights || 1); setNote(bk.note || '');
    setStart(new Date(bk.start_date + 'T12:00:00')); setTime(bk.start_time ? bk.start_time.slice(0, 5) : '10:00');
    setB(bk);
  })(); supabase.from('vehicles').select('*').eq('active', true).order('max_passengers').then(({ data }) => setVehicles(data || [])); }, [id]);

  useEffect(() => { if (!l) return; setNear(null);
    supabase.rpc('nearby_listings', { p_lat: l.lat, p_lng: l.lng, p_radius_km: 40, p_exclude: l.category, p_categories: GROUPS[group].cats.filter((c) => c !== l.category), lim: 15 })
      .then(({ data }) => setNear(data || [])); }, [l, group]);

  const fixedDate = !!l && (l.category === 'event' || ['one_time', 'tour'].includes(l.schedule_type));
  const endDate = () => { const e = new Date(start); e.setDate(e.getDate() + days - 1); return e; };
  const startDay = ymd(start); const endDay = ymd(endDate());
  const isAddon = !!b?.parent_booking_id; const hasPickup = !!b?.pickup_location;
  const canPickup = !!l && !isAddon && !hasPickup && ['guide', 'activity', 'event'].includes(l.category);
  const ratio = b && Number(b.subtotal) > 0 ? Number(b.discount || 0) / Number(b.subtotal) : 0;
  const calc = useMemo(() => {
    if (!b || !l) return { items: [], subtotal: 0, discount: 0, total: 0 };
    if (formItem) { const sub = Number(formItem.unit_price) * guests; return { items: [], subtotal: sub, discount: 0, total: sub }; }
    const c = computeTotal(sel, prices, days, null); const discount = Math.round(c.subtotal * ratio * 100) / 100;
    return { ...c, discount, total: c.subtotal - discount };
  }, [b, l, sel, prices, days, guests, formItem]);

  if (b === undefined) return <Loader />;
  if (!b || !l) return <Muted style={{ margin: 24 }}>This booking was not found.</Muted>;
  if (b.payment_status !== 'unpaid' || b.status !== 'pending') return <Muted style={{ margin: 24 }}>This booking can no longer be edited because it is {b.payment_status === 'paid' ? 'already paid' : b.status}.</Muted>;

  const v = vehicles.find((x) => x.id === vid && x.max_passengers >= guests);
  const tprice = addPickup && v && km != null ? transferPrice(v, km) : 0;
  const lineTotal = (c) => c.items.reduce((s, p) => s + Number(p.price) * (p.unit === 'per_group' ? 1 : guests) * (['per_night', 'per_day'].includes(p.unit) ? c.nights : 1), 0);
  const extras = Object.values(chosen); const extrasTotal = extras.reduce((s, c) => s + lineTotal(c), 0);
  const grand = calc.total + tprice + extrasTotal;
  const blockOf = (c) => { const s = abs(c.date, c.time); return { label: `“${c.l.title}”`, s, e: s + durationOf(c.info || c.l) }; };
  const kidBlocks = kids.map((k) => { const s = abs(k.start_date, (k.start_time || '09:00').slice(0, 5)); return { label: `“${k.listings?.title}”`, s, e: s + durationOf(k.listings) }; });

  /* ---------- checks ---------- */
  const problems = [];
  const dateChanged = startDay !== b.start_date;
  const sp = dateChanged || addPickup || extras.length ? scheduleProblem(l, startDay, time) : null; if (sp) problems.push(sp);
  if (addPickup) {
    if (!pickup) problems.push('Choose your pickup place.');
    if (!v) problems.push('Choose a vehicle that fits your group.');
    if (v && pickup && km == null) problems.push('Calculating your pickup price, please wait.');
    if (l.pickup_times?.length && !l.pickup_times.includes(pickupTime)) problems.push('Choose one of the host pickup times.');
    if (pickupTime >= time) problems.push('Pickup must be before the booking start time.');
    if (new Date(`${startDay}T${pickupTime}:00`).getTime() < Date.now() + 3600000) problems.push('Pickup must be at least 1 hour from now.');
  }
  extras.forEach((c) => {
    const p = c.info ? scheduleProblem(c.info, c.date, c.time) : null; if (p) problems.push(`${c.l.title}: ${p}`);
    if (c.date < startDay || c.date > endDay) problems.push(`${c.l.title}: choose a date between ${startDay} and ${endDay}.`);
  });
  addonClashes([], [...kidBlocks, ...extras.map(blockOf)], GAP).forEach((m) => problems.push(m));   // new add-ons also keep clear of existing ones
  const problem = problems[0];

  const bump = (pid, d) => setSel((s) => ({ ...s, [pid]: Math.max(orig.sel[pid] || 0, (s[pid] || 0) + d) }));   // never below what was booked
  const mine = async () => { const p = await getPosition(); if (!p) return; const i = await reverseInfo(p.lat, p.lng); setPickup({ lat: p.lat, lng: p.lng, label: i.label }); };
  const onMap = async () => { const r = await pickLocation(navigation, 'Choose your pickup location'); if (r) setPickup(r); };

  const toggle = async (x) => {
    if (chosen[x.id]) return setChosen(({ [x.id]: _, ...rest }) => rest);
    const { data: pr } = await supabase.from('listing_prices').select('*').eq('listing_id', x.id);
    const req = (pr || []).filter((p) => !p.is_optional); const picked = req.length ? req : (pr || []).sort((a, c) => a.price - c.price).slice(0, 1);
    const { data: info } = await supabase.from('listings').select('id,title,category,opening_hours,event_date,schedule_type,starts_on,ends_on,open_time,duration_minutes').eq('id', x.id).single();
    const ev = info && (info.category === 'event' || info.schedule_type === 'one_time') && info.event_date ? new Date(info.event_date) : null;
    const taken = [...kidBlocks, ...Object.values(chosen).map(blockOf)];
    const slot = ev ? { date: ymd(ev), time: hhmm(ev.getHours() * 60 + ev.getMinutes()) } : (freeSlot(taken, startDay, endDay, durationOf(info || x), GAP) || { date: startDay, time: '09:00' });
    setChosen((c) => ({ ...c, [x.id]: { l: x, info, items: picked, date: slot.date, time: slot.time, nights: 1, fixed: !!ev } }));
  };
  const setField = (xid, patch) => setChosen((c) => ({ ...c, [xid]: { ...c[xid], ...patch } }));

  const save = async (payNow) => {
    if (problems.length) return Alert.alert('Please check', problems.join('\n'));
    if (!formItem && !calc.items.length) return Alert.alert('Select at least one item');
    setBusy(true);
    try {
      const checks = [{ l, from: startDay, to: endDay, n: guests - orig.guests + (dateChanged ? orig.guests : 0) },
        ...extras.map((c) => ({ l: c.l, from: c.date, to: c.nights > 1 ? addDays(c.date, c.nights - 1) : c.date, n: guests }))];
      for (const x of checks) {
        if (x.n <= 0) continue;
        const { data: left } = await supabase.rpc('get_availability', { p_listing: x.l.id, p_start: x.from, p_end: x.to });
        if (typeof left === 'number' && left < x.n) throw new Error(`${x.l.title} has only ${left} places left for those dates.`);
      }
      let pkgId = b.package_id; const needPkg = addPickup || extras.length > 0;
      const pickAt = addPickup ? (() => { const [h, m] = pickupTime.split(':').map(Number); const d = new Date(`${startDay}T00:00:00`); d.setHours(h, m, 0, 0); return d.toISOString(); })() : null;
      let siblings = 0;
      if (pkgId) {
        const { data: sib } = await supabase.from('bookings').select('id,total').eq('package_id', pkgId).neq('id', id);
        siblings = (sib || []).reduce((s, x) => s + Number(x.total), 0);
      }
      const { data: pk0 } = pkgId ? await supabase.from('trip_packages').select('transfer_price').eq('id', pkgId).single() : { data: null };
      const transferTotal = Number(pk0?.transfer_price || 0) + tprice;
      const pkgTotal = calc.total + siblings + extrasTotal + transferTotal;
      if (needPkg && !pkgId) {
        const r = await supabase.from('trip_packages').insert({ user_id: b.user_id, people: guests, start_date: startDay, end_date: endDay, contact_phone: b.contact_phone || null, trip_type: addPickup ? 'oneway' : null,
          pickup_location: addPickup ? pickup.label : null, pickup_lat: addPickup ? pickup.lat : null, pickup_lng: addPickup ? pickup.lng : null, pickup_time: pickAt,
          vehicle_id: addPickup ? v.id : null, pickup_people: addPickup ? guests : null, distance_km: addPickup ? km : null, transfer_price: tprice, total: pkgTotal }).select().single();
        if (r.error) throw r.error; pkgId = r.data.id;
      } else if (pkgId) {
        const up = { people: Math.max(guests, 1), end_date: endDay, total: pkgTotal, transfer_price: transferTotal };
        if (addPickup) Object.assign(up, { trip_type: 'oneway', pickup_location: pickup.label, pickup_lat: pickup.lat, pickup_lng: pickup.lng, pickup_time: pickAt, vehicle_id: v.id, pickup_people: guests, distance_km: km });
        const r = await supabase.from('trip_packages').update(up).eq('id', pkgId); if (r.error) throw r.error;
      }
      const patch = { guests, start_date: startDay, end_date: endDay, nights: days, note: note || null, package_id: pkgId || null,
        subtotal: calc.subtotal, discount: calc.discount, total: calc.total };
      if (addPickup) Object.assign(patch, { trip_type: 'oneway', pickup_location: pickup.label, meeting_point: pickup.label, pickup_lat: pickup.lat, pickup_lng: pickup.lng, pickup_time: pickupTime + ':00' });
      const up = await supabase.from('bookings').update(patch).eq('id', id).eq('payment_status', 'unpaid').select().single(); if (up.error) throw up.error;
      const del = await supabase.from('booking_items').delete().eq('booking_id', id); if (del.error) throw del.error;
      const rows = formItem ? [{ booking_id: id, label: formItem.label, quantity: guests, unit_price: formItem.unit_price, amount: calc.total }] : calc.items.map((i) => ({ ...i, booking_id: id }));
      const ins = await supabase.from('booking_items').insert(rows); if (ins.error) throw ins.error;
      for (const c of extras) {                                             // new add-ons: no pickup fields
        const total = lineTotal(c); const end = c.nights > 1 ? addDays(c.date, c.nights - 1) : c.date;
        const r = await supabase.from('bookings').insert({ user_id: b.user_id, listing_id: c.l.id, package_id: pkgId, parent_booking_id: id, guests, start_date: c.date, end_date: end, nights: c.nights, start_time: c.time + ':00', contact_phone: b.contact_phone || null, subtotal: total, total }).select().single();
        if (r.error) throw r.error;
        await supabase.from('booking_items').insert(c.items.map((p) => ({ booking_id: r.data.id, price_id: p.id, label: p.label, quantity: guests, unit_price: p.price,
          amount: Number(p.price) * (p.unit === 'per_group' ? 1 : guests) * (['per_night', 'per_day'].includes(p.unit) ? c.nights : 1) })));
      }
      if (!payNow) { Alert.alert('Saved', 'Your changes are saved. Pay before the time shown in My bookings.'); navigation.goBack(); return; }
      choosePayment(navigation, pkgId ? { purpose: 'package', packageId: pkgId } : { purpose: 'booking', bookingId: id });
    } catch (e) { Alert.alert('Could not save', e.message); } finally { setBusy(false); }
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled" style={{ backgroundColor: '#fff' }}>
      <View style={{ backgroundColor: C.primary, padding: 16, paddingTop: 20 }}>
        <Text style={{ color: '#fff', fontSize: 22, fontWeight: '800' }}>Edit: {l.title}</Text>
        <Text style={{ color: '#fff', opacity: 0.9, marginTop: 4 }}>Change the date or add more. Nothing can be reduced.</Text>
      </View>

      {!formItem && prices.map((p) => (
        <Card key={p.id}><View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ flex: 1 }}><Text style={{ fontWeight: '600' }}>{p.label}</Text><Muted>{p.audience} · {p.unit.replace('_', ' ')} · {Number(p.price) === 0 ? 'Free' : formatMoney(p.price)}{orig.sel[p.id] ? ` · booked ${orig.sel[p.id]}` : ''}</Muted></View>
          <Btn title="−" kind="ghost" onPress={() => bump(p.id, -1)} disabled={(sel[p.id] || 0) <= (orig.sel[p.id] || 0)} /><Text style={{ width: 24, textAlign: 'center' }}>{sel[p.id] || 0}</Text><Btn title="+" kind="ghost" onPress={() => bump(p.id, 1)} />
        </View></Card>))}

      <View style={{ paddingHorizontal: 12 }}>
        <Label>Date</Label>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <DateField style={{ flex: 1, marginRight: 8 }} value={start} disabled={fixedDate} suffix={fixedDate ? ' (fixed date)' : ''} minimumDate={new Date()} onChange={setStart} />
          <Text style={{ fontWeight: '700', color: C.primary }}>🕒 {time}</Text>
        </View>
        {!formItem && !fixedDate && <Stepper label="Number of nights / days" value={days} onChange={(n) => setDays(Math.max(orig.days, n))} min={orig.days} max={30} />}
        <Stepper label="Guests" value={guests} onChange={(n) => setGuests(Math.max(orig.guests, n))} min={orig.guests} max={50} />

        {hasPickup && <Card style={{ marginHorizontal: 0 }}><Text style={{ fontWeight: '800' }}>🚐 Pickup (already booked)</Text><Muted>📍 {b.pickup_location}{b.pickup_time ? ` at ${b.pickup_time.slice(0, 5)}` : ''}. It can't be changed or removed.</Muted></Card>}
        {canPickup && (
          <Card style={{ marginHorizontal: 0 }}>
            <TouchableOpacity onPress={() => setAddPickup(!addPickup)} style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={{ fontSize: 22, marginRight: 8 }}>{addPickup ? '☑️' : '⬜'}</Text><View style={{ flex: 1 }}><Text style={{ fontWeight: '800' }}>🚐 Add a pickup</Text><Muted>For the main booking only, not for add-ons.</Muted></View>
            </TouchableOpacity>
            {addPickup && <>
              <View style={{ flexDirection: 'row' }}>
                <Btn style={{ flex: 1, marginRight: 4 }} kind="ghost" title="📍 My location" onPress={mine} />
                <Btn style={{ flex: 1, marginLeft: 4 }} kind="ghost" title="🗺️ Search / map" onPress={onMap} />
              </View>
              {pickup ? <Muted>📍 {pickup.label}</Muted> : null}
              <PickupTimeField times={l.pickup_times} value={pickupTime} onChange={setPickupTime} />
              <RoutePreview from={pickup} to={{ lat: l.lat, lng: l.lng }} onKm={setKm} />
              <Label>Vehicle</Label>
              {vehicles.map((x) => { const fits = x.max_passengers >= guests; return (
                <Card key={x.id} onPress={() => fits && setVid(x.id)} style={{ marginHorizontal: 0, opacity: fits ? 1 : 0.4, borderWidth: 2, borderColor: vid === x.id ? C.primary : C.border }}>
                  <Text style={{ fontWeight: '700' }}>{x.name} · max {x.max_passengers}</Text><Muted>{km != null ? `Total ${formatMoney(transferPrice(x, km))}` : 'Choose pickup to see the price'}</Muted></Card>); })}
              <Text style={{ fontWeight: '700', color: C.primary }}>Pickup total: {formatMoney(tprice)}</Text>
            </>}
          </Card>
        )}

        {!isAddon && <>
          <Label>Add more to your trip (optional)</Label>
          {kids.length > 0 && <Muted>Already added: {kids.map((k) => k.listings?.title).join(', ')}. These stay as booked.</Muted>}
          <Muted>Add-ons may happen during your main booking, but not at the same time as each other. Leave {GAP} minutes between them.</Muted>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 }}>{Object.entries(GROUPS).map(([k, g]) => <Chip key={k} label={g.label} active={group === k} onPress={() => setGroup(k)} />)}</View>
          {near === null ? <Loader /> : near.length === 0 ? <Muted style={{ textAlign: 'center', margin: 16 }}>Nothing nearby yet.</Muted> :
            near.filter((x) => !kids.some((k) => k.listing_id === x.id)).map((x) => { const c = chosen[x.id]; return (
              <Card key={x.id} onPress={() => toggle(x)} style={{ marginHorizontal: 0, borderWidth: 2, borderColor: c ? C.primary : C.border }}>
                <Text style={{ fontWeight: '700' }}>{c ? '☑️ ' : '⬜ '}{x.title}</Text>
                <Muted>{x.category} · {x.distance_km.toFixed(1)} km away · from {x.from_price != null ? formatMoney(x.from_price) : 'On request'}{c ? ' · tap to remove' : ''}</Muted>
                {c && <>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <DateField style={{ flex: 1, marginRight: 8 }} value={new Date(c.date + 'T12:00:00')} disabled={c.fixed} suffix={c.fixed ? ' (event date)' : ''}
                      minimumDate={new Date(startDay + 'T00:00:00')} maximumDate={new Date(endDay + 'T23:00:00')} onChange={(d) => setField(x.id, { date: ymd(d) })} />
                    {c.fixed ? <Text style={{ fontWeight: '700' }}>🕒 {c.time}</Text> : <TimeField value={c.time} onChange={(tm) => setField(x.id, { time: tm })} />}
                  </View>
                  {STAY.includes(x.category) && <Stepper label="Nights" value={c.nights} onChange={(n) => setField(x.id, { nights: n })} min={1} max={30} />}
                  <Muted>{formatMoney(lineTotal(c))} for {guests} {guests === 1 ? 'guest' : 'guests'}</Muted>
                </>}
              </Card>); })}
        </>}

        {problems.map((p, i) => <Text key={i} style={{ color: C.danger, fontWeight: '700', marginTop: 4 }}>⚠️ {p}</Text>)}
        <Label>Note to host</Label><Input multiline value={note} onChangeText={setNote} />

        <View style={{ marginVertical: 10, padding: 12, borderRadius: 12, backgroundColor: C.primary }}>
          <Text style={{ color: '#fff' }}>Booking: {formatMoney(calc.total)}</Text>
          {tprice > 0 && <Text style={{ color: '#fff' }}>New pickup: {formatMoney(tprice)}</Text>}
          {extras.map((c) => <Text key={c.l.id} style={{ color: '#fff' }}>{c.l.title}: {formatMoney(lineTotal(c))}</Text>)}
          <Text style={{ color: '#fff', fontSize: 22, fontWeight: '800', marginTop: 4 }}>This booking: {formatMoney(grand)}</Text>
        </View>
        <Btn title="Save and pay now" onPress={() => save(true)} disabled={busy || !!problem} />
        <Btn kind="ghost" title="Save changes (pay later)" onPress={() => save(false)} disabled={busy || !!problem} />
      </View><View style={{ height: 40 }} />
    </ScrollView>
  );
}