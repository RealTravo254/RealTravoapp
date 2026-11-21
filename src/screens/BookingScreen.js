import React, { useState, useMemo, useEffect } from 'react';
import { ScrollView, View, Text, Switch, Alert, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { Btn, Input, Label, Muted, Stepper } from '../components/ui';
import TimeField from '../components/TimeField';
import DateField from '../components/DateField';
import PickupTimeField from '../components/PickupTimeField';
import PhoneField from '../components/PhoneField';
import RoutePreview from '../components/RoutePreview';
import { getPosition, reverseInfo, getDistanceKm } from '../lib/geo';
import { pickLocation } from '../lib/pickBus';
import { computeTotal, bestOffer, ymd, scheduleProblem, transferPrice } from '../lib/pricing';
import { mainBlocks } from '../lib/schedule';
import { tr } from '../i18n';
import { isValidContactPhone } from '../lib/phone';
import { C } from '../lib/theme';

const CATEGORY_ICON = { hotel: 'bed', campsite: 'bonfire', attraction: 'camera', airbnb: 'home', event: 'ticket', transfer: 'car', guide: 'compass' };
const cap = (t) => (t ? String(t).charAt(0).toUpperCase() + String(t).slice(1) : '');

// Bookings that start within 12 hours are marked urgent automatically.
const URGENT_HOURS = 12;
const startsSoon = (day, t) => (new Date(`${day}T${t}:00`).getTime() - Date.now()) / 3600000 <= URGENT_HOURS;

/* ---------- small building blocks ---------- */
const Section = ({ icon, title, hint, right, children, style }) => (
  <View style={[s.section, style]}>
    <View style={s.sectionHead}>
      <View style={s.sectionIcon}><Ionicons name={icon} size={18} color={C.primary} /></View>
      <View style={{ flex: 1 }}>
        <Text style={s.sectionTitle}>{title}</Text>
        {hint ? <Text style={s.sectionHint}>{hint}</Text> : null}
      </View>
      {right}
    </View>
    {children}
  </View>
);

const Row = ({ label, children }) => (
  <View style={{ marginTop: 14 }}>
    <Text style={s.fieldLabel}>{label}</Text>
    {children}
  </View>
);

const Check = ({ on, onPress, disabled, children }) => (
  <TouchableOpacity disabled={disabled} onPress={onPress} activeOpacity={0.7} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, opacity: disabled ? 0.7 : 1 }}>
    <Ionicons name={on ? 'checkbox' : 'square-outline'} size={24} color={on ? C.primary : '#9AA7A1'} style={{ marginRight: 10 }} />
    <View style={{ flex: 1 }}>{children}</View>
  </TouchableOpacity>
);

const Seg = ({ options, value, onChange }) => (
  <View style={s.seg}>
    {options.map(([k, label]) => (
      <TouchableOpacity key={k} onPress={() => onChange(k)} activeOpacity={0.8} style={[s.segItem, value === k && s.segItemOn]}>
        <Text style={[s.segText, value === k && s.segTextOn]}>{label}</Text>
      </TouchableOpacity>
    ))}
  </View>
);

const Pill = ({ icon, text, bg, fg }) => (
  <View style={[s.pill, { backgroundColor: bg }]}>
    <Ionicons name={icon} size={14} color={fg} />
    <Text style={[s.pillText, { color: fg }]}>{text}</Text>
  </View>
);

