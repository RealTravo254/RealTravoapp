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
  Modal,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { supabase, PAGE_SIZE } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
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
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [deleteModal, setDeleteModal] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);

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

  const toggleSelection = (id) => {
    setSelectedIds((ids) => ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  };

  const togglePageSelection = () => {
    const pageIds = rows.map((row) => row.id);
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id));
    setSelectedIds((ids) => allSelected
      ? ids.filter((id) => !pageIds.includes(id))
      : [...new Set([...ids, ...pageIds])]);
  };

  const deleteSelected = async () => {
    setDeleting(true);
    const { error } = await supabase
      .from('listings')
      .update({ deleted_at: new Date().toISOString(), status: 'hidden' })
      .in('id', selectedIds)
      .eq('owner_id', session.user.id)
      .is('deleted_at', null);
    if (error) {
      setDeleting(false);
      Alert.alert('Delete failed', error.message);
      return;
    }
    setDeleteModal(false);
    setDeleteConfirmation('');
    setSelectedIds([]);
    setSelecting(false);
    setDeleting(false);
    await load();
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
        <TouchableOpacity
          onPress={() => {
            setSelecting((value) => !value);
            setSelectedIds([]);
          }}
          style={styles.selectToggle}
        >
          <Text style={styles.selectToggleText}>{selecting ? 'Cancel' : 'Select'}</Text>
        </TouchableOpacity>
      </View>
      {selecting && (
        <View style={styles.selectionBar}>
          <Text style={styles.sectionCount}>{selectedIds.length} selected · {total} total</Text>
          <View style={{ flexDirection: 'row' }}>
            <ActionButton
              icon="checkbox-outline"
              title={rows.length > 0 && rows.every((row) => selectedIds.includes(row.id)) ? 'Deselect page' : 'Select page'}
              onPress={togglePageSelection}
            />
            <ActionButton
              icon="trash-outline"
              title="Delete selected"
              tone="danger"
              onPress={() => {
                if (!selectedIds.length) return;
                setDeleteConfirmation('');
                setDeleteModal(true);
              }}
            />
          </View>
        </View>
      )}
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
        {!selecting && <ActionButton
          icon="create-outline"
          title="Edit"
          onPress={() => navigation.navigate('ListingForm', { listing: l, providers })}
        />}
        {!selecting && ['approved', 'hidden'].includes(l.status) && (
          <ActionButton
            icon={l.status === 'approved' ? 'eye-off-outline' : 'eye-outline'}
            title={l.status === 'approved' ? 'Hide' : 'Show'}
            onPress={() => toggle(l)}
          />
        )}
        {selecting && (
          <ActionButton
            icon={selectedIds.includes(l.id) ? 'checkbox' : 'square-outline'}
            title={selectedIds.includes(l.id) ? 'Selected' : 'Select'}
            onPress={() => toggleSelection(l.id)}
          />
        )}
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
      <Modal
        visible={deleteModal}
        transparent
        animationType="fade"
        onRequestClose={() => setDeleteModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.deleteDialog}>
            <Text style={styles.dialogTitle}>Delete {selectedIds.length} listing{selectedIds.length === 1 ? '' : 's'}?</Text>
            <Text style={styles.dialogText}>This action cannot be undone. Type confirm delete to continue.</Text>
            <TextInput
              value={deleteConfirmation}
              onChangeText={setDeleteConfirmation}
              placeholder="confirm delete"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.confirmInput}
            />
            <View style={styles.dialogActions}>
              <TouchableOpacity onPress={() => setDeleteModal(false)} style={styles.cancelDelete}>
                <Text style={styles.cancelDeleteText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={deleting || deleteConfirmation !== 'confirm delete'}
                onPress={deleteSelected}
                style={[styles.confirmDelete, (deleting || deleteConfirmation !== 'confirm delete') && styles.disabledDelete]}
              >
                <Text style={styles.confirmDeleteText}>{deleting ? 'Deleting…' : 'Delete'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
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
  selectToggle: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 9, backgroundColor: C.primarySoft },
  selectToggleText: { color: C.primary, fontWeight: '700', fontSize: 13 },
  selectionBar: { backgroundColor: C.card, borderRadius: 14, padding: 10, marginBottom: 10, ...shadow },
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
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 },
  deleteDialog: { backgroundColor: C.card, borderRadius: 18, padding: 20 },
  dialogTitle: { fontSize: 18, fontWeight: '800', color: C.ink },
  dialogText: { color: C.muted, marginTop: 8, lineHeight: 20 },
  confirmInput: { borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginTop: 16, color: C.ink },
  dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 16 },
  cancelDelete: { paddingHorizontal: 14, paddingVertical: 10, marginRight: 8 },
  cancelDeleteText: { color: C.muted, fontWeight: '700' },
  confirmDelete: { backgroundColor: C.red, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
  disabledDelete: { opacity: 0.45 },
  confirmDeleteText: { color: '#fff', fontWeight: '800' },
});