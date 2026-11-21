import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { supabase } from '../lib/supabase';
import { C } from '../lib/theme';
import { Muted } from './ui';

const STAYS = ['hotel', 'resort', 'campsite', 'airbnb'];

export default function ListingInfoModal({ listing, onClose, formatMoney }) {
  const [info, setInfo] = useState(null);
  const [prices, setPrices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!listing?.id) return undefined;
    let active = true;
    setLoading(true); setError('');
    Promise.all([
      supabase.from('listings').select('description,facilities,accommodation_available,location_name,country').eq('id', listing.id).single(),
      supabase.from('listing_prices').select('id,kind,label,description,price,unit').eq('listing_id', listing.id)
        .in('kind', ['room', 'facility', 'activity', 'ticket', 'guide']).order('kind'),
    ]).then(([listingResult, priceResult]) => {
      if (listingResult.error) throw listingResult.error;
      if (priceResult.error) throw priceResult.error;
      if (active) { setInfo(listingResult.data); setPrices(priceResult.data || []); }
    }).catch((e) => {
      console.warn('Could not load listing details:', e.message);
      if (active) setError(e.message || 'Please try again.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [listing?.id, reload]);

  const stay = listing && (STAYS.includes(listing.category) || info?.accommodation_available);
  const facilities = (info?.facilities || []).join(' · ');
  const stayOptions = prices.filter((p) => p.kind === 'room');
  const activities = prices.filter((p) => ['activity', 'ticket', 'guide'].includes(p.kind));
  const addOnFacilities = prices.filter((p) => p.kind === 'facility');
  const priceLine = (p) => `${Number(p.price) === 0 ? 'Free' : formatMoney ? formatMoney(p.price) : p.price}${p.unit ? ` · ${p.unit.replace('_', ' ')}` : ''}`;

  return (
    <Modal visible={!!listing} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.42)' }}>
        <View style={{ maxHeight: '82%', backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: 'hidden' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderColor: C.border }}>
            <Text style={{ flex: 1, fontSize: 18, fontWeight: '800', color: C.text }}>Place details</Text>
            <TouchableOpacity onPress={onClose}><Text style={{ color: C.primary, fontWeight: '800', padding: 6 }}>Close</Text></TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16 }}>
            {listing && <>
              <Text style={{ fontSize: 17, fontWeight: '800', color: C.text }}>{listing.title}</Text>
              <Muted style={{ marginTop: 3 }}>{listing.category}{listing.region ? ` · ${listing.region}` : ''}{(info?.country || listing.country) ? ` · ${info?.country || listing.country}` : ''}</Muted>
            </>}
            {loading ? <ActivityIndicator color={C.primary} style={{ margin: 24 }} /> : error ? (
              <View style={{ marginTop: 16 }}>
                <Muted>Could not load details: {error}</Muted>
                <TouchableOpacity onPress={() => setReload((n) => n + 1)} style={{ paddingVertical: 12 }}>
                  <Text style={{ color: C.primary, fontWeight: '800' }}>Try again</Text>
                </TouchableOpacity>
              </View>
            ) : <>
              {!!info?.description && <Text style={{ color: C.text, marginTop: 12, lineHeight: 20 }}>{info.description}</Text>}
              {!!facilities && <>
                <Text style={{ fontWeight: '800', marginTop: 16, marginBottom: 5 }}>Facilities</Text>
                <Muted>{facilities}</Muted>
              </>}
              {!!addOnFacilities.length && <>
                <Text style={{ fontWeight: '800', marginTop: 16, marginBottom: 5 }}>Facility options</Text>
                {addOnFacilities.map((p) => <View key={p.id} style={{ paddingVertical: 7, borderTopWidth: 1, borderColor: C.border }}>
                  <Text style={{ fontWeight: '700', color: C.text }}>{p.label} · {priceLine(p)}</Text>
                  {!!p.description && <Muted style={{ marginTop: 3 }}>{p.description}</Muted>}
                </View>)}
              </>}
              {!!activities.length && <>
                <Text style={{ fontWeight: '800', marginTop: 16, marginBottom: 5 }}>{stay ? 'Activities & experiences' : 'Activities, experiences & tickets'}</Text>
                {activities.map((p) => <View key={p.id} style={{ paddingVertical: 7, borderTopWidth: 1, borderColor: C.border }}>
                  <Text style={{ fontWeight: '700', color: C.text }}>{p.label} · {priceLine(p)}</Text>
                  {!!p.description && <Muted style={{ marginTop: 3 }}>{p.description}</Muted>}
                </View>)}
              </>}
              {stay && !!stayOptions.length && <>
                <Text style={{ fontWeight: '800', marginTop: 16, marginBottom: 5 }}>Accommodation options</Text>
                {stayOptions.map((p) => <View key={p.id} style={{ paddingVertical: 7, borderTopWidth: 1, borderColor: C.border }}>
                  <Text style={{ fontWeight: '700', color: C.text }}>{p.label} · {priceLine(p)}</Text>
                  {!!p.description && <Muted style={{ marginTop: 3 }}>{p.description}</Muted>}
                </View>)}
              </>}
            </>}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
