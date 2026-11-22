import React, { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { supabase, PAGE_SIZE } from '../../lib/supabase';
import { useAuth } from '../../lib/AuthContext';
import CountryPicker from '../../components/CountryPicker';
import { Btn, Card, Chip, H, Input, Label, Loader, Muted, Pager } from '../../components/ui';
import { C } from '../../lib/theme';

const CATEGORIES = ['hotel', 'campsite', 'attraction', 'activity'];
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));

export default function AdminPayouts({ canManage }) {
  const { formatMoney } = useAuth();
  const [search, setSearch] = useState('');
  const [country, setCountry] = useState('');
  const [category, setCategory] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [balancePage, setBalancePage] = useState(0);
  const [queuePage, setQueuePage] = useState(0);
  const [batchPage, setBatchPage] = useState(0);
  const [balances, setBalances] = useState([]);
  const [queue, setQueue] = useState([]);
  const [batches, setBatches] = useState([]);
  const [delayHours, setDelayHours] = useState('24');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const [balanceResult, queueResult, batchResult, settingsResult] = await Promise.all([
      supabase.rpc('admin_host_balances_page', {
        p_country: country || null,
        p_category: category || null,
        p_search: search.trim() || null,
        p_limit: PAGE_SIZE + 1,
        p_offset: balancePage * PAGE_SIZE,
      }),
      supabase.rpc('admin_payout_queue', {
        p_country: country || null,
        p_category: category || null,
        p_search: search.trim() || null,
        p_from: dateFrom || null,
        p_to: dateTo || null,
        p_limit: PAGE_SIZE + 1,
        p_offset: queuePage * PAGE_SIZE,
      }),
      supabase.rpc('admin_list_payout_batches', {
        p_limit: PAGE_SIZE + 1,
        p_offset: batchPage * PAGE_SIZE,
      }),
      supabase.from('app_settings').select('host_payout_delay_hours').eq('id', 1).single(),
    ]);
    const failed = [balanceResult, queueResult, batchResult, settingsResult].find((result) => result.error);
    if (failed) {
      Alert.alert('Could not load host payouts', failed.error.message);
    } else {
      setBalances(balanceResult.data || []);
      setQueue(queueResult.data || []);
      setBatches(batchResult.data || []);
      setDelayHours(String(settingsResult.data?.host_payout_delay_hours ?? 24));
    }
    setLoading(false);
  }, [country, category, search, dateFrom, dateTo, balancePage, queuePage, batchPage]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    setBalancePage(0);
    setQueuePage(0);
  }, [country, category, search, dateFrom, dateTo]);

  const saveDelay = async () => {
    const hours = Number(delayHours);
    if (!Number.isInteger(hours) || hours < 24 || hours > 48) {
      return Alert.alert('Payout delay', 'Set a whole number between 24 and 48 hours.');
    }
    setBusy('delay');
    const { error } = await supabase.rpc('admin_set_host_payout_delay', { p_hours: hours });
    setBusy('');
    if (error) return Alert.alert('Could not save payout delay', error.message);
    Alert.alert('Payout delay saved');
    load();
  };

  const shareBatchPdf = async (batchId) => {
    setBusy(`pdf:${batchId}`);
    const { data, error } = await supabase.rpc('admin_get_payout_batch', { p_batch: batchId });
    if (error) {
      setBusy('');
      return Alert.alert('Could not load payout batch', error.message);
    }
    try {
      const batch = data?.batch || {};
      const items = data?.items || [];
      const rows = items.map((item) => `<tr>
        <td>${escapeHtml(item.scheduled_date)} ${escapeHtml(item.start_time || '')}</td>
        <td>${escapeHtml(item.host_name)}</td>
        <td>${escapeHtml(item.country)} / ${escapeHtml(item.host_category)}</td>
        <td>${escapeHtml(item.listing_title)}</td>
        <td>${escapeHtml(item.booking_id)}</td>
        <td>${escapeHtml(formatMoney(item.net_amount))}</td>
      </tr>`).join('');
      const html = `<html><head><meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>body{font-family:Arial,sans-serif;padding:24px;color:#21332b}h1{font-size:20px}
        table{width:100%;border-collapse:collapse;font-size:10px}th,td{border:1px solid #ccd5d0;padding:6px;text-align:left}
        th{background:#e8efeb} .meta{margin:4px 0 16px}</style></head><body>
        <h1>RealTravo host payout batch</h1>
        <div class="meta">Batch ${escapeHtml(batch.id)} · ${escapeHtml(batch.status)} · ${items.length} bookings · ${escapeHtml(formatMoney(batch.total_amount))}</div>
        <div class="meta">Scheduled date filter: ${escapeHtml(batch.date_from || 'Any')} – ${escapeHtml(batch.date_to || 'Any')} · Country: ${escapeHtml(batch.country || 'All')} · Host category: ${escapeHtml(batch.category || 'All')}</div>
        <table><thead><tr><th>Trip date</th><th>Host</th><th>Country / category</th><th>Listing</th><th>Booking ID</th><th>Host net</th></tr></thead>
        <tbody>${rows}</tbody></table></body></html>`;
      const file = await Print.printToFileAsync({ html });
      await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: 'Payout batch PDF' });
    } catch (pdfError) {
      Alert.alert('Could not create payout PDF', pdfError.message);
    } finally {
      setBusy('');
    }
  };

  const createBatch = async () => {
    setBusy('create');
    const { data, error } = await supabase.rpc('admin_create_payout_batch', {
      p_country: country || null,
      p_category: category || null,
      p_search: search.trim() || null,
      p_from: dateFrom || null,
      p_to: dateTo || null,
    });
    setBusy('');
    if (error) return Alert.alert('Could not create payout batch', error.message);
    await load();
    await shareBatchPdf(data.batch.id);
  };

  const markPaid = (batch) => {
    Alert.alert(
      'Mark payout batch paid?',
      `Confirm the hosts in this batch have been paid ${formatMoney(batch.total_amount)}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Mark paid', onPress: async () => {
          setBusy(`paid:${batch.id}`);
          const { error } = await supabase.rpc('admin_mark_payout_batch_paid', { p_batch: batch.id });
          setBusy('');
          if (error) Alert.alert('Could not mark batch paid', error.message);
          else load();
        } },
      ],
    );
  };

  if (loading && !balances.length && !queue.length && !batches.length) return <Loader />;

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>
      <Card>
        <H>Host payout rules</H>
        <Muted>Only paid, completed trips become payable. Scheduled trips remain visible as upcoming. Payouts can be marked paid after the trip-completion delay.</Muted>
        <Label>Hours after completion before payout is eligible (24–48)</Label>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Input style={{ flex: 1 }} keyboardType="number-pad" value={delayHours} onChangeText={setDelayHours} />
          {canManage && <Btn title={busy === 'delay' ? 'Saving…' : 'Save delay'} disabled={!!busy} onPress={saveDelay} />}
        </View>
      </Card>

      <H>Host balances</H>
      <Card>
        <Label>Search host</Label><Input value={search} onChangeText={setSearch} placeholder="Name, business, or host ID" />
        <Label>Country</Label><CountryPicker value={country} onChange={setCountry} placeholder="All countries" />
        <Label>Host category</Label>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          <Chip label="All" active={!category} onPress={() => setCategory('')} />
          {CATEGORIES.map((item) => <Chip key={item} label={item} active={category === item} onPress={() => setCategory(category === item ? '' : item)} />)}
        </View>
      </Card>
      {balances.slice(0, PAGE_SIZE).map((host) => (
        <Card key={host.host_id}>
          <Text style={{ color: C.text, fontWeight: '800' }}>{host.name || 'Host'}</Text>
          <Muted>{host.country || 'Country not set'} · {host.category || 'Category not set'}{host.business_name ? ` · ${host.business_name}` : ''}</Muted>
          <Muted>Gross {formatMoney(host.gross)} · platform fee {formatMoney(host.platform_fee)}</Muted>
          <Muted>Net {formatMoney(host.net)} · paid {formatMoney(host.paid_out)}</Muted>
          <Text style={{ color: C.primary, fontSize: 18, fontWeight: '800' }}>Balance: {formatMoney(host.balance)}</Text>
          <Muted>Oldest pending trip: {host.oldest_pending_date || '—'}</Muted>
        </Card>
      ))}
      <Pager page={balancePage} setPage={setBalancePage} hasMore={balances.length > PAGE_SIZE} />

      <H>Pending trips · oldest scheduled first</H>
      <Card>
        <Label>Scheduled trip date range</Label>
        <View style={{ flexDirection: 'row' }}>
          <Input style={{ flex: 1, marginRight: 4 }} placeholder="From YYYY-MM-DD" value={dateFrom} onChangeText={setDateFrom} />
          <Input style={{ flex: 1, marginLeft: 4 }} placeholder="To YYYY-MM-DD" value={dateTo} onChangeText={setDateTo} />
        </View>
        <Muted>Upcoming trips are listed but cannot be batched. Only completed trips past the configured delay are eligible.</Muted>
        {canManage && <Btn title={busy === 'create' ? 'Preparing…' : 'Create PDF batch (up to 100 eligible trips)'} disabled={!!busy || !queue.some((item) => item.payout_state === 'eligible')} onPress={createBatch} />}
      </Card>
      {queue.slice(0, PAGE_SIZE).map((item) => (
        <Card key={item.booking_id}>
          <Text style={{ color: C.text, fontWeight: '800' }}>{item.scheduled_date}{item.start_time ? ` · ${item.start_time.slice(0, 5)}` : ''} · {item.listing_title}</Text>
          <Muted>{item.host_name} · {item.country || 'Country not set'} · {item.host_category || 'Category not set'} · {item.listing_category}</Muted>
          <Muted>Booking {item.booking_id} · {item.booking_status} · host net {formatMoney(item.net_amount)}</Muted>
          <Text style={{ color: item.payout_state === 'eligible' ? C.primary : C.muted, fontWeight: '700' }}>
            {item.payout_state === 'eligible' ? 'Ready for payout' : item.payout_state === 'waiting' ? `Delay ends ${new Date(item.eligible_at).toLocaleString()}` : 'Scheduled / awaiting completion'}
          </Text>
        </Card>
      ))}
      <Pager page={queuePage} setPage={setQueuePage} hasMore={queue.length > PAGE_SIZE} />

      <H>Payout batches</H>
      {batches.slice(0, PAGE_SIZE).map((batch) => (
        <Card key={batch.id}>
          <Text style={{ color: C.text, fontWeight: '800' }}>{batch.status === 'paid' ? 'Paid batch' : 'Awaiting payment'} · {batch.booking_count} trips</Text>
          <Muted>{batch.created_at ? new Date(batch.created_at).toLocaleDateString() : ''} · {batch.date_from || 'Any date'} – {batch.date_to || 'Any date'} · {batch.country || 'All countries'} · {batch.category || 'All categories'}</Muted>
          <Text style={{ color: C.primary, fontSize: 18, fontWeight: '800' }}>{formatMoney(batch.total_amount)}</Text>
          {batch.paid_at && <Muted>Paid {new Date(batch.paid_at).toLocaleString()}</Muted>}
          <View style={{ flexDirection: 'row' }}>
            <Btn style={{ flex: 1, marginRight: 4 }} kind="ghost" title={busy === `pdf:${batch.id}` ? 'Preparing PDF…' : 'Download PDF'} disabled={!!busy} onPress={() => shareBatchPdf(batch.id)} />
            {canManage && batch.status !== 'paid' && <Btn style={{ flex: 1, marginLeft: 4 }} title="Mark paid" disabled={!!busy} onPress={() => markPaid(batch)} />}
          </View>
        </Card>
      ))}
      <Pager page={batchPage} setPage={setBatchPage} hasMore={batches.length > PAGE_SIZE} />
      {loading && <Loader />}
    </ScrollView>
  );
}
