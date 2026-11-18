import React, { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';
import { C } from '../lib/theme';

// Grey pulsing placeholders shown while content loads
export const Skel = ({ w = '100%', h = 16, r = 8, style }) => {
  const o = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    const a = Animated.loop(Animated.sequence([Animated.timing(o, { toValue: 1, duration: 700, useNativeDriver: true }), Animated.timing(o, { toValue: 0.45, duration: 700, useNativeDriver: true })]));
    a.start(); return () => a.stop();
  }, []);
  return <Animated.View style={[{ width: w, height: h, borderRadius: r, backgroundColor: '#DDE5E0', opacity: o }, style]} />;
};
export const SkeletonCard = () => (
  <View style={{ backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: C.border, marginHorizontal: 12, marginVertical: 6, overflow: 'hidden' }}>
    <Skel h={150} r={0} />
    <View style={{ padding: 12 }}><Skel w="70%" h={18} /><Skel w="45%" h={12} style={{ marginTop: 8 }} /><View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}><Skel w="30%" h={14} /><Skel w="25%" h={14} /></View></View>
  </View>
);
export const SkeletonMini = () => (
  <View style={{ width: 220, marginRight: 10, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: C.border, overflow: 'hidden' }}>
    <Skel h={110} r={0} /><View style={{ padding: 10 }}><Skel w="80%" h={14} /><Skel w="50%" h={12} style={{ marginTop: 8 }} /><Skel w="40%" h={12} style={{ marginTop: 8 }} /></View>
  </View>
);
export const SkeletonList = ({ n = 3 }) => <View>{Array.from({ length: n }).map((_, i) => <SkeletonCard key={i} />)}</View>;
