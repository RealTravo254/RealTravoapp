import React from 'react';
import { View } from 'react-native';
import { Btn, Chip, Muted } from './ui';
import TimeField from './TimeField';

// If the host set fixed pickup times, the guest picks one of them. Otherwise the guest chooses any time.
export default function PickupTimeField({ times, value, onChange, label = 'Pickup time' }) {
  if (times?.length) return (
    <View>
      <Muted>The host offers these pickup times. Choose one.</Muted>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 }}>
        {times.map((t) => <View key={t} style={{ marginBottom: 6 }}><Chip label={`🕒 ${t}`} active={value === t} onPress={() => onChange(t)} /></View>)}
      </View>
    </View>);
  return value ? <TimeField label={label} value={value} onChange={onChange} /> : <Btn kind="ghost" title="🕒 Choose pickup time" onPress={() => onChange('08:00')} />;
}
