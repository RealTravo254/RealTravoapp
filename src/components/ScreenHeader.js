import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { C } from '../lib/theme';
import { useMenu } from './MenuDrawer';
import Logo from './Logo';

// Bell with a red badge when there are unread notifications; it updates live when a new one arrives
export function Bell({ color = C.text }) {
  const nav = useNavigation(); const { session } = useAuth(); const [n, setN] = useState(0);
  const refresh = useCallback(() => {
    if (!session) { setN(0); return; }
    supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', session.user.id).eq('read', false).then(({ count }) => setN(count || 0));
  }, [session?.user?.id]);
  useFocusEffect(refresh);
  useEffect(() => {
    if (!session) return;
    const ch = supabase.channel(`bell-${session.user.id}-${Math.random().toString(36).slice(2, 7)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${session.user.id}` }, refresh).subscribe();
    const t = setInterval(refresh, 60000); // safety net
    return () => { clearInterval(t); supabase.removeChannel(ch); };
  }, [session?.user?.id, refresh]);
  return (
    <TouchableOpacity onPress={() => (session ? nav.navigate('Notifications') : nav.navigate('Auth', { reason: 'notifications' }))} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
      <Ionicons name={n > 0 ? 'notifications' : 'notifications-outline'} size={26} color={color} />
      {n > 0 && <View style={{ position: 'absolute', top: -5, right: -7, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: '#E53935', borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 }}>
        <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>{n > 9 ? '9+' : n}</Text></View>}
    </TouchableOpacity>
  );
}

// White header on every main page: menu, RealTravo logo, optional search icon, notification bell. It never shows the page name.
export default function ScreenHeader({ onSearch }) {
  const insets = useSafeAreaInsets(); const menu = useMenu();
  return (
    <View style={{ backgroundColor: '#FFFFFF', paddingTop: insets.top + 6, paddingBottom: 10, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: C.border }}>
      <TouchableOpacity onPress={menu.open} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={{ marginRight: 12 }}>
        <Ionicons name="menu" size={28} color={C.text} />
      </TouchableOpacity>
      <Logo size={30} withText />
      <View style={{ flex: 1 }} />
      {onSearch ? <TouchableOpacity onPress={onSearch} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={{ marginRight: 18 }}><Ionicons name="search" size={25} color={C.text} /></TouchableOpacity> : null}
      <Bell color={C.text} />
    </View>
  );
}
