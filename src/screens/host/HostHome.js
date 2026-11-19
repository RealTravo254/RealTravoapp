import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Alert,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { supabase, PAGE_SIZE } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import { startPayment } from '../../lib/payments';
import ScreenHeader from '../../components/ScreenHeader';

/* ---------- design tokens ---------- */
const C = {
  bg: '#F1F4F7',
  card: '#FFFFFF',
  ink: '#10222E',
  muted: '#6B7C89',
  line: '#E3E8ED',
  primary: '#0B4F6C',
  primarySoft: '#E1EEF4',
  amber: '#F2A81D',
  amberSoft: '#FDF2D8',
  green: '#1E8E5A',
  greenSoft: '#DDF3E8',
  red: '#C93C3C',
  redSoft: '#FBE4E4',
  grey: '#6B7C89',
  greySoft: '#E9EDF0',
  blueSoft: '#E4EBFB',
  blue: '#3D5FC4',
};

const STATUS = {
  approved: { label: 'Live', fg: C.green, bg: C.greenSoft },
  pending: { label: 'In review', fg: C.blue, bg: C.blueSoft },
  rejected: { label: 'Rejected', fg: C.red, bg: C.redSoft },
  hidden: { label: 'Hidden', fg: C.grey, bg: C.greySoft },
  draft: { label: 'Draft', fg: C.grey, bg: C.greySoft },
};

const QUICK = [
  { label: 'Bookings', icon: 'calendar-outline', route: 'HostBookings' },
  { label: 'Scan QR', icon: 'qr-code-outline', route: 'ScanQR' },
  { label: 'Analytics', icon: 'stats-chart-outline', route: 'Analytics' },
  { label: 'Forms', icon: 'document-text-outline', route: 'BookingForms' },
];

/* ---------- small pieces ---------- */
function StatusPill({ status }) {
  const s = STATUS[status] || STATUS.draft;
  return (
    <View style={[styles.pill, { backgroundColor: s.bg }]}>
      <View style={[styles.dot, { backgroundColor: s.fg }]} />
      <Text style={[styles.pillText, { color: s.fg }]}>{s.label}</Text>
    </View>
  );
}

function ActionButton({ icon, title, onPress, tone = 'default' }) {
  const tones = {
    default: { fg: C.primary, bg: C.primarySoft },
    amber: { fg: '#8A5A00', bg: C.amberSoft },
    danger: { fg: C.red, bg: C.redSoft },
  };
  const t = tones[tone];
  return (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={onPress}
      style={[styles.actionBtn, { backgroundColor: t.bg }]}
    >
      <Ionicons name={icon} size={15} color={t.fg} />
      <Text style={[styles.actionText, { color: t.fg }]}>{title}</Text>
    </TouchableOpacity>
  );
}

function pageWindow(current, total) {
  // returns e.g. [0, '…', 4, 5, 6, '…', 19]
  if (total <= 5) return Array.from({ length: total }, (_, i) => i);
  const set = new Set([0, total - 1, current - 1, current, current + 1]);
  const nums = [...set].filter((n) => n >= 0 && n < total).sort((a, b) => a - b);
  const out = [];
  nums.forEach((n, i) => {
    if (i > 0 && n - nums[i - 1] > 1) out.push('…');
    out.push(n);
  });
  return out;
}

