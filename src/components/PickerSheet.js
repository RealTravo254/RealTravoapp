import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { C } from '../lib/theme';

// Android: native dialog. iOS: bottom sheet with a spinner and Cancel / Done.
export default function PickerSheet({ visible, mode, value, onDone, onCancel, ...rest }) {
  const [temp, setTemp] = useState(value);
  useEffect(() => { if (visible) setTemp(value); }, [visible]);
  if (!visible) return null;

  if (Platform.OS === 'android') {
    return (
      <DateTimePicker
        value={value} mode={mode} {...rest}
        onValueChange={(_, v) => { if (v) onDone(v); }}
        onDismiss={onCancel}
      />
    );
  }
  return (
    <Modal transparent animationType="slide" visible onRequestClose={onCancel}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.3)' }}>
        <View style={{ backgroundColor: '#fff', paddingBottom: 24 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', padding: 14 }}>
            <TouchableOpacity onPress={onCancel}><Text style={{ fontSize: 16 }}>Cancel</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => onDone(temp)}><Text style={{ fontSize: 16, fontWeight: '800', color: C.primary }}>Done</Text></TouchableOpacity>
          </View>
          <DateTimePicker
            value={temp} mode={mode} display="spinner" {...rest}
            onValueChange={(_, v) => { if (v) setTemp(v); }}
          />
        </View>
      </View>
    </Modal>
  );
}
