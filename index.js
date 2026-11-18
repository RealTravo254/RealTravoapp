import React from 'react';
import { registerRootComponent } from 'expo';
import { View, Text, ScrollView } from 'react-native';

// If something fails while the app starts, show the reason on screen (instead of the app closing).
let Root;
try {
  Root = require('./App').default;
} catch (e) {
  const msg = String((e && e.stack) || e);
  Root = function StartupError() {
    return (
      <View style={{ flex: 1, backgroundColor: '#fff', padding: 24, paddingTop: 70 }}>
        <Text style={{ fontSize: 22, fontWeight: '800', color: '#1B1F24' }}>RealTravo could not start</Text>
        <Text style={{ color: '#6B7280', marginVertical: 10 }}>Please send this message to support:</Text>
        <ScrollView style={{ backgroundColor: '#F7F8FA', borderRadius: 10, padding: 12 }}><Text selectable style={{ color: '#D64545' }}>{msg}</Text></ScrollView>
      </View>
    );
  };
}
registerRootComponent(Root);
