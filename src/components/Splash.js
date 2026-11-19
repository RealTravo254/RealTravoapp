import React from 'react';
import { View, Image, Text, Dimensions, StyleSheet } from 'react-native';

// Opening screen: a BIG RealTravo logo with the theme line, shown at once (no animation).
const LOGO = require('../../assets/logo.png');
const WORDS = ['SEARCH', 'BOOK', 'TRAVEL', 'EXPERIENCE'];
export default function Splash({ onDone }) {
  const a = Image.resolveAssetSource(LOGO); const w = Dimensions.get('window').width * 0.92;
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', zIndex: 999 }]}>
      <Image source={LOGO} style={{ width: w, height: w * a.height / a.width }} resizeMode="contain" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginTop: 22, paddingHorizontal: 16 }}>
        {WORDS.map((x, i) => (
          <Text key={x} style={{ fontSize: 15, fontWeight: '800', letterSpacing: 2, color: i % 2 ? '#F4A261' : '#0B6B0B' }}>{x}{i < WORDS.length - 1 ? '  ·  ' : ''}</Text>
        ))}
      </View>
    </View>
  );
}
