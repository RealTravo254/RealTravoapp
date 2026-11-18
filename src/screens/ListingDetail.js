import React, { useEffect, useState } from 'react';
import { ScrollView, View, Text, Image, Linking, Alert, Dimensions, TouchableOpacity } from 'react-native';
import MapView, { Marker } from '../components/SafeMap';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { Btn, Card, H, Muted, Loader, SaveButton } from '../components/ui';
import ShareButton from '../components/ShareButton';
import Img from '../components/Img';
import { bestOffer, ymd } from '../lib/pricing';
import { DAYS, DAY_NAMES } from '../lib/categories';
import { tr } from '../i18n';
import { startPayment } from '../lib/payments';
import { C } from '../lib/theme';

const W = Dimensions.get('window').width;
const BAR_KINDS = { hotel: ['room'], airbnb: ['room'], campsite: ['entrance'], attraction: ['entrance'], activity: ['activity', 'ticket'], event: ['ticket'], guide: ['guide'] };
const PER = { per_night: '/ night', per_person: '/ person', per_group: '/ group', per_day: '/ day' };

// What the fixed bottom bar shows: price, entrance fee or tickets, depending on the category
function barInfo(l, prices) {
  let pool = prices.filter((p) => (BAR_KINDS[l.category] || []).includes(p.kind));
  if (!pool.length) pool = prices;
  const min = pool.length ? Math.min(...pool.map((p) => Number(p.price))) : null;
  const per = PER[pool.find((p) => Number(p.price) === min)?.unit] || '';
  if (['campsite', 'attraction'].includes(l.category)) {
    if (l.entrance_fee_free || min === 0) return { label: 'Entrance fee', value: 'Free', per: '' };
    return min === null ? { label: 'Entrance fee', value: 'On request', per: '' } : { label: 'Entrance from', value: `$${min}`, per };
  }
  if (min === null) return { label: 'Price', value: 'On request', per: '' };
  return { label: l.category === 'event' ? 'Tickets from' : 'From', value: min === 0 ? 'Free' : `$${min}`, per };
}
const today = () => ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date().getDay()];

