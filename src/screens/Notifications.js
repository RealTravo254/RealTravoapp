import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, SectionList, TouchableOpacity, RefreshControl, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase, PAGE_SIZE } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { Btn, Muted, Pager, Loader } from '../components/ui';
import { C } from '../lib/theme';

/* Icon + tint per notification type.
   `n.type` is optional: if your table has no `type` column, everything falls back to "default". */
const TYPES = {
  booking:  { icon: 'calendar',        bg: '#E3EDE8', fg: C.primary },
  payment:  { icon: 'card',            bg: '#E6F0FA', fg: '#2F6FB2' },
  event:    { icon: 'ticket',          bg: '#F3E8F8', fg: '#8A4FB0' },
  transfer: { icon: 'car',             bg: '#FDF1DC', fg: '#B7791F' },
  guide:    { icon: 'compass',         bg: '#E3F3F1', fg: '#1F8A7D' },
  promo:    { icon: 'pricetag',        bg: '#FCE8EF', fg: '#C2467A' },
  default:  { icon: 'notifications',   bg: '#EEF1EF', fg: '#5C6B64' },
};

const timeAgo = (iso) => {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 172800) return 'Yesterday';
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

const groupByDay = (rows) => {
  const today = startOfDay(new Date());
  const day = 86400000;
  const buckets = { Today: [], Yesterday: [], 'This week': [], Earlier: [] };
  rows.forEach((n) => {
    const t = startOfDay(new Date(n.created_at));
    if (t >= today) buckets.Today.push(n);
    else if (t >= today - day) buckets.Yesterday.push(n);
    else if (t >= today - 6 * day) buckets['This week'].push(n);
    else buckets.Earlier.push(n);
  });
  return Object.entries(buckets).filter(([, data]) => data.length).map(([title, data]) => ({ title, data }));
};

export default function Notifications({ navigation }) {
  const { session } = useAuth();
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    const { data } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
    setMore((data || []).length > PAGE_SIZE);
    setRows((data || []).slice(0, PAGE_SIZE));
    setLoading(false);
  }, [page, session]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const sections = useMemo(() => groupByDay(rows), [rows]);
  const unread = useMemo(() => rows.filter((n) => !n.read).length, [rows]);

  const markAll = async () => {
    setRows((r) => r.map((n) => ({ ...n, read: true }))); // optimistic
    await supabase.from('notifications').update({ read: true }).eq('user_id', session.user.id).eq('read', false);
  };

  const open = async (n) => {
    if (n.read) return;
    setRows((r) => r.map((x) => (x.id === n.id ? { ...x, read: true } : x))); // optimistic
    await supabase.from('notifications').update({ read: true }).eq('id', n.id);
  };

  if (!session) {
    return (
      <View style={s.center}>
        <View style={s.emptyIcon}><Ionicons name="notifications-off-outline" size={34} color={C.primary} /></View>
        <Text style={s.emptyTitle}>Sign in to see notifications</Text>
        <Muted style={s.emptyText}>Booking updates, payment receipts and trip reminders show up here.</Muted>
        <Btn title="Sign in" style={{ alignSelf: 'stretch', marginTop: 18 }} onPress={() => navigation.navigate('Auth', { reason: 'notifications' })} />
      </View>
    );
  }

  return (
    <View style={s.screen}>
      {/* Summary bar */}
      <View style={s.summary}>
        <View style={{ flex: 1 }}>
          <Text style={s.summaryTitle}>{unread > 0 ? `${unread} unread` : 'All caught up'}</Text>
          <Muted style={{ fontSize: 12 }}>{unread > 0 ? 'Tap a notification to mark it as read' : 'Nothing new right now'}</Muted>
        </View>
        {unread > 0 && (
          <TouchableOpacity onPress={markAll} style={s.markAll} activeOpacity={0.7}>
            <Ionicons name="checkmark-done" size={16} color={C.primary} />
            <Text style={s.markAllText}>Mark all read</Text>
          </TouchableOpacity>
        )}
      </View>

      {loading && !refreshing ? (
        <Loader />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(i) => String(i.id)}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{ paddingBottom: 30, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />}
          ListEmptyComponent={
            <View style={s.center}>
              <View style={s.emptyIcon}><Ionicons name="notifications-outline" size={34} color={C.primary} /></View>
              <Text style={s.emptyTitle}>No notifications yet</Text>
              <Muted style={s.emptyText}>When you book a stay, pay for a trip or get a reminder, it will appear here.</Muted>
            </View>
          }
          ListFooterComponent={rows.length ? <Pager page={page} setPage={setPage} hasMore={more} /> : null}
          renderSectionHeader={({ section }) => <Text style={s.sectionTitle}>{section.title}</Text>}
          renderItem={({ item: n, index, section }) => {
            const t = n.urgent ? { icon: 'alert-circle', bg: '#FBE7E5', fg: C.danger } : TYPES[n.type] || TYPES.default;
            const first = index === 0;
            const last = index === section.data.length - 1;
            return (
              <TouchableOpacity
                activeOpacity={0.75}
                onPress={() => open(n)}
                style={[
                  s.card,
                  !n.read && s.cardUnread,
                  n.urgent && !n.read && { borderLeftColor: C.danger },
                  first && s.cardFirst,
                  last && s.cardLast,
                ]}
              >
                <View style={[s.iconWrap, { backgroundColor: t.bg }]}>
                  <Ionicons name={t.icon} size={20} color={t.fg} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={s.titleRow}>
                    <Text style={[s.title, !n.read && s.titleUnread]} numberOfLines={2}>{n.title}</Text>
                    {!n.read && <View style={[s.dot, n.urgent && { backgroundColor: C.danger }]} />}
                  </View>
                  {n.body ? <Text style={s.body} numberOfLines={3}>{n.body}</Text> : null}
                  <Text style={s.time}>{timeAgo(n.created_at)}</Text>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F6F8F7' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },

  summary: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: '#fff', borderBottomWidth: 1, borderColor: C.border,
  },
  summaryTitle: { fontSize: 17, fontWeight: '800', color: '#14231C' },
  markAll: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 20, backgroundColor: '#E3EDE8',
  },
  markAllText: { color: C.primary, fontWeight: '700', fontSize: 13 },

  sectionTitle: { fontSize: 13, fontWeight: '700', color: '#6B7A73', marginTop: 18, marginBottom: 8, marginHorizontal: 18 },

  card: {
    flexDirection: 'row', gap: 12, padding: 14, marginHorizontal: 14, backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.border,
    borderLeftWidth: 3, borderLeftColor: 'transparent',
  },
  cardUnread: { backgroundColor: '#F2F8F5', borderLeftColor: C.primary },
  cardFirst: { borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  cardLast: { borderBottomLeftRadius: 16, borderBottomRightRadius: 16, borderBottomWidth: 0 },

  iconWrap: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start' },
  title: { flex: 1, fontSize: 15, fontWeight: '500', color: '#14231C', lineHeight: 20 },
  titleUnread: { fontWeight: '800' },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: C.primary, marginLeft: 8, marginTop: 6 },
  body: { fontSize: 13.5, color: '#55645D', lineHeight: 19, marginTop: 3 },
  time: { fontSize: 12, color: '#8A9892', marginTop: 6 },

  emptyIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#E3EDE8', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  emptyTitle: { fontSize: 17, fontWeight: '800', color: '#14231C', textAlign: 'center' },
  emptyText: { textAlign: 'center', marginTop: 6, lineHeight: 20 },
});