// components/Pagination.js — numbered pager with "Showing 1–10 of 47"
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PAGE_SIZE } from '../lib/supabase';
import { C, shadow } from '../lib/theme';

function pageWindow(current, total) {
  if (total <= 5) return Array.from({ length: total }, (_, i) => i);
  const set = new Set([0, total - 1, current - 1, current, current + 1]);
  const nums = [...set].filter((n) => n >= 0 && n < total).sort((a, b) => a - b);
  const out = [];
  nums.forEach((n, i) => {
    if (i > 0 && n - nums[i - 1] > 1) out.push('…');
    out.push(n);
  });
  return out;
}

export default function Pagination({ page, setPage, total, disabled }) {
  if (!total) return null;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = page * PAGE_SIZE + 1;
  const to = Math.min(total, (page + 1) * PAGE_SIZE);
  const prevOff = page === 0 || disabled;
  const nextOff = page >= pages - 1 || disabled;

  return (
    <View style={s.wrap}>
      <Text style={s.info}>Showing {from}–{to} of {total}</Text>
      <View style={s.bar}>
        <TouchableOpacity disabled={prevOff} onPress={() => setPage(page - 1)} style={[s.arrow, prevOff && s.off]}>
          <Ionicons name="chevron-back" size={18} color={prevOff ? C.muted : C.primary} />
        </TouchableOpacity>

        <View style={s.numbers}>
          {pageWindow(page, pages).map((n, i) =>
            n === '…' ? (
              <Text key={`gap${i}`} style={s.gap}>…</Text>
            ) : (
              <TouchableOpacity
                key={n}
                disabled={disabled}
                onPress={() => setPage(n)}
                style={[s.num, n === page && s.numActive]}
              >
                <Text style={[s.numText, n === page && s.numTextActive]}>{n + 1}</Text>
              </TouchableOpacity>
            )
          )}
        </View>

        <TouchableOpacity disabled={nextOff} onPress={() => setPage(page + 1)} style={[s.arrow, nextOff && s.off]}>
          <Ionicons name="chevron-forward" size={18} color={nextOff ? C.muted : C.primary} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginTop: 8, alignItems: 'center' },
  info: { fontSize: 12, color: C.muted, marginBottom: 8 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
    backgroundColor: C.card,
    borderRadius: 16,
    padding: 8,
    ...shadow,
  },
  arrow: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.primarySoft,
  },
  off: { backgroundColor: C.greySoft },
  numbers: { flexDirection: 'row', alignItems: 'center' },
  num: { minWidth: 38, height: 38, borderRadius: 12, marginHorizontal: 2, alignItems: 'center', justifyContent: 'center' },
  numActive: { backgroundColor: C.primary },
  numText: { fontSize: 14, fontWeight: '700', color: C.ink },
  numTextActive: { color: '#fff' },
  gap: { color: C.muted, fontWeight: '700', marginHorizontal: 4 },
});