function Pagination({ page, setPage, total, disabled }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (total === 0) return null;
  const from = page * PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);
  const prevOff = page === 0 || disabled;
  const nextOff = page >= pages - 1 || disabled;

  return (
    <View style={styles.pagerWrap}>
      <Text style={styles.pagerInfo}>
        Showing {from}–{to} of {total}
      </Text>
      <View style={styles.pager}>
        <TouchableOpacity
          disabled={prevOff}
          onPress={() => setPage(page - 1)}
          style={[styles.arrowBtn, prevOff && styles.pagerBtnOff]}
        >
          <Ionicons name="chevron-back" size={18} color={prevOff ? C.muted : C.primary} />
        </TouchableOpacity>

        <View style={styles.numbers}>
          {pageWindow(page, pages).map((n, i) =>
            n === '…' ? (
              <Text key={`gap${i}`} style={styles.gap}>…</Text>
            ) : (
              <TouchableOpacity
                key={n}
                disabled={disabled}
                onPress={() => setPage(n)}
                style={[styles.num, n === page && styles.numActive]}
              >
                <Text style={[styles.numText, n === page && styles.numTextActive]}>{n + 1}</Text>
              </TouchableOpacity>
            )
          )}
        </View>

        <TouchableOpacity
          disabled={nextOff}
          onPress={() => setPage(page + 1)}
          style={[styles.arrowBtn, nextOff && styles.pagerBtnOff]}
        >
          <Ionicons name="chevron-forward" size={18} color={nextOff ? C.muted : C.primary} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

/* ---------- screen ---------- */
export default function HostHome({ navigation }) {
  const { session } = useAuth();
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const listRef = useRef(null);
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const from = page * PAGE_SIZE;
    const { data, error, count } = await supabase
      .from('listings')
      .select('*', { count: 'exact' })
      .eq('owner_id', session.user.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (error) Alert.alert('Error', error.message);
    const t = count || 0;
    // if the last item on a page was removed, step back one page
    if (page > 0 && (data || []).length === 0 && t > 0) {
      setPage(Math.ceil(t / PAGE_SIZE) - 1);
      return;
    }
    setTotal(t);
    setRows(data || []);

    const p = await supabase.from('providers').select('*').eq('user_id', session.user.id);
    setProviders(p.data || []);
    setLoading(false);
  }, [page, session.user.id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const goTo = (n) => {
    setPage(n);
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const toggle = async (l) => {
    const { error } = await supabase.rpc('set_listing_visibility', {
      p_listing: l.id,
      p_visible: l.status !== 'approved',
    });
    if (error) Alert.alert('Error', error.message);
    load();
  };

  const del = (l) =>
    Alert.alert('Delete this listing?', 'It will be removed from your dashboard.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await supabase
            .from('listings')
            .update({ deleted_at: new Date().toISOString(), status: 'hidden' })
            .eq('id', l.id);
          load();
        },
      },
    ]);

  const promote = async (l) => {
    try {
      const p = await startPayment({ purpose: 'prioritization', amount: 15, listingId: l.id });
      navigation.navigate('Pay', { url: p.authorization_url });
    } catch (e) {
      Alert.alert('Error', e.message);
    }
  };

  const Header = (
    <View>
      {/* primary CTA */}
      <TouchableOpacity
        activeOpacity={0.85}
        style={styles.hero}
        onPress={() => navigation.navigate('ListingForm', { providers })}
      >
        <View style={styles.heroIcon}>
          <Ionicons name="add" size={26} color={C.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.heroTitle}>Create a new listing</Text>
          <Text style={styles.heroSub}>Add photos, pricing and availability</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color="#fff" />
      </TouchableOpacity>

      {/* quick links */}
      <View style={styles.quickRow}>
        {QUICK.map((q) => (
          <TouchableOpacity
            key={q.route}
            activeOpacity={0.75}
            style={styles.quick}
            onPress={() => navigation.navigate(q.route)}
          >
            <View style={styles.quickIcon}>
              <Ionicons name={q.icon} size={20} color={C.primary} />
            </View>
            <Text style={styles.quickLabel}>{q.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.sectionRow}>
        <Text style={styles.sectionTitle}>Your listings</Text>
        {!loading && <Text style={styles.sectionCount}>{total} total</Text>}
      </View>
    </View>
  );

  const Empty = loading ? (
    <ActivityIndicator style={{ marginTop: 40 }} color={C.primary} />
  ) : (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name="home-outline" size={30} color={C.primary} />
      </View>
      <Text style={styles.emptyTitle}>No listings yet</Text>
      <Text style={styles.emptySub}>Create your first listing and it will show up here.</Text>
    </View>
  );

  const renderItem = ({ item: l }) => (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={{ flex: 1, paddingRight: 10 }}>
          <Text style={styles.cardTitle} numberOfLines={2}>{l.title}</Text>
          <View style={styles.metaRow}>
            <Ionicons name="pricetag-outline" size={13} color={C.muted} />
            <Text style={styles.meta}>{l.category}</Text>
          </View>
        </View>
        <StatusPill status={l.status} />
      </View>

      {l.is_prioritized && (
        <View style={styles.promoted}>
          <Ionicons name="star" size={13} color="#8A5A00" />
          <Text style={styles.promotedText}>Promoted</Text>
        </View>
      )}

      {l.status === 'rejected' && !!l.admin_note && (
        <View style={styles.note}>
          <Ionicons name="alert-circle" size={16} color={C.red} />
          <Text style={styles.noteText}>{l.admin_note}</Text>
        </View>
      )}

      <View style={styles.divider} />

      <View style={styles.actions}>
        <ActionButton
          icon="create-outline"
          title="Edit"
          onPress={() => navigation.navigate('ListingForm', { listing: l, providers })}
        />
        {['approved', 'hidden'].includes(l.status) && (
          <ActionButton
            icon={l.status === 'approved' ? 'eye-off-outline' : 'eye-outline'}
            title={l.status === 'approved' ? 'Hide' : 'Show'}
            onPress={() => toggle(l)}
          />
        )}
        {l.status === 'approved' && !l.is_prioritized && (
          <ActionButton icon="rocket-outline" title="Promote" tone="amber" onPress={() => promote(l)} />
        )}
        <ActionButton icon="trash-outline" title="Delete" tone="danger" onPress={() => del(l)} />
      </View>
    </View>
  );

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Host dashboard" icon="business-outline" />
      <FlatList
        ref={listRef}
        data={rows}
        keyExtractor={(i) => i.id}
        renderItem={renderItem}
        ListHeaderComponent={Header}
        ListEmptyComponent={Empty}
        ListFooterComponent={
          <Pagination page={page} setPage={goTo} total={total} disabled={loading} />
        }
        contentContainerStyle={styles.list}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />
        }
      />
    </View>
  );
}

/* ---------- styles ---------- */
const shadow = {
  shadowColor: '#10222E',
  shadowOpacity: 0.07,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 3,
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  list: { padding: 16, paddingBottom: 40 },

  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.primary,
    borderRadius: 20,
    padding: 16,
    ...shadow,
    shadowOpacity: 0.2,
  },
  heroIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  heroTitle: { color: '#fff', fontSize: 17, fontWeight: '800' },
  heroSub: { color: '#BFD9E5', fontSize: 13, marginTop: 2 },

  quickRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 },
  quick: {
    width: '23.5%',
    backgroundColor: C.card,
    borderRadius: 16,
    paddingVertical: 12,
    alignItems: 'center',
    ...shadow,
  },
  quickIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: C.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  quickLabel: { fontSize: 12, fontWeight: '700', color: C.ink },

  sectionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: 24,
    marginBottom: 10,
    paddingHorizontal: 2,
  },
  sectionTitle: { fontSize: 19, fontWeight: '800', color: C.ink },
  sectionCount: { fontSize: 12, color: C.muted },

  card: {
    backgroundColor: C.card,
    borderRadius: 18,
    padding: 16,
    marginBottom: 12,
    ...shadow,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start' },
  cardTitle: { fontSize: 16, fontWeight: '800', color: C.ink, lineHeight: 21 },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  meta: { fontSize: 13, color: C.muted, marginLeft: 5, textTransform: 'capitalize' },

  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  dot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  pillText: { fontSize: 12, fontWeight: '700' },

  promoted: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.amberSoft,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
    marginTop: 10,
  },
  promotedText: { color: '#8A5A00', fontWeight: '700', fontSize: 12, marginLeft: 5 },

  note: {
    flexDirection: 'row',
    backgroundColor: C.redSoft,
    borderRadius: 12,
    padding: 10,
    marginTop: 12,
  },
  noteText: { flex: 1, color: C.red, fontSize: 13, marginLeft: 8, lineHeight: 18 },

  divider: { height: 1, backgroundColor: C.line, marginTop: 14, marginBottom: 12 },

  actions: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -3 },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    margin: 3,
  },
  actionText: { fontSize: 13, fontWeight: '700', marginLeft: 6 },

  empty: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24 },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: C.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  emptyTitle: { fontSize: 17, fontWeight: '800', color: C.ink },
  emptySub: { fontSize: 14, color: C.muted, textAlign: 'center', marginTop: 6 },

  pagerWrap: { marginTop: 8, alignItems: 'center' },
  pagerInfo: { fontSize: 12, color: C.muted, marginBottom: 8 },
  pager: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 8,
    ...shadow,
  },
  arrowBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.primarySoft,
  },
  pagerBtnOff: { backgroundColor: C.greySoft },
  numbers: { flexDirection: 'row', alignItems: 'center' },
  num: {
    minWidth: 38,
    height: 38,
    borderRadius: 12,
    marginHorizontal: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numActive: { backgroundColor: C.primary },
  numText: { fontSize: 14, fontWeight: '700', color: C.ink },
  numTextActive: { color: '#fff' },
  gap: { color: C.muted, fontWeight: '700', marginHorizontal: 4 },
});