import React, { useCallback, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase, PAGE_SIZE } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { Btn, Muted, Pager, Loader } from '../components/ui';
import { C } from '../lib/theme';

export default function Notifications({ navigation }) {
  const { session } = useAuth();
  const [rows, setRows] = useState([]); const [page, setPage] = useState(0); const [more, setMore] = useState(false); const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    const { data } = await supabase.from('notifications').select('*').eq('user_id', session.user.id).order('created_at', { ascending: false }).range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
    setMore((data || []).length > PAGE_SIZE); setRows((data || []).slice(0, PAGE_SIZE)); setLoading(false);
  }, [page, session]);
  useFocusEffect(useCallback(() => { load(); }, [load]));
  const markAll = async () => { await supabase.from('notifications').update({ read: true }).eq('user_id', session.user.id).eq('read', false); load(); };
  const open = async (n) => { if (!n.read) { await supabase.from('notifications').update({ read: true }).eq('id', n.id); load(); } };
  if (!session) return <View style={{ flex: 1, justifyContent: 'center', padding: 28 }}><Muted style={{ textAlign: 'center' }}>Sign in to see notifications.</Muted><Btn title="Sign in" onPress={() => navigation.navigate('Auth', { reason: 'notifications' })} /></View>;
  return (
    <View style={{ flex: 1 }}>
      <Btn kind="ghost" title="Mark all as read" style={{ margin: 12 }} onPress={markAll} />
      {loading ? <Loader /> : <FlatList data={rows} keyExtractor={(i) => i.id}
        ListEmptyComponent={<Muted style={{ textAlign: 'center', margin: 30 }}>No notifications yet.</Muted>}
        ListFooterComponent={<Pager page={page} setPage={setPage} hasMore={more} />}
        renderItem={({ item: n }) => (
          <TouchableOpacity onPress={() => open(n)} style={{ flexDirection: 'row', padding: 14, backgroundColor: n.read ? '#fff' : '#E3EDE8', borderBottomWidth: 1, borderColor: C.border }}>
            <Ionicons name={n.urgent ? 'alert-circle' : 'notifications-outline'} size={22} color={n.urgent ? C.danger : C.primary} style={{ marginRight: 10 }} />
            <View style={{ flex: 1 }}><Text style={{ fontWeight: n.read ? '500' : '800' }}>{n.title}</Text>{n.body ? <Muted>{n.body}</Muted> : null}
              <Muted style={{ fontSize: 11 }}>{new Date(n.created_at).toLocaleString()}</Muted></View>
          </TouchableOpacity>)} />}
    </View>
  );
}
