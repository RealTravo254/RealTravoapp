import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { C } from '../lib/theme';

// Dropdown: options = [{ value, label }]
export default function SelectField({ value, options, onChange, placeholder = 'Select', title, style }) {
  const [open, setOpen] = useState(false);
  const cur = options.find((o) => o.value === value);
  return (
    <>
      <TouchableOpacity onPress={() => setOpen(true)} style={[{ borderWidth: 1, borderColor: C.border, backgroundColor: '#fff', borderRadius: 10, padding: 12, marginVertical: 6, flexDirection: 'row', alignItems: 'center' }, style]}>
        <Text style={{ flex: 1, color: cur ? C.text : C.muted }}>{cur ? cur.label : placeholder}</Text>
        <Ionicons name="chevron-down" size={18} color={C.muted} />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity activeOpacity={1} onPress={() => setOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 24 }}>
          <SafeAreaView edges={[]} style={{ backgroundColor: '#fff', borderRadius: 16, maxHeight: '70%', overflow: 'hidden' }}>
            {title ? <Text style={{ fontWeight: '800', fontSize: 16, padding: 16, borderBottomWidth: 1, borderColor: C.border }}>{title}</Text> : null}
            <FlatList data={options} keyExtractor={(o) => String(o.value)} renderItem={({ item }) => (
              <TouchableOpacity onPress={() => { onChange(item.value); setOpen(false); }} style={{ padding: 16, flexDirection: 'row', borderBottomWidth: 1, borderColor: C.border }}>
                <Text style={{ flex: 1, fontSize: 16 }}>{item.label}</Text>{item.value === value && <Ionicons name="checkmark" size={20} color={C.primary} />}
              </TouchableOpacity>)} />
          </SafeAreaView>
        </TouchableOpacity>
      </Modal>
    </>
  );
}
