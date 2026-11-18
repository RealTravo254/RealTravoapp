import React, { useState } from 'react';
import { TouchableOpacity, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import PickerSheet from './PickerSheet';
import { C } from '../lib/theme';

// value is "HH:MM"
export default function TimeField({ value, onChange, label }) {
  const [show, setShow] = useState(false);
  const [h, m] = (value || '10:00').split(':').map(Number);
  const d = new Date(); d.setHours(h, m, 0, 0);
  return (
    <>
      <TouchableOpacity onPress={() => setShow(true)} style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: C.primary, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginVertical: 4 }}>
        <Ionicons name="time-outline" size={18} color={C.primary} />
        <Text style={{ marginLeft: 8, color: C.primary, fontWeight: '700' }}>{label ? `${label}: ` : ''}{value || '10:00'}</Text>
      </TouchableOpacity>
      <PickerSheet
        visible={show} mode="time" value={d} is24Hour
        onCancel={() => setShow(false)}
        onDone={(t) => { setShow(false); onChange(`${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`); }}
      />
    </>
  );
}