// Step 1: items, date, time, guests, nights, and pickup / drop-off / return. Nothing is saved yet.
export default function BookingScreen({ route, navigation }) {
  const { listing, prices, offers, pickup: pre } = route.params; const { profile, formatMoney } = useAuth();
  const [sel, setSel] = useState({}); const [guests, setGuests] = useState(1);
  const [days, setDays] = useState(() => (listing.schedule_type === 'tour' && listing.starts_on && listing.ends_on ? Math.max(1, Math.round((new Date(listing.ends_on) - new Date(listing.starts_on)) / 86400000) + 1) : 1));
  const fixedStart = (listing.category === 'event' || listing.schedule_type === 'one_time') ? (listing.event_date ? new Date(listing.event_date) : null) : (listing.schedule_type === 'tour' && listing.starts_on ? new Date(listing.starts_on + 'T12:00:00') : null);
  const isEvent = !!fixedStart; const isTour = listing.schedule_type === 'tour'; const isRange = listing.schedule_type === 'range' && !!listing.starts_on;
  const rangeStart = isRange ? new Date(listing.starts_on + 'T00:00:00') : null;
  const [start, setStart] = useState(fixedStart || (rangeStart && rangeStart > new Date() ? rangeStart : new Date()));
  const [time, setTime] = useState(fixedStart && !isTour ? `${String(fixedStart.getHours()).padStart(2, '0')}:${String(fixedStart.getMinutes()).padStart(2, '0')}` : isTour && listing.open_time ? listing.open_time.slice(0, 5) : '10:00');
  const [urgent, setUrgent] = useState(false); const [note, setNote] = useState(''); const [useBalance, setUseBalance] = useState(false);
  const [contactPhone, setContactPhone] = useState('');
  const [left, setLeft] = useState(undefined);

  // pickup / drop-off / return: main booking only. It is the last section, unticked and closed
  // (guides need a meeting point, and a pickup chosen earlier opens it).
  const needsMeeting = true; const mustMeet = listing.category === 'guide';
  const [transfer, setTransfer] = useState(mustMeet || !!pre?.loc); const [open, setOpen] = useState(!!pre?.loc);
  const [tripType, setTripType] = useState('oneway');
  const [pickupLoc, setPickupLoc] = useState(pre?.loc || null); const [pickupTime, setPickupTime] = useState(pre?.time || null);
  const [sameDrop, setSameDrop] = useState(true); const [dropLoc, setDropLoc] = useState(null);
  const [returnDate, setReturnDate] = useState(null); const [returnTime, setReturnTime] = useState('17:00');
  const [vehicles, setVehicles] = useState([]); const [vid, setVid] = useState(null);
  const [km, setKm] = useState(null); const [kmDrop, setKmDrop] = useState(null);

  const offer = bestOffer(offers, start);
  const calc = useMemo(() => computeTotal(sel, prices, days, offer), [sel, days, start]);
  const bump = (id, d) => setSel((x) => ({ ...x, [id]: Math.max(0, (x[id] || 0) + d) }));
  const bal = Number(profile?.balance || 0);
  const endDate = () => { const e = new Date(start); e.setDate(e.getDate() + days - 1); return e; };
  const maxGuests = typeof left === 'number' ? Math.max(left, 1) : 99;
  const isReturn = transfer && tripType === 'return';
  const retDate = returnDate && returnDate >= start ? returnDate : endDate();
  const startDay = ymd(start); const endDay = ymd(endDate());
  const autoUrgent = startsSoon(startDay, time);   // starts within 12 hours
  const isUrgent = urgent || autoUrgent;

  useEffect(() => { if (!contactPhone && profile?.phone) setContactPhone(profile.phone); }, [profile?.phone]);
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
    if (!isValidContactPhone(contactPhone)) return Alert.alert('Phone number', 'Enter a valid phone number to continue.');
    if (!calc.items.length && !listing.entrance_fee_free) return Alert.alert('Select at least one item (activities can be skipped, but pick entrance / room / ticket)');
    navigation.navigate('AddOns', { listing, draft: {
      guests, start: startDay, end: endDay, days, time, urgent: urgent || startsSoon(startDay, time), note, contactPhone,
      transfer: transfer ? { tripType, pickup: pickupLoc, pickupTime, dropoff: isReturn ? (sameDrop ? pickupLoc : dropLoc) : null,
        returnDate: isReturn ? ymd(retDate) : null, returnTime: isReturn ? returnTime : null,
        vehicle: v ? { id: v.id } : null, km, kmDrop: isReturn ? (sameDrop ? km : kmDrop) : null, price: tprice } : null,
      items: calc.items, subtotal: calc.subtotal, discount: calc.discount, total: calc.total, useBalance } });
  };

  const LocBtns = ({ set, title, loc }) => (
    <>
      <View style={{ flexDirection: 'row' }}>
        <TouchableOpacity style={[s.locBtn, { marginRight: 6 }]} onPress={() => mine(set)} activeOpacity={0.7}>
          <Ionicons name="locate" size={16} color={C.primary} /><Text style={s.locBtnText}>My location</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.locBtn, { marginLeft: 6 }]} onPress={() => onMap(set, title)} activeOpacity={0.7}>
          <Ionicons name="map-outline" size={16} color={C.primary} /><Text style={s.locBtnText}>Search or map</Text>
        </TouchableOpacity>
      </View>
      {loc ? (
        <View style={s.locChosen}><Ionicons name="location" size={16} color={C.primary} /><Text style={s.locChosenText} numberOfLines={2}>{loc.label}</Text></View>
      ) : null}
    </>
  );

  const availability = left === undefined ? null
    : left === null ? <Pill icon="checkmark-circle" text="Available" bg="#E3F3EA" fg="#1E7A4C" />
    : left === 0 ? <Pill icon="close-circle" text="Fully booked for these dates" bg="#FBE7E5" fg={C.danger} />
    : <Pill icon="checkmark-circle" text={`${left} places left for these dates`} bg="#E3F3EA" fg="#1E7A4C" />;

  const picked = Object.values(sel).reduce((a, b) => a + b, 0);

  return (
    <View style={s.screen}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>
        {/* ---------- Header ---------- */}
        <View style={s.hero}>
          <View style={s.steps}>
            {['Details', 'Add-ons', 'Payment'].map((label, i) => (
              <View key={label} style={{ flex: 1, marginRight: i < 2 ? 6 : 0 }}>
                <View style={[s.stepBar, i === 0 && s.stepBarOn]} />
                <Text style={[s.stepLabel, i === 0 && s.stepLabelOn]}>{label}</Text>
              </View>
            ))}
          </View>
          <View style={s.heroRow}>
            <View style={s.heroIcon}><Ionicons name={CATEGORY_ICON[listing.category] || 'location'} size={26} color="#fff" /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.heroTitle} numberOfLines={2}>{listing.title}</Text>
              <Text style={s.heroSub}>{listing.category ? `${cap(listing.category)} · ` : ''}Choose your items, date and pickup</Text>
            </View>
          </View>
        </View>

        <View style={{ paddingHorizontal: 14 }}>
          {offer && (
            <View style={s.offer}>
              <Ionicons name="flame" size={20} color="#B45309" />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={s.offerTitle}>{offer.title}</Text>
                <Text style={s.offerSub}>{offer.percent_off}% off applied{calc.discount ? ` · you save ${formatMoney(calc.discount)}` : ''}</Text>
              </View>
            </View>
          )}

          {/* ---------- Items ---------- */}
          <Section icon="pricetags-outline" title="Select items" hint={picked ? `${picked} selected` : 'Pick what you want to book'}>
            {prices.map((p, i) => {
              const q = sel[p.id] || 0;
              return (
                <View key={p.id} style={[s.item, i > 0 && s.itemDivider]}>
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Text style={s.itemTitle}>{p.label}</Text>
                    <Text style={s.itemMeta}>{p.audience} · {p.unit.replace('_', ' ')}{p.is_optional ? ' · optional' : ''}</Text>
                    <Text style={s.itemPrice}>{Number(p.price) === 0 ? 'Free' : formatMoney(p.price)}</Text>
                  </View>
                  <View style={s.qty}>
                    <TouchableOpacity onPress={() => bump(p.id, -1)} style={[s.qtyBtn, q === 0 && { opacity: 0.4 }]} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Ionicons name="remove" size={18} color={C.primary} />
                    </TouchableOpacity>
                    <Text style={s.qtyNum}>{q}</Text>
                    <TouchableOpacity onPress={() => bump(p.id, 1)} style={[s.qtyBtn, s.qtyBtnOn]} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Ionicons name="add" size={18} color="#fff" />
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </Section>

          {/* ---------- Date, guests ---------- */}
          <Section icon="calendar-outline" title={`${tr('date')} and guests`} right={availability}>
            <Row label={`${tr('date')} and time`}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <DateField style={{ flex: 1, marginRight: 8 }} value={start} disabled={isEvent} suffix={isEvent ? ' (fixed date)' : ''}
                  minimumDate={rangeStart && rangeStart > new Date() ? rangeStart : new Date()}
                  maximumDate={isRange && listing.ends_on ? new Date(listing.ends_on + 'T23:00:00') : undefined} onChange={setStart} />
                {isEvent
                  ? <View style={s.fixedTime}><Ionicons name="time-outline" size={16} color={C.primary} /><Text style={s.fixedTimeText}>{time}</Text></View>
                  : <TimeField value={time} onChange={setTime} />}
              </View>
            </Row>
            <Stepper label={isTour ? 'Trip length (days)' : 'Number of nights / days'} value={days} onChange={setDays} min={isTour ? days : 1} max={isTour ? days : 30} />
            <Stepper label={tr('guests')} value={guests} onChange={setGuests} min={1} max={maxGuests} />
          </Section>

          {/* ---------- Contact ---------- */}
          <Section icon="person-circle-outline" title="Contact details" hint="The host uses this to reach you about your booking">
            <Row label="Contact phone number"><PhoneField country={profile?.country || ''} value={contactPhone} onChange={setContactPhone} /></Row>
            <Row label="Note to host"><Input multiline value={note} onChangeText={setNote} /></Row>
            <View style={s.switchRow}>
              <Ionicons name="flash-outline" size={20} color={isUrgent ? C.danger : C.primary} style={{ marginRight: 10 }} />
              <Text style={s.switchText}>{tr('urgent')}</Text>
              <Switch value={isUrgent} disabled={autoUrgent} onValueChange={setUrgent} trackColor={{ true: autoUrgent ? C.danger : C.primary }} />
            </View>
            {autoUrgent && (
              <View style={s.urgentNote}>
                <Ionicons name="flash" size={16} color={C.danger} />
                <Text style={s.urgentNoteText}>This booking starts within 12 hours, so it is marked urgent for the host automatically.</Text>
              </View>
            )}
            {bal > 0 && (
              <View style={s.switchRow}>
                <Ionicons name="wallet-outline" size={20} color={C.primary} style={{ marginRight: 10 }} />
                <Text style={s.switchText}>Use account balance ({formatMoney(bal)})</Text>
                <Switch value={useBalance} onValueChange={setUseBalance} trackColor={{ true: C.primary }} />
              </View>
            )}
          </Section>

          {/* ---------- Pickup and return (last section, unticked and closed until the guest ticks it) ---------- */}
          {needsMeeting && (
            <Section
              icon="car-outline"
              title={mustMeet ? 'Pickup and drop-off (required)' : 'Pickup and drop-off'}
              hint={transfer ? 'Choose pickup only or pickup with a return drop-off.' : 'Optional. Turn on to choose a pickup or drop-off.'}
              style={transfer ? { borderColor: C.primary, borderWidth: 1.5 } : null}
              right={<Switch value={transfer} disabled={mustMeet} onValueChange={(on) => { setTransfer(on); setOpen(on); }} trackColor={{ true: C.primary }} />}
            >
              {transfer && (
                <TouchableOpacity onPress={() => setOpen(!open)} activeOpacity={0.7} style={s.collapse}>
                  <Text style={s.collapseText} numberOfLines={1}>
                    {open ? 'Hide transfer details' : pickupLoc ? pickupLoc.label : 'Choose pickup place, time and vehicle'}
                    {!open && tprice > 0 ? ` · ${formatMoney(tprice)}` : ''}
                  </Text>
                  <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={C.primary} />
                </TouchableOpacity>
              )}
              {transfer && open && <>
                <Seg value={tripType} onChange={setTripType} options={[['oneway', 'Pickup only'], ['return', 'Pickup + drop-off']]} />
                <Row label="Pickup place"><LocBtns set={setPickupLoc} title="Choose your pickup location" loc={pickupLoc} /></Row>
                <Row label="Pickup time"><PickupTimeField times={listing.pickup_times} value={pickupTime} onChange={setPickupTime} /></Row>
                <View style={{ marginTop: 10 }}><RoutePreview from={pickupLoc} to={{ lat: listing.lat, lng: listing.lng }} onKm={setKm} /></View>
                {isReturn && <>
                  <Check on={sameDrop} onPress={() => setSameDrop(!sameDrop)}><Text style={{ color: '#14231C' }}>Drop me back at the pickup place</Text></Check>
                  {!sameDrop && <Row label="Drop-off place"><LocBtns set={setDropLoc} title="Choose your drop-off location" loc={dropLoc} /></Row>}
                  <Row label="Return date and time">
                    <View style={{ flexDirection: 'row' }}>
                      <DateField style={{ flex: 1, marginRight: 8 }} value={retDate} minimumDate={start} onChange={setReturnDate} />
                      <TimeField value={returnTime} onChange={setReturnTime} />
                    </View>
                  </Row>
                </>}
                <Row label={needVehicle ? 'Vehicle' : 'Vehicle (optional)'}>
                  {vehicles.map((x) => {
                    const fits = x.max_passengers >= guests; const on = vid === x.id;
                    return (
                      <TouchableOpacity key={x.id} disabled={!fits} activeOpacity={0.8} onPress={() => setVid(on && !needVehicle ? null : x.id)}
                        style={[s.vehicle, on && s.vehicleOn, !fits && { opacity: 0.4 }]}>
                        <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={20} color={on ? C.primary : '#9AA7A1'} style={{ marginRight: 10 }} />
                        <View style={{ flex: 1 }}>
                          <Text style={s.itemTitle}>{x.name}</Text>
                          <Text style={s.itemMeta}>Up to {x.max_passengers} · {formatMoney(x.price_per_km)}/km + {formatMoney(x.base_fee)}</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </Row>
                <View style={s.transferPrice}>
                  <Text style={s.transferPriceLabel}>Transfer price{isReturn ? ' (both ways)' : ''}{km != null ? ` · ${km} km` : ''}</Text>
                  <Text style={s.transferPriceValue}>{formatMoney(tprice)}</Text>
                </View>
                <Text style={s.sectionHint}>The host sees the pickup, drop-off and return in the booking, email and notification.</Text>
              </>}
            </Section>
          )}

          {problems.length > 0 && (
            <View style={s.problems}>
              <Ionicons name="alert-circle" size={20} color={C.danger} style={{ marginRight: 10, marginTop: 1 }} />
              <View style={{ flex: 1 }}>
                <Text style={s.problemsTitle}>Fix before you continue</Text>
                {problems.map((p, i) => <Text key={i} style={s.problemsText}>{p}</Text>)}
              </View>
            </View>
          )}

          <Muted style={{ textAlign: 'center', marginTop: 6 }}>Next you can add stopovers, stays and activities, then pay now or pay later.</Muted>
        </View>
      </ScrollView>

      {/* ---------- Sticky total bar ---------- */}
      <View style={s.footer}>
        <View style={{ flex: 1 }}>
          <Text style={s.footerLabel}>{tr('total')}</Text>
          <Text style={s.footerTotal}>{formatMoney(grandTotal)}</Text>
          <Text style={s.footerBreak} numberOfLines={1}>
            Booking {formatMoney(calc.total)}{transfer ? ` · Transfer ${formatMoney(tprice)}` : ''}
          </Text>
        </View>
        <View style={{ width: 150 }}>
          <Btn title="Continue" onPress={next} disabled={left === 0 || !!problem} />
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F6F8F7' },

  hero: { backgroundColor: C.primary, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 26, borderBottomLeftRadius: 26, borderBottomRightRadius: 26, marginBottom: 14 },
  steps: { flexDirection: 'row', marginBottom: 18 },
  stepBar: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.28)' },
  stepBarOn: { backgroundColor: '#fff' },
  stepLabel: { color: 'rgba(255,255,255,0.65)', fontSize: 12, marginTop: 6 },
  stepLabelOn: { color: '#fff', fontWeight: '700' },
  heroRow: { flexDirection: 'row', alignItems: 'center' },
  heroIcon: { width: 52, height: 52, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  heroTitle: { color: '#fff', fontSize: 22, fontWeight: '800', lineHeight: 27 },
  heroSub: { color: 'rgba(255,255,255,0.85)', fontSize: 13.5, marginTop: 3 },

  offer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF3DC', borderRadius: 14, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#F6DDA5' },
  offerTitle: { color: '#7A4A0B', fontWeight: '800', fontSize: 14 },
  offerSub: { color: '#9A6420', fontSize: 12.5, marginTop: 1 },

  section: { backgroundColor: '#fff', borderRadius: 18, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: C.border },
  sectionHead: { flexDirection: 'row', alignItems: 'center' },
  sectionIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: '#E3EDE8', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: '#14231C' },
  sectionHint: { fontSize: 12.5, color: '#6B7A73', marginTop: 2, lineHeight: 17 },
  fieldLabel: { fontSize: 13, fontWeight: '700', color: '#3B4A43', marginBottom: 6 },

  pill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 14, maxWidth: 150 },
  pillText: { fontSize: 11.5, fontWeight: '700', marginLeft: 4, flexShrink: 1 },

  item: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  itemDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  itemTitle: { fontSize: 15, fontWeight: '700', color: '#14231C' },
  itemMeta: { fontSize: 12.5, color: '#6B7A73', marginTop: 2 },
  itemPrice: { fontSize: 14, fontWeight: '800', color: C.primary, marginTop: 4 },
  qty: { flexDirection: 'row', alignItems: 'center' },
  qtyBtn: { width: 32, height: 32, borderRadius: 16, borderWidth: 1.5, borderColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  qtyBtnOn: { backgroundColor: C.primary },
  qtyNum: { minWidth: 30, textAlign: 'center', fontSize: 16, fontWeight: '800', color: '#14231C' },

  fixedTime: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#E3EDE8', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  fixedTimeText: { color: C.primary, fontWeight: '800', marginLeft: 6 },

  switchRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
  switchText: { flex: 1, color: '#14231C', fontSize: 14.5 },

  collapse: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F2F8F5', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, marginTop: 12 },
  collapseText: { flex: 1, color: C.primary, fontWeight: '700', fontSize: 13.5, marginRight: 8 },

  seg: { flexDirection: 'row', backgroundColor: '#EEF1EF', borderRadius: 12, padding: 3, marginTop: 14 },
  segItem: { flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center' },
  segItemOn: { backgroundColor: '#fff' },
  segText: { color: '#6B7A73', fontWeight: '600', fontSize: 13.5 },
  segTextOn: { color: C.primary, fontWeight: '800' },

  locBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 11, borderRadius: 12, borderWidth: 1.5, borderColor: C.border, backgroundColor: '#fff' },
  locBtnText: { color: C.primary, fontWeight: '700', marginLeft: 6, fontSize: 13.5 },
  locChosen: { flexDirection: 'row', alignItems: 'center', marginTop: 8, backgroundColor: '#F2F8F5', borderRadius: 10, padding: 10 },
  locChosenText: { flex: 1, marginLeft: 6, color: '#14231C', fontSize: 13 },

  vehicle: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 14, borderWidth: 1.5, borderColor: C.border, marginBottom: 8, backgroundColor: '#fff' },
  vehicleOn: { borderColor: C.primary, backgroundColor: '#F2F8F5' },
  transferPrice: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#E3EDE8', borderRadius: 12, padding: 12, marginTop: 6, marginBottom: 8 },
  transferPriceLabel: { flex: 1, color: '#14231C', fontWeight: '600', fontSize: 13.5 },
  transferPriceValue: { color: C.primary, fontWeight: '800', fontSize: 16 },

  urgentNote: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FDF1F0', borderRadius: 10, padding: 10, marginTop: 10 },
  urgentNoteText: { flex: 1, marginLeft: 8, color: '#8A2B22', fontSize: 12.5, lineHeight: 17 },

  problems: { flexDirection: 'row', backgroundColor: '#FDF1F0', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: '#F3C9C5', marginBottom: 10 },
  problemsTitle: { color: C.danger, fontWeight: '800', fontSize: 14, marginBottom: 2 },
  problemsText: { color: '#8A2B22', fontSize: 13, lineHeight: 18, marginTop: 2 },

  footer: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 18, backgroundColor: '#fff', borderTopWidth: 1, borderColor: C.border },
  footerLabel: { fontSize: 12, color: '#6B7A73' },
  footerTotal: { fontSize: 22, fontWeight: '800', color: '#14231C' },
  footerBreak: { fontSize: 11.5, color: '#8A9892', marginTop: 1 },
});