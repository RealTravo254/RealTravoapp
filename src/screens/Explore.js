import React, { useEffect, useState, useCallback } from 'react';
import { View, FlatList, ScrollView, TouchableOpacity, Text, Keyboard, TextInput } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Localization from 'expo-localization';
import { Ionicons } from '@expo/vector-icons';
import { supabase, PAGE_SIZE } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { getPosition } from '../lib/geo';
import { on } from '../lib/events';
import ScreenHeader from '../components/ScreenHeader';
import { SkeletonList, SkeletonMini } from '../components/Skeleton';
import { ListingCard, MiniCard, Pager, Btn, Muted } from '../components/ui';
import { CATS, catIcon, catColor } from '../lib/categories';
import { tr } from '../i18n';
import { C } from '../lib/theme';

const RECENT = 'recent_searches';
export default function Explore({ navigation, route }) {
  const { ensureLogin, profile } = useAuth();
  const [text, setText] = useState(''); const [q, setQ] = useState(''); const [cat, setCat] = useState(null);
  const [rows, setRows] = useState([]); const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false); const [loading, setLoading] = useState(true);
  const [focus, setFocus] = useState(false); const [sugg, setSugg] = useState([]); const [scrolled, setScrolled] = useState(false);
  const [recent, setRecent] = useState([]); const [popular, setPopular] = useState([]); const [locs, setLocs] = useState([]); const [places, setPlaces] = useState([]);
  const [place, setPlace] = useState(null); const [top, setTop] = useState(null); const [where, setWhere] = useState('');
  const [locTick, setLocTick] = useState(0);
  useEffect(() => on('location-granted', () => setLocTick((t) => t + 1)), []);
  useEffect(() => { if (route?.params?.cat !== undefined) setCat(route.params.cat); }, [route?.params?.cat]); // menu shortcuts

  // ---------- top rated (all categories) near the user's location, else in the user's country ----------
  useEffect(() => { (async () => {
    const pos = await getPosition({ silent: true });
    if (pos) { setPlace(pos); return; }
    let country = profile?.country;
    if (!country) {
      const code = Localization.getLocales?.()[0]?.regionCode;
      if (code) { const { data } = await supabase.from('countries').select('name').eq('code', code).maybeSingle(); country = data?.name; }
    }
    setPlace(country ? { country } : {});
  })(); }, [profile?.country, locTick]);

  useEffect(() => { (async () => {
    if (!place) return;
    if (place.lat != null) {
      const { data } = await supabase.rpc('top_rated_near', { p_lat: place.lat, p_lng: place.lng, p_radius_km: 300, lim: 80 });
      if (data?.length) { setTop(data); setWhere('near you'); return; }
    }
    const country = place.country || profile?.country;
    let query = supabase.from('listing_cards').select('*').order('rating_avg', { ascending: false }).limit(80);
    if (country) query = query.eq('country', country);
    const { data } = await query;
    setTop(data || []); setWhere(country ? `in ${country}` : '');
  })(); }, [place]);

  // ---------- search suggestions ----------
  useEffect(() => { if (!focus) return;
    AsyncStorage.getItem(RECENT).then((v) => setRecent(v ? JSON.parse(v) : []));
    supabase.rpc('popular_searches', { lim: 6 }).then(({ data }) => setPopular((data || []).map((x) => x.term)));
    supabase.rpc('popular_locations', { lim: 8 }).then(({ data }) => setLocs((data || []).map((x) => x.label)));
    supabase.from('listing_cards').select('id,title,category,region').order('rating_avg', { ascending: false }).limit(5).then(({ data }) => setPlaces(data || []));
  }, [focus]);
  useEffect(() => {
    const t = text.trim();
    if (t.length < 2) return setSugg([]);
    const h = setTimeout(async () => { const { data } = await supabase.rpc('search_suggestions', { q: t, lim: 10 }); setSugg(data || []); }, 200);
    return () => clearTimeout(h);
  }, [text]);

  const addRecent = async (t) => {
    const term = t.trim(); if (term.length < 2) return;
    const cur = JSON.parse((await AsyncStorage.getItem(RECENT)) || '[]');
    const next = [term, ...cur.filter((x) => x.toLowerCase() !== term.toLowerCase())].slice(0, 8);
    AsyncStorage.setItem(RECENT, JSON.stringify(next)); supabase.rpc('log_search', { p_term: term });
  };
  const closeSearch = () => { Keyboard.dismiss(); setFocus(false); };
  const pickTerm = (t) => { setText(t); setQ(t); addRecent(t); closeSearch(); };
  const pickListing = (id, title) => { addRecent(title); closeSearch(); navigation.navigate('ListingDetail', { id }); };
  const submit = () => { setQ(text); addRecent(text); closeSearch(); };
  const clearRecent = () => { AsyncStorage.removeItem(RECENT); setRecent([]); };

  // ---------- main list ----------
  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase.from('listing_cards').select('*').order('is_prioritized', { ascending: false }).order('rating_avg', { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
    if (cat) query = query.eq('category', cat);
    if (q.trim()) { const t = q.trim().replace(/[,()%]/g, ' '); query = query.or(`title.ilike.%${t}%,region.ilike.%${t}%,country.ilike.%${t}%,location_name.ilike.%${t}%`); }
    const { data } = await query;
    setHasMore((data || []).length > PAGE_SIZE); setRows((data || []).slice(0, PAGE_SIZE)); setLoading(false);
  }, [q, cat, page]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => setPage(0), [q, cat]);

  const go = (screen) => { if (ensureLogin(navigation, 'book')) navigation.navigate(screen); };
  const onScroll = (e) => { const down = e.nativeEvent.contentOffset.y > 70; setScrolled((s) => (s === down ? s : down)); };

  const Row = ({ icon, label, sub, onPress }) => (
    <TouchableOpacity onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 11 }}>
      <Ionicons name={icon} size={19} color={C.muted} style={{ width: 28 }} />
      <Text style={{ flex: 1, color: C.text }}>{label}</Text>{sub ? <Text style={{ color: C.muted, fontSize: 12 }}>{sub}</Text> : null}
    </TouchableOpacity>);
  const Section = ({ title, action, children }) => (
    <View style={{ marginBottom: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderColor: C.border, paddingBottom: 4 }}>
        <Text style={{ flex: 1, fontWeight: '800', color: C.text }}>{title}</Text>{action}
      </View>{children}
    </View>);

  const typing = text.trim().length >= 2;
  const panel = (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16 }}>
      {!typing ? (<>
        {recent.length > 0 && <Section title="Recent searches" action={<Text onPress={clearRecent} style={{ color: C.primary }}>Clear</Text>}>
          {recent.map((t) => <Row key={t} icon="time-outline" label={t} onPress={() => pickTerm(t)} />)}</Section>}
        {popular.length > 0 && <Section title="Most searched">{popular.map((t) => <Row key={t} icon="trending-up-outline" label={t} onPress={() => pickTerm(t)} />)}</Section>}
        {locs.length > 0 && <Section title="Locations">{locs.map((t) => <Row key={t} icon="location-outline" label={t} onPress={() => pickTerm(t)} />)}</Section>}
        {places.length > 0 && <Section title="Places">{places.map((p) => <Row key={p.id} icon={catIcon(p.category)} label={p.title} sub={p.region} onPress={() => pickListing(p.id, p.title)} />)}</Section>}
      </>) : (<>
        {sugg.some((s) => s.kind !== 'listing') && <Section title="Locations">
          {sugg.filter((s) => s.kind !== 'listing').map((s, i) => <Row key={i} icon={s.kind === 'destination' ? 'earth-outline' : 'location-outline'} label={s.label} onPress={() => pickTerm(s.label)} />)}</Section>}
        {sugg.some((s) => s.kind === 'listing') && <Section title="Places">
          {sugg.filter((s) => s.kind === 'listing').map((s, i) => <Row key={i} icon={catIcon(s.category)} label={s.label} sub={s.category ? tr(s.category) : ''} onPress={() => pickListing(s.listing_id, s.label)} />)}</Section>}
        {sugg.length === 0 && <Muted style={{ textAlign: 'center', margin: 20 }}>No suggestions — press search to look for “{text}”.</Muted>}
      </>)}
    </ScrollView>
  );

  // a row of top-rated cards
  const rail = (title, icon, data, color) => (
    <View key={title}>
      <View style={{ flexDirection: 'row', alignItems: 'center', margin: 12, marginBottom: 8 }}><Ionicons name={icon} size={18} color={color || C.primary} /><Text style={{ fontSize: 17, fontWeight: '800', marginLeft: 6, color: C.text }}>{title}</Text></View>
      <FlatList horizontal data={data} keyExtractor={(i) => i.id} showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12 }}
        renderItem={({ item }) => <MiniCard item={item} onPress={() => navigation.navigate('ListingDetail', { id: item.id })} />} />
    </View>);
  const suffix = where ? ` ${where}` : '';
  const rails = () => {
    if (q) return null;
    if (top === null) return (<><View style={{ margin: 12, marginBottom: 8 }}><Text style={{ fontSize: 17, fontWeight: '800', color: C.text }}>⭐ Top rated</Text></View><View style={{ flexDirection: 'row', paddingHorizontal: 12 }}><SkeletonMini /><SkeletonMini /></View></>);
    if (cat) { const d = top.filter((x) => x.category === cat).slice(0, 10); return d.length ? rail(`Top rated ${tr(cat)}${suffix}`, catIcon(cat), d, catColor(cat)) : null; }
    return (<>
      {top.length > 0 && rail(`Top rated${suffix}`, 'star', top.slice(0, 10))}
      {CATS.map((c) => { const d = top.filter((x) => x.category === c.key).slice(0, 10); return d.length ? rail(`${tr(c.key)} · top rated${suffix}`, c.icon, d, c.color) : null; })}
    </>);
  };

  // the search bar is the first thing in the list, so it scrolls away; the header then shows a search icon
  const header = (
    <View>
      <TouchableOpacity activeOpacity={0.9} onPress={() => setFocus(true)} style={{ marginHorizontal: 12, marginTop: 12, flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 25, height: 50, paddingHorizontal: 16, borderWidth: 1, borderColor: C.border }}>
        <Ionicons name="search" size={20} color={C.muted} /><Text numberOfLines={1} style={{ flex: 1, marginLeft: 8, color: q ? C.text : C.muted }}>{q || `${tr('search')} — place, region, country`}</Text>
        {q ? <TouchableOpacity onPress={() => { setText(''); setQ(''); }}><Ionicons name="close-circle" size={20} color={C.muted} /></TouchableOpacity> : null}
      </TouchableOpacity>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 8, paddingTop: 10 }}>
        {[{ key: null, icon: 'apps-outline' }, ...CATS].map((c) => {
          const on = cat === c.key; const col = c.color || C.primary;
          return (
            <TouchableOpacity key={String(c.key)} onPress={() => setCat(c.key)} style={{ width: '25%', alignItems: 'center', paddingVertical: 8 }}>
              <View style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: on ? col : col + '22', alignItems: 'center', justifyContent: 'center', borderWidth: on ? 0 : 1, borderColor: col + '55' }}>
                <Ionicons name={c.icon} size={26} color={on ? '#fff' : col} />
              </View>
              <Text numberOfLines={1} style={{ marginTop: 4, fontSize: 12, fontWeight: '800', color: col }}>{c.key ? tr(c.key) : 'All'}</Text>
            </TouchableOpacity>);
        })}
      </View>
      <View style={{ flexDirection: 'row', paddingHorizontal: 12 }}>
        <Btn style={{ flex: 1, marginRight: 4 }} kind="ghost" title={`🚐 ${tr('transfer')}`} onPress={() => go('AirportTransfer')} />
        <Btn style={{ flex: 1, marginLeft: 4 }} kind="ghost" title={`🧳 ${tr('custom')}`} onPress={() => go('TripBuilder')} />
      </View>
      {rails()}
      <Text style={{ fontSize: 18, fontWeight: '800', margin: 12, marginBottom: 0, color: C.text }}>{q ? `Results for “${q}”` : cat ? tr(cat) : 'All places'}</Text>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScreenHeader onSearch={scrolled && !focus ? () => setFocus(true) : undefined} />
      {focus ? (<>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 10 }}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 25, height: 50, paddingHorizontal: 16, borderWidth: 1, borderColor: C.border }}>
            <Ionicons name="search" size={20} color={C.muted} />
            <TextInput autoFocus style={{ flex: 1, marginLeft: 8, color: C.text }} placeholder={`${tr('search')} — place, region, country`} placeholderTextColor={C.muted}
              value={text} onChangeText={(v) => { setText(v); if (!v) setQ(''); }} onSubmitEditing={submit} returnKeyType="search" />
            {text.length > 0 && <TouchableOpacity onPress={() => { setText(''); setQ(''); }}><Ionicons name="close-circle" size={20} color={C.muted} /></TouchableOpacity>}
          </View>
          <TouchableOpacity onPress={closeSearch} style={{ paddingLeft: 12 }}><Text style={{ color: C.primary, fontWeight: '700' }}>Cancel</Text></TouchableOpacity>
        </View>
        {panel}
      </>) : loading ? (<ScrollView onScroll={onScroll} scrollEventThrottle={16}>{header}<SkeletonList n={3} /></ScrollView>) : (
        <FlatList data={rows} keyExtractor={(i) => i.id} keyboardShouldPersistTaps="handled" ListHeaderComponent={header} onScroll={onScroll} scrollEventThrottle={16}
          ListEmptyComponent={<Muted style={{ textAlign: 'center', margin: 30 }}>No places found.</Muted>}
          renderItem={({ item }) => <ListingCard item={item} onPress={() => navigation.navigate('ListingDetail', { id: item.id })} />}
          ListFooterComponent={<Pager page={page} setPage={setPage} hasMore={hasMore} />} />
      )}
    </View>
  );
}
