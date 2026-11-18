import React, { useState } from 'react';
import { TouchableOpacity, Text } from 'react-native';
import PickerSheet from './PickerSheet';
import { C } from '../lib/theme';

export default function DateField({ value, onChange, minimumDate, maximumDate, disabled, suffix = '', style }) {
  const [show, setShow] = useState(false);
  return (
    <>
      <TouchableOpacity
        disabled={disabled} onPress={() => setShow(true)}
        style={[{ borderWidth: 1, borderColor: C.primary, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginVertical: 4, opacity: disabled ? 0.6 : 1 }, style]}>
        <Text style={{ color: C.primary, fontWeight: '700' }}>📅 {value.toDateString()}{suffix}</Text>
      </TouchableOpacity>
      <PickerSheet
        visible={show} mode="date" value={value} minimumDate={minimumDate} maximumDate={maximumDate}
        onCancel={() => setShow(false)}
        onDone={(d) => { setShow(false); onChange(d); }}
      />
    </>
  );
}
