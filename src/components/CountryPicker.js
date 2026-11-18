import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, FlatList, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { C } from '../lib/theme';

// Countries come from the `countries` table (managed by the admin)
export default function CountryPicker({ value, onChange, placeholder = 'Select country' }) {
  const [open, setOpen] = useState(false); const [list, setList] = useState([]); const [q, setQ] = useState('');
  useEffect(() => { supabase.from('countries').select('name,code').eq('active', true).order('name').then(({ data }) => setList(data || [])); }, []);
  const shown = list.filter((c) => c.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <>
      <TouchableOpacity onPress={() => setOpen(true)} style={{ borderWidth: 1, borderColor: C.border, backgroundColor: '#fff', borderRadius: 10, padding: 12, marginVertical: 6, flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ flex: 1, color: value ? C.text : C.muted }}>{value || placeholder}</Text>
        <Ionicons name="chevron-down" size={18} color={C.muted} />
      </TouchableOpacity>
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', padding: 12 }}>
            <TextInput autoFocus value={q} onChangeText={setQ} placeholder="Search country" placeholderTextColor={C.muted}
              style={{ flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10 }} />
            <TouchableOpacity onPress={() => setOpen(false)} style={{ padding: 10 }}><Text style={{ color: C.primary, fontWeight: '700' }}>Close</Text></TouchableOpacity>
          </View>
          <FlatList data={shown} keyExtractor={(i) => i.name} keyboardShouldPersistTaps="handled"
            ListEmptyComponent={<Text style={{ textAlign: 'center', color: C.muted, margin: 30 }}>No countries found. The admin can add more.</Text>}
            renderItem={({ item }) => (
              <TouchableOpacity onPress={() => { onChange(item.name); setOpen(false); setQ(''); }} style={{ padding: 16, borderBottomWidth: 1, borderColor: C.border, flexDirection: 'row' }}>
                <Text style={{ flex: 1, fontSize: 16 }}>{item.name}</Text>
                {value === item.name && <Ionicons name="checkmark" size={20} color={C.primary} />}
              </TouchableOpacity>)} />
        </SafeAreaView>
      </Modal>
    </>
  );
}
