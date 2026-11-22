import React, { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { Card, Muted } from '../components/ui';
import { C } from '../lib/theme';

function Metric({ label, value, color }) {
  return (
    <Card style={{ flexBasis: '47%', flexGrow: 1 }}>
      <Muted>{label}</Muted>
      <Text style={{ color: color || C.text, fontSize: 18, fontWeight: '800', marginTop: 4 }}>{value}</Text>
    </Card>
  );
}

export default function Wallet() {
  const insets = useSafeAreaInsets();
  const { formatMoney } = useAuth();
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const { data, error: requestError } = await supabase.rpc('wallet_finance_overview');
    if (requestError) {
      setError(requestError.message);
      setLoading(false);
      return;
    }
    if (!data || data.balance == null) {
      setError('Wallet information is unavailable.');
      setLoading(false);
      return;
    }
    setOverview(data);
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ paddingTop: insets.top + 12, paddingHorizontal: 16, paddingBottom: 8 }}>
        <Text style={{ color: C.text, fontSize: 24, fontWeight: '800' }}>Wallet</Text>
      </View>
      {loading ? <ActivityIndicator style={{ marginTop: 40 }} color={C.primary} /> : error ? (
        <Text style={{ color: C.danger, margin: 16 }}>{error}</Text>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
          <Card style={{ marginTop: 8, padding: 22, backgroundColor: '#E3EDE8' }}>
            <Muted>{overview.role === 'host' ? 'Host balance' : 'Traveller balance'}</Muted>
            <Text style={{ fontSize: 32, fontWeight: '800', color: C.primary, marginTop: 8 }}>
              {formatMoney(overview.balance)}
            </Text>
            <Muted style={{ marginTop: 8 }}>
              {overview.role === 'host' ? 'Unpaid earnings remain pending until the trip is complete and the payout delay has passed.' : 'Available balance for your bookings.'}
            </Muted>
          </Card>

          {overview.role === 'host' ? (
            <>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                <Metric label="Gross sales" value={formatMoney(overview.gross)} />
                <Metric label="Platform fees" value={formatMoney(overview.platform_fee)} color={C.danger} />
                <Metric label="Net earnings" value={formatMoney(overview.net)} />
                <Metric label="Already paid" value={formatMoney(overview.paid_out)} />
                <Metric label="Awaiting completion / delay" value={formatMoney(overview.pending_trip_net)} />
              </View>
              <Text style={{ color: C.text, fontSize: 18, fontWeight: '800', margin: 14 }}>Earnings by category</Text>
              {(overview.categories || []).map((item) => (
                <Card key={item.category}>
                  <Text style={{ color: C.text, fontWeight: '800', textTransform: 'capitalize' }}>{item.category}</Text>
                  <Muted>{item.booking_count} paid bookings · gross {formatMoney(item.gross)} · net {formatMoney(item.net)}</Muted>
                </Card>
              ))}
              <Text style={{ color: C.text, fontSize: 18, fontWeight: '800', margin: 14 }}>Recent bookings</Text>
              {(overview.recent_bookings || []).map((item) => (
                <Card key={item.id}>
                  <Text style={{ color: C.text, fontWeight: '800' }}>{item.title || 'Booking'} · {item.category}</Text>
                  <Muted>{item.start_date || 'Date not set'} · {item.status} · {item.payment_status}</Muted>
                  <Muted>Gross {formatMoney(item.total)} · net {formatMoney(Number(item.total || 0) - Number(item.commission || 0))}</Muted>
                </Card>
              ))}
              <Text style={{ color: C.text, fontSize: 18, fontWeight: '800', margin: 14 }}>Recent payouts</Text>
              {(overview.recent_payouts || []).map((item, index) => (
                <Card key={`${item.created_at}-${index}`}>
                  <Text style={{ color: C.text, fontWeight: '700' }}>{formatMoney(item.amount)}</Text>
                  <Muted>{item.created_at ? new Date(item.created_at).toLocaleDateString() : ''}{item.note ? ` · ${item.note}` : ''}</Muted>
                </Card>
              ))}
            </>
          ) : (
            <>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                <Metric label="Paid bookings" value={formatMoney(overview.spent)} />
                <Metric label="Awaiting payment" value={formatMoney(overview.pending_payment)} color={C.amberInk} />
                <Metric label="Refunded" value={formatMoney(overview.refunded)} color={C.primary} />
                <Metric label="Bookings" value={`${overview.paid_count || 0} paid / ${overview.booking_count || 0} total`} />
              </View>
              <Text style={{ color: C.text, fontSize: 18, fontWeight: '800', margin: 14 }}>Recent bookings</Text>
              {(overview.recent_bookings || []).map((item) => (
                <Card key={item.id}>
                  <Text style={{ color: C.text, fontWeight: '800' }}>{item.title || 'Booking'} · {item.category || 'Trip'}</Text>
                  <Muted>{item.start_date || 'Date not set'} · {item.status} · {item.payment_status}</Muted>
                  <Text style={{ color: C.text, fontWeight: '700' }}>{formatMoney(item.total)}</Text>
                </Card>
              ))}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}
