import React, { useEffect, useState } from 'react';
import { ScrollView, View, Text, Alert } from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { Btn, Card, Muted, Chip, H, Loader, Stepper } from '../components/ui';
import TimeField from '../components/TimeField';
import DateField from '../components/DateField';
import { scheduleProblem, ymd } from '../lib/pricing';
import { abs, durationOf, hhmm, addDays, freeSlot, mainBlocks, addonClashes, overlapsBase, STAY } from '../lib/schedule';
import { startPayment } from '../lib/payments';
import { C } from '../lib/theme';

// Last step (also reachable from My Trips): stopovers, stays, activities and events.
// No pickup here: pickup, drop-off and return belong to the main booking only.
const GROUPS = {
  all: { label: '🌍 All', cats: ['hotel', 'campsite', 'attraction', 'airbnb', 'activity', 'event', 'guide'] },
  stopover: { label: '🛑 Stopover', cats: ['attraction', 'activity', 'campsite'] },
  stay: { label: '🛏️ Stay', cats: ['hotel', 'campsite', 'airbnb'] },
  activities: { label: '🎯 Activities & events', cats: ['activity', 'attraction', 'guide', 'event'] },
};
const GAP = 30; // minutes between add-ons

export default function AddOns({ route, navigation }) {
  const { session, formatMoney } = useAuth();
  const { listing, draft, main } = route.params;          // draft = not saved yet, main = already saved booking
  const guests = draft?.guests || main.guests; const date = draft?.start || main.start_date; const endDate = draft?.end || main.end_date; const nights = draft?.days || main.nights || 1;
  const mainTime = draft?.time || (main?.start_time ? main.start_time.slice(0, 5) : '10:00');
  const useBalance = draft?.useBalance;
  const t = draft ? draft.transfer : (main?.pickup_time ? { pickupTime: main.pickup_time.slice(0, 5), returnDate: main.return_date || null, returnTime: main.return_time ? main.return_time.slice(0, 5) : null } : null);
  const lastDay = t?.returnDate && t.returnDate > endDate ? t.returnDate : endDate;
  const { blocks: baseBlocks } = mainBlocks(listing, date, endDate, mainTime, t);   // main booking, pickup, return trip

  const [group, setGroup] = useState('all'); const [near, setNear] = useState(null); const [chosen, setChosen] = useState({}); const [busy, setBusy] = useState(false);
  useEffect(() => { setNear(null);
    supabase.rpc('nearby_listings', { p_lat: listing.lat, p_lng: listing.lng, p_radius_km: 40, p_exclude: listing.category, p_categories: GROUPS[group].cats.filter((c) => c !== listing.category), lim: 15 })
      .then(({ data }) => setNear(data || [])); }, [group]);

  const blockOf = (c) => { const s = abs(c.date, c.time); return { label: `“${c.l.title}”`, s, e: s + durationOf(c.info || c.l) }; };

  const toggle = async (l) => {
    if (chosen[l.id]) return setChosen(({ [l.id]: _, ...rest }) => rest);           // untick
    const { data: prices } = await supabase.from('listing_prices').select('*').eq('listing_id', l.id);
    const req = (prices || []).filter((p) => !p.is_optional); const picked = req.length ? req : (prices || []).sort((a, b) => a.price - b.price).slice(0, 1);
    const { data: info } = await supabase.from('listings').select('id,title,category,opening_hours,event_date,schedule_type,starts_on,ends_on,open_time,duration_minutes').eq('id', l.id).single();
    const ev = info && (info.category === 'event' || info.schedule_type === 'one_time') && info.event_date ? new Date(info.event_date) : null;
    const taken = Object.values(chosen).map(blockOf);        // only other add-ons matter
    const slot = ev ? { date: ymd(ev), time: hhmm(ev.getHours() * 60 + ev.getMinutes()) } : (freeSlot(taken, date, lastDay, durationOf(info || l), GAP) || { date, time: '09:00' });
    setChosen((c) => ({ ...c, [l.id]: { l, info, items: picked, date: slot.date, time: slot.time, nights: 1, fixed: !!ev } }));
  };
  const setField = (id, patch) => setChosen((c) => ({ ...c, [id]: { ...c[id], ...patch } }));
  const lineTotal = (c) => c.items.reduce((s, p) => s + Number(p.price) * (p.unit === 'per_group' ? 1 : guests) * (['per_night', 'per_day'].includes(p.unit) ? c.nights : 1), 0);
  const extras = Object.values(chosen);
  const extrasTotal = extras.reduce((s, c) => s + lineTotal(c), 0);
  const transferPrice = t?.price || 0;
  const grand = (draft?.total || 0) + transferPrice + extrasTotal;

  /* ---------- checks: dates, opening hours, and add-ons not clashing with each other ---------- */
  const problems = [];
  extras.forEach((c) => {
    const p = c.info ? scheduleProblem(c.info, c.date, c.time) : null; if (p) problems.push(`${c.l.title}: ${p}`);
    if (c.date < date || c.date > lastDay) problems.push(`${c.l.title}: choose a date between ${date} and ${lastDay}.`);
  });
  addonClashes(baseBlocks, extras.map(blockOf), GAP).forEach((m) => problems.push(m));

  const toTrips = () => { navigation.popToTop(); navigation.navigate('Tabs', { screen: 'Trips', params: { tab: 'pending', ts: Date.now() } }); };

  const save = async (payNow) => {
    if (problems.length) return Alert.alert('Please check', problems.join('\n'));
    const needPkg = extras.length > 0 || !!t?.vehicle;
    if (!draft && !needPkg) return navigation.popToTop();
    setBusy(true);
    try {
      const toCheck = [...(draft ? [{ l: listing, from: date, to: endDate }] : []), ...extras.map((c) => ({ l: c.l, from: c.date, to: c.nights > 1 ? addDays(c.date, c.nights - 1) : c.date }))];
      for (const x of toCheck) {
        const { data: left } = await supabase.rpc('get_availability', { p_listing: x.l.id, p_start: x.from, p_end: x.to });
        if (typeof left === 'number' && left < guests) throw new Error(`${x.l.title} has only ${left} places left for those dates.`);
      }
      let pkg = null;
      if (needPkg) {
        let pickAt = null; if (t) { const [h, m] = t.pickupTime.split(':').map(Number); const pt = new Date(`${date}T00:00:00`); pt.setHours(h, m, 0, 0); pickAt = pt.toISOString(); }
        const r = await supabase.from('trip_packages').insert({ user_id: session.user.id, people: guests, start_date: date, end_date: endDate,
          trip_type: t?.tripType || null,
          pickup_location: t?.pickup?.label || null, pickup_lat: t?.pickup?.lat ?? null, pickup_lng: t?.pickup?.lng ?? null, pickup_time: pickAt,
          dropoff_location: t?.dropoff?.label || null, dropoff_lat: t?.dropoff?.lat ?? null, dropoff_lng: t?.dropoff?.lng ?? null,
          return_date: t?.returnDate || null, return_time: t?.returnTime ? t.returnTime + ':00' : null,
          vehicle_id: t?.vehicle?.id || null, pickup_people: t?.vehicle ? guests : null, distance_km: t?.km ?? null, transfer_price: transferPrice, total: grand }).select().single();
        if (r.error) throw r.error; pkg = r.data;
      }
      let mainRow = main;
      if (draft) {
        const r = await supabase.from('bookings').insert({ user_id: session.user.id, listing_id: listing.id, package_id: pkg?.id || null, urgent: draft.urgent, guests, start_date: date, end_date: endDate, nights,
          start_time: mainTime + ':00', note: draft.note, subtotal: draft.subtotal, discount: draft.discount, total: draft.total,
          // pickup, drop-off and return are saved on the main booking only
          trip_type: t?.tripType || null,
          pickup_location: t?.pickup?.label || null, meeting_point: t?.pickup?.label || null, pickup_lat: t?.pickup?.lat ?? null, pickup_lng: t?.pickup?.lng ?? null, pickup_time: t ? t.pickupTime + ':00' : null,
          return_date: t?.returnDate || null, return_time: t?.returnTime ? t.returnTime + ':00' : null }).select().single();
        if (r.error) throw r.error; mainRow = r.data;
        if (t?.dropoff) { const dr = await supabase.from('booking_dropoffs').insert({ booking_id: mainRow.id, user_id: session.user.id, dropoff_location: t.dropoff.label, dropoff_lat: t.dropoff.lat, dropoff_lng: t.dropoff.lng }); if (dr.error) throw dr.error; }
        if (draft.items.length) await supabase.from('booking_items').insert(draft.items.map((i) => ({ ...i, booking_id: mainRow.id })));
      }
      for (const c of extras) {
        const total = lineTotal(c); const end = c.nights > 1 ? addDays(c.date, c.nights - 1) : c.date;
        const r = await supabase.from('bookings').insert({ user_id: session.user.id, listing_id: c.l.id, package_id: pkg.id, parent_booking_id: mainRow.id, guests, start_date: c.date, end_date: end, nights: c.nights,
          start_time: c.time + ':00', subtotal: total, total }).select().single();        // no pickup fields on add-ons
        if (r.error) throw r.error;
        await supabase.from('booking_items').insert(c.items.map((p) => ({ booking_id: r.data.id, price_id: p.id, label: p.label, quantity: guests, unit_price: p.price,
          amount: Number(p.price) * (p.unit === 'per_group' ? 1 : guests) * (['per_night', 'per_day'].includes(p.unit) ? c.nights : 1) })));
      }
      if (!payNow) { Alert.alert('Saved in My bookings', 'Pay before the time shown there, or the booking is cancelled automatically.'); toTrips(); return; }
      const p = pkg ? await startPayment({ purpose: 'package', packageId: pkg.id }) : await startPayment({ purpose: 'booking', bookingId: mainRow.id, useBalance });
      if (p.paid_with_balance) { Alert.alert('Booked', 'Paid from your balance.'); toTrips(); return; }
      navigation.replace('Pay', { url: p.authorization_url });
    } catch (e) { Alert.alert('Could not save', e.message); } finally { setBusy(false); }
  };

  return (
    <ScrollView keyboardShouldPersistTaps="handled">
      <H>Complete your trip</H>
      <Muted style={{ marginHorizontal: 12 }}>Main booking: {listing.title} on {date} at {mainTime}{t ? `, pickup at ${t.pickupTime}` : ''}{t?.returnDate ? `, return ${t.returnDate} at ${t.returnTime}` : ''}. Tick what you want and untick to remove. ℹ️ Add-ons can happen during your main booking (for example, going out while you stay), but not at the same time as each other. Leave {GAP} minutes between add-ons.</Muted>

      <View style={{ flexDirection: 'row', paddingHorizontal: 12, flexWrap: 'wrap' }}>{Object.entries(GROUPS).map(([k, g]) => <Chip key={k} label={g.label} active={group === k} onPress={() => setGroup(k)} />)}</View>
      <Muted style={{ marginHorizontal: 12, marginTop: 6 }}>Within 40 km of {listing.title}. Dates from {date} to {lastDay}.</Muted>
      {near === null ? <Loader /> : near.length === 0 ? <Muted style={{ textAlign: 'center', margin: 20 }}>Nothing nearby yet.</Muted> :
        near.map((l) => { const c = chosen[l.id]; return (
          <Card key={l.id} onPress={() => toggle(l)} style={{ borderWidth: 2, borderColor: c ? C.primary : C.border }}>
            <Text style={{ fontWeight: '700' }}>{c ? '☑️ ' : '⬜ '}{l.title}</Text>
            <Muted>{l.category} · {l.distance_km.toFixed(1)} km away · from {l.from_price != null ? formatMoney(l.from_price) : 'On request'}{c ? ' · tap to remove' : ''}</Muted>
            {c && <>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <DateField style={{ flex: 1, marginRight: 8 }} value={new Date(c.date + 'T12:00:00')} disabled={c.fixed} suffix={c.fixed ? ' (event date)' : ''}
                  minimumDate={new Date(date + 'T00:00:00')} maximumDate={new Date(lastDay + 'T23:00:00')} onChange={(d) => setField(l.id, { date: ymd(d) })} />
                {c.fixed ? <Text style={{ fontWeight: '700' }}>🕒 {c.time}</Text> : <TimeField value={c.time} onChange={(x) => setField(l.id, { time: x })} />}
              </View>
              {STAY.includes(l.category) && <Stepper label="Nights" value={c.nights} onChange={(n) => setField(l.id, { nights: n })} min={1} max={30} />}
              <Muted>{formatMoney(lineTotal(c))} for {guests} {guests === 1 ? 'guest' : 'guests'}</Muted>
              {overlapsBase(blockOf(c), baseBlocks) && <Muted style={{ color: C.ok }}>ℹ️ This is during your main booking. That's allowed.</Muted>}
            </>}
          </Card>); })}

      <View style={{ margin: 12 }}>
        {problems.map((p, i) => <Text key={i} style={{ color: C.danger, fontWeight: '700', marginBottom: 4 }}>⚠️ {p}</Text>)}
        {draft && <Text>Main booking: {formatMoney(draft.total)}</Text>}
        {transferPrice > 0 && <Text>Transfer: {formatMoney(transferPrice)}</Text>}
        <Text>Add-ons: {formatMoney(extrasTotal)}</Text>
        <Text style={{ fontSize: 22, fontWeight: '800', marginVertical: 6 }}>Total: {formatMoney(grand)}</Text>
        <Btn title="Pay now" onPress={() => save(true)} disabled={busy || problems.length > 0} />
        <Btn kind="ghost" title="Pay later (saved in My Trips)" onPress={() => save(false)} disabled={busy || problems.length > 0} />
        <Muted style={{ marginTop: 4 }}>If you leave this screen without choosing, nothing is saved.</Muted>
      </View>
      <View style={{ height: 30 }} />
    </ScrollView>
  );
}
