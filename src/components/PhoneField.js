import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Modal, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { C } from '../lib/theme';

let CACHE = null; // countries with dial codes (loaded once)
const flag = (iso) => (iso ? iso.toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0))) : '🌍');

// Phone number with the country flag and dial code. The code follows the selected country automatically and can be changed.
// value is the full international number, e.g. +255712345678
export default function PhoneField({ country, value, onChange, placeholder = '712 345 678' }) {
  const [list, setList] = useState(CACHE || []); const [pick, setPick] = useState(null); const [local, setLocal] = useState(''); const [open, setOpen] = useState(false); const [q, setQ] = useState(''); const [inited, setInited] = useState(false);
  useEffect(() => { if (CACHE) return; supabase.from('countries').select('name,code,dial_code').eq('active', true).order('name').then(({ data }) => { CACHE = data || []; setList(CACHE); }); }, []);
  // existing number: split it into dial code + local part once the list is loaded
  useEffect(() => {
    if (inited || !list.length) return;
    if (value) {
      const m = [...list].filter((c) => c.dial_code && value.startsWith(c.dial_code)).sort((a, b) => b.dial_code.length - a.dial_code.length)[0];
      if (m) { setPick(m.name); setLocal(value.slice(m.dial_code.length)); }
    }
    setInited(true);
  }, [list]);
  useEffect(() => { setPick(null); }, [country]);
  const cur = list.find((c) => c.name === (pick || country));
  const dial = cur?.dial_code || '';
  useEffect(() => { if (!inited) return; const full = local ? `${dial}${local}` : ''; if (full !== (value || '')) onChange(full); }, [dial, local, inited]);
  const shown = list.filter((c) => (c.name + c.dial_code).toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 6 }}>
      <TouchableOpacity onPress={() => setOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: C.border, backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 10, height: 48, marginRight: 8 }}>
        <Text style={{ fontSize: 20 }}>{flag(cur?.code)}</Text><Text style={{ marginLeft: 6, fontWeight: '700', color: C.text }}>{dial || '+'}</Text><Ionicons name="chevron-down" size={14} color={C.muted} style={{ marginLeft: 4 }} />
      </TouchableOpacity>
      <TextInput value={local} onChangeText={(t) => setLocal(t.replace(/\D/g, '').replace(/^0+/, ''))} keyboardType="phone-pad" placeholder={placeholder} placeholderTextColor={C.muted}
        style={{ flex: 1, height: 48, borderWidth: 1, borderColor: C.border, backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 12, color: C.text }} />
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12 }}>
            <TextInput autoFocus value={q} onChangeText={setQ} placeholder="Search country or code" placeholderTextColor={C.muted} style={{ flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10 }} />
            <TouchableOpacity onPress={() => setOpen(false)} style={{ padding: 10 }}><Text style={{ color: C.primary, fontWeight: '700' }}>Close</Text></TouchableOpacity>
          </View>
          <FlatList data={shown} keyExtractor={(i) => i.name} keyboardShouldPersistTaps="handled" renderItem={({ item }) => (
            <TouchableOpacity onPress={() => { setPick(item.name); setOpen(false); setQ(''); }} style={{ flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: 1, borderColor: C.border }}>
              <Text style={{ fontSize: 22, width: 36 }}>{flag(item.code)}</Text><Text style={{ flex: 1, fontSize: 16 }}>{item.name}</Text><Text style={{ color: C.muted, fontWeight: '700' }}>{item.dial_code}</Text>
            </TouchableOpacity>)} />
        </SafeAreaView>
      </Modal>
    </View>
  );
}