export default function ListingDetail({ route, navigation }) {
  const { id } = route.params; const { session, subscribed, ensureLogin, isProvider } = useAuth(); const insets = useSafeAreaInsets();
  const [l, setL] = useState(null); const [prices, setPrices] = useState([]); const [offers, setOffers] = useState([]);
  const [reviews, setReviews] = useState([]); const [contact, setContact] = useState(null);
  const [slide, setSlide] = useState(0); const [left, setLeft] = useState(null);

  useEffect(() => {
    (async () => {
      const [a, b, c, d] = await Promise.all([
        supabase.from('listings').select('*, providers(business_name)').eq('id', id).single(),
        supabase.from('listing_prices').select('*').eq('listing_id', id).order('kind'),
        supabase.from('offers').select('*').eq('listing_id', id),
        supabase.from('reviews').select('rating,comment,created_at').eq('listing_id', id).order('created_at', { ascending: false }).limit(10)]);
      setL(a.data); setPrices(b.data || []); setOffers(c.data || []); setReviews(d.data || []);
      const day = ymd(new Date());
      supabase.rpc('get_availability', { p_listing: id, p_start: day, p_end: day }).then(({ data }) => setLeft(data));
      if (session) { const r = await supabase.rpc('get_listing_contact', { p_listing: id }); if (!r.error) setContact(r.data); }
    })();
  }, [id, session?.user?.id]);

  const subscribe = () => navigation.navigate('Subscription'); // host subscription is paid with an M-Pesa prompt
  const book = () => { if (ensureLogin(navigation, 'book')) navigation.navigate('Booking', { listing: l, prices, offers }); };

  if (!l) return <Loader />;
  const offer = bestOffer(offers);
  const bar = barInfo(l, prices);
  const photos = l.photos.length ? l.photos : [null];
  const extras = prices.filter((p) => ['facility', 'activity'].includes(p.kind));
  const plain = prices.filter((p) => !['facility', 'activity'].includes(p.kind));
  const hours = (d) => l.opening_hours?.[d] ?? (l.open_days?.includes(d) ? { open: l.open_time?.slice(0, 5), close: l.close_time?.slice(0, 5) } : { closed: true });

  const fmt = (x) => new Date(x + 'T12:00:00').toDateString();
  const sched = l.category === 'event' || l.schedule_type === 'one_time' ? { t: 'Happens once', v: l.event_date ? new Date(l.event_date).toLocaleString() : 'Date to be announced' }
    : l.schedule_type === 'tour' && l.starts_on ? { t: 'Tour / trip', v: `${fmt(l.starts_on)} → ${fmt(l.ends_on || l.starts_on)}${l.open_time ? ` · departs ${l.open_time.slice(0, 5)}` : ''}` }
    : l.schedule_type === 'range' && l.starts_on ? { t: 'Available between', v: `${fmt(l.starts_on)} → ${fmt(l.ends_on || l.starts_on)}` } : null;
  const scheduleCard = sched ? <Card><View style={{ flexDirection: 'row', alignItems: 'center' }}><Ionicons name="calendar" size={20} color={C.primary} /><Text style={{ fontWeight: '800', marginLeft: 8 }}>{sched.t}</Text></View><Text style={{ marginTop: 4 }}>{sched.v}</Text></Card> : null;
  const priceLine = (p) => `${Number(p.price) === 0 ? 'Free' : `$${p.price}`} · ${p.audience} · ${p.unit.replace('_', ' ')}`;
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 110 + insets.bottom }}>
        <View>
          <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} onMomentumScrollEnd={(e) => setSlide(Math.round(e.nativeEvent.contentOffset.x / W))}>
            {photos.map((u, i) => <Img key={i} uri={u} category={l.category} style={{ width: W, height: 240 }} />)}
          </ScrollView>
          <SaveButton id={l.id} /><ShareButton item={l} />
          {photos.length > 1 && <View style={{ position: 'absolute', bottom: 12, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center' }}>
            {photos.map((_, i) => <View key={i} style={{ width: i === slide ? 20 : 7, height: 7, borderRadius: 4, marginHorizontal: 3, backgroundColor: i === slide ? '#fff' : 'rgba(255,255,255,0.55)' }} />)}</View>}
        </View>
        <H>{l.title}</H>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 12, marginBottom: 2 }}><Ionicons name="person-circle-outline" size={20} color={C.primary} /><Text style={{ marginLeft: 6, color: C.muted }}>Hosted by <Text style={{ fontWeight: '800', color: C.text }}>{l.providers?.business_name || 'Host'}</Text></Text></View>
        <Muted style={{ marginHorizontal: 12 }}>{l.category} · {l.location_name || l.region}, {l.country} · ⭐ {Number(l.rating_avg).toFixed(1)} ({l.rating_count})</Muted>
        {offer && <Card style={{ backgroundColor: '#FFF4E5' }}><Text style={{ fontWeight: '700' }}>🔥 {offer.title}: {offer.percent_off}% off</Text></Card>}
        <Card><Text>{l.description}</Text></Card>

        {l.facilities?.length > 0 && <Card><Text style={{ fontWeight: '800', marginBottom: 8 }}>Amenities</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{l.facilities.map((a) => (
            <View key={a} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#E3EDE8', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 5, margin: 3 }}>
              <Ionicons name="checkmark-circle" size={15} color={C.primary} /><Text style={{ marginLeft: 4 }}>{a}</Text></View>))}</View></Card>}

        {scheduleCard}
        {l.pickup_times?.length > 0 && <Card><View style={{ flexDirection: 'row', alignItems: 'center' }}><Ionicons name="car" size={20} color={C.primary} /><Text style={{ fontWeight: '800', marginLeft: 8 }}>Pickup times</Text></View><Text style={{ marginTop: 4 }}>{l.pickup_times.join('  ·  ')}</Text></Card>}
        {!['tour', 'one_time'].includes(l.schedule_type) && l.category !== 'event' && <Card>
          <Text style={{ fontWeight: '800', marginBottom: 6 }}>Opening hours</Text>
          {DAYS.map((d) => { const h = hours(d); const t = d === today();
            return (<View key={d} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
              <Text style={{ fontWeight: t ? '800' : '400' }}>{DAY_NAMES[d]}{t ? ' (today)' : ''}</Text>
              <Text style={{ fontWeight: t ? '800' : '400', color: h.closed ? C.danger : C.text }}>{h.closed ? 'Closed' : `${h.open} – ${h.close}`}</Text></View>); })}
          {l.entrance_fee_free && <Text style={{ color: C.ok, fontWeight: '700', marginTop: 6 }}>Free entrance</Text>}
        </Card>}

        {plain.length > 0 && <Card><Text style={{ fontWeight: '800', marginBottom: 6 }}>Prices</Text>
          {plain.map((p) => <View key={p.id} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
            <Text style={{ flex: 1 }}>{p.label} · {p.audience} · {p.unit.replace('_', ' ')}</Text><Text style={{ fontWeight: '700' }}>{Number(p.price) === 0 ? 'Free' : `$${p.price}`}</Text></View>)}</Card>}

        {['facility', 'activity'].map((k) => { const items = extras.filter((p) => p.kind === k); if (!items.length) return null;
          return (<View key={k}><H>{k === 'facility' ? 'Facilities' : 'Activities'}</H>
            {items.map((p) => (
              <Card key={p.id} style={{ padding: 0, overflow: 'hidden' }}>
                <Img uri={p.photo_url} category={l.category} style={{ height: 150 }} />
                <View style={{ padding: 12 }}>
                  <Text style={{ fontWeight: '800', fontSize: 16 }}>{p.label}</Text>
                  {p.description ? <Text style={{ marginVertical: 4 }}>{p.description}</Text> : null}
                  <Text style={{ color: C.primary, fontWeight: '700' }}>{priceLine(p)}{p.is_optional ? ' · optional' : ''}</Text>
                </View>
              </Card>))}</View>); })}

        {l.lat && <View style={{ height: 200, marginHorizontal: 12, borderRadius: 14, overflow: 'hidden', marginTop: 8 }}>
          <MapView style={{ flex: 1 }} initialRegion={{ latitude: l.lat, longitude: l.lng, latitudeDelta: 0.05, longitudeDelta: 0.05 }}>
            <Marker coordinate={{ latitude: l.lat, longitude: l.lng }} title={l.title} /></MapView></View>}
        {l.lat && <Btn kind="ghost" title="🧭 Navigate in the app" style={{ marginHorizontal: 12 }} onPress={() => navigation.navigate('TravelMap', { dest: { lat: l.lat, lng: l.lng, title: l.title } })} />}

        <Card>
          <Text style={{ fontWeight: '800' }}>Contact</Text>
          {contact ? <>
            <Text onPress={() => Linking.openURL(`mailto:${contact.email}`)}>✉️ {contact.email}</Text>
            <Text onPress={() => Linking.openURL(`tel:${contact.phone}`)}>📞 {contact.phone}</Text>
            <Text onPress={() => Linking.openURL(`https://wa.me/${(contact.whatsapp || '').replace(/\D/g, '')}`)}>💬 WhatsApp {contact.whatsapp}</Text></>
            : !session ? <><Muted>🔒 Sign in to contact the host.</Muted><Btn kind="ghost" title={tr('login')} onPress={() => navigation.navigate('Auth', { reason: 'inquiry' })} /></>
            : <><Muted>🔒 Contact details unlock after you book.</Muted></>}
        </Card>
        <Btn kind="ghost" title="Ask the host about availability or pricing" style={{ marginHorizontal: 12 }} onPress={() => { if (ensureLogin(navigation, 'inquiry')) navigation.navigate('Inquiry', { listing: l }); }} />
        <H>Reviews</H>
        {reviews.length === 0 && <Muted style={{ marginHorizontal: 12 }}>No reviews yet.</Muted>}
        {reviews.map((r, i) => <Card key={i}><Text>{'⭐'.repeat(r.rating)}</Text><Text>{r.comment}</Text></Card>)}
      </ScrollView>

      {/* fixed bottom bar */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: C.border, paddingTop: 12, paddingHorizontal: 16,
        paddingBottom: Math.max(insets.bottom, 12), flexDirection: 'row', alignItems: 'center', elevation: 16, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: -2 } }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: C.muted, fontSize: 12 }}>{bar.label}</Text>
          <Text><Text style={{ fontSize: 22, fontWeight: '800', color: C.text }}>{bar.value}</Text><Text style={{ color: C.muted }}> {bar.per}</Text></Text>
          {typeof left === 'number' && <Text style={{ color: left === 0 ? C.danger : C.ok, fontSize: 12, fontWeight: '700' }}>{left === 0 ? 'Fully booked today' : `${left} left today`}</Text>}
        </View>
        <TouchableOpacity onPress={book} style={{ backgroundColor: C.primary, borderRadius: 26, paddingVertical: 14, paddingHorizontal: 34 }}>
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>{tr('book')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
