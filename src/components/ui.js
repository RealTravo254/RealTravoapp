import React from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleSheet, ActivityIndicator, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from '../lib/theme';
import { useWishlist } from '../lib/wishlist';
import { useAuth } from '../lib/AuthContext';
import ShareButton from './ShareButton';
import Img from './Img';

export const Btn = ({ title, onPress, kind = 'primary', disabled, style }) => (
  <TouchableOpacity disabled={disabled} onPress={onPress} style={[s.btn, kind === 'ghost' && s.ghost, kind === 'danger' && { backgroundColor: C.danger }, disabled && { opacity: 0.5 }, style]}>
    <Text style={[s.btnT, kind === 'ghost' && { color: C.primary }]}>{title}</Text>
  </TouchableOpacity>
);
export const Input = (p) => <TextInput placeholderTextColor={C.muted} {...p} style={[s.input, p.multiline && { height: 90, textAlignVertical: 'top' }, p.style]} />;
export const Label = ({ children }) => <Text style={s.label}>{children}</Text>;
export const Card = ({ children, style, onPress }) => onPress
  ? <TouchableOpacity onPress={onPress} style={[s.card, style]}>{children}</TouchableOpacity>
  : <View style={[s.card, style]}>{children}</View>;
export const H = ({ children }) => <Text style={s.h}>{children}</Text>;
export const Muted = ({ children, style }) => <Text style={[{ color: C.muted }, style]}>{children}</Text>;
export const Loader = () => <ActivityIndicator color={C.primary} style={{ margin: 20 }} />;
export const Chip = ({ label, active, onPress }) => (
  <TouchableOpacity onPress={onPress} style={[s.chip, active && { backgroundColor: C.primary }]}>
    <Text style={{ color: active ? '#fff' : C.text }}>{label}</Text>
  </TouchableOpacity>
);
export const Pager = ({ page, setPage, hasMore }) => {
  if (page === 0 && !hasMore) return null; // nothing more to show
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', padding: 12 }}>
      {page > 0 ? <Btn title="‹ Previous" kind="ghost" onPress={() => setPage(page - 1)} /> : <View />}
      {hasMore ? <Btn title="See more ›" kind="ghost" onPress={() => setPage(page + 1)} /> : <View />}
    </View>
  );
};
// Save (bookmark) button: works without login
export const SaveButton = ({ id, style }) => {
  const { has, toggle } = useWishlist();
  const on = has(id);
  return (
    <TouchableOpacity onPress={() => toggle(id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={[{ position: 'absolute', top: 10, right: 10, backgroundColor: 'rgba(255,255,255,0.94)', borderRadius: 18, width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }, style]}>
      <Ionicons name={on ? 'heart' : 'heart-outline'} size={21} color={on ? '#D64545' : C.text} />
    </TouchableOpacity>
  );
};
export const Heart = SaveButton;

// + / − selector for guests, nights, people
export const Stepper = ({ label, value, onChange, min = 1, max = 99, suffix = '' }) => {
  const dis = (b) => ({ width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: C.primary, alignItems: 'center', justifyContent: 'center', opacity: b ? 0.35 : 1 });
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 10, marginVertical: 6 }}>
      <Text style={{ fontWeight: '600', color: C.text, flex: 1 }}>{label}</Text>
      <TouchableOpacity disabled={value <= min} onPress={() => onChange(value - 1)} style={dis(value <= min)}><Ionicons name="remove" size={20} color={C.primary} /></TouchableOpacity>
      <Text style={{ minWidth: 56, textAlign: 'center', fontSize: 18, fontWeight: '800', color: C.text }}>{value}{suffix}</Text>
      <TouchableOpacity disabled={value >= max} onPress={() => onChange(value + 1)} style={dis(value >= max)}><Ionicons name="add" size={20} color={C.primary} /></TouchableOpacity>
    </View>);
};
const priceText = (p, formatMoney) => (p != null ? (Number(p) === 0 ? 'Free entry' : `from ${formatMoney(p)}`) : '');
export const ListingCard = ({ item, onPress }) => {
  const { formatMoney } = useAuth();
  return (
    <Card onPress={onPress} style={{ padding: 0, overflow: 'hidden' }}>
    <View>
      <Img uri={item.cover} category={item.category} style={{ height: 150 }} />
      <SaveButton id={item.id} /><ShareButton item={item} />
    </View>
    <View style={{ padding: 12 }}>
      <Text style={{ fontWeight: '700', fontSize: 16, color: C.text }}>{item.title}</Text>
      <Muted>{item.category} · {item.region || item.country}</Muted>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
        <Text>⭐ {Number(item.rating_avg || 0).toFixed(1)} ({item.rating_count})</Text>
        <Text style={{ fontWeight: '700', color: C.primary }}>{priceText(item.from_price, formatMoney)}</Text>
      </View>
    </View>
    </Card>
  );
};
// Compact card for the "Top rated" row
export const MiniCard = ({ item, onPress }) => {
  const { formatMoney } = useAuth();
  return (
    <TouchableOpacity onPress={onPress} style={{ width: 220, marginRight: 10, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: C.border, overflow: 'hidden' }}>
    <View>
      <Img uri={item.cover} category={item.category} style={{ height: 110 }} />
      <SaveButton id={item.id} style={{ width: 30, height: 30, borderRadius: 15 }} />
    </View>
    <View style={{ padding: 10 }}>
      <Text numberOfLines={1} style={{ fontWeight: '700', color: C.text }}>{item.title}</Text>
      <Muted>{item.region || item.country}{item.distance_km != null ? ` · ${Math.round(item.distance_km)} km` : ''}</Muted>
      <Text style={{ marginTop: 4 }}>⭐ {Number(item.rating_avg || 0).toFixed(1)}  <Text style={{ color: C.primary, fontWeight: '700' }}>{priceText(item.from_price, formatMoney)}</Text></Text>
    </View>
    </TouchableOpacity>
  );
};
const s = StyleSheet.create({
  btn: { backgroundColor: C.primary, paddingVertical: 12, paddingHorizontal: 18, borderRadius: 10, alignItems: 'center', marginVertical: 4 },
  ghost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: C.primary },
  btnT: { color: '#fff', fontWeight: '700' },
  input: { borderWidth: 1, borderColor: C.border, backgroundColor: '#fff', borderRadius: 10, padding: 12, marginVertical: 6, color: C.text },
  label: { fontWeight: '600', marginTop: 8, color: C.text },
  card: { backgroundColor: C.card, borderRadius: 14, padding: 14, marginHorizontal: 12, marginVertical: 6, borderWidth: 1, borderColor: C.border },
  h: { fontSize: 20, fontWeight: '800', margin: 12, color: C.text },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#E8EEF0', marginRight: 8 },
});
