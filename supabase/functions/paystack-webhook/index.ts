// Paystack webhook (deploy with verify_jwt = false). Set the URL in Paystack dashboard > Settings > API & Webhooks.
import { createClient } from 'npm:@supabase/supabase-js@2';

async function hmac512(secret: string, data: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}
Deno.serve(async (req) => {
  const raw = await req.text();
  const sig = req.headers.get('x-paystack-signature');
  if (!sig || sig !== await hmac512(Deno.env.get('PAYSTACK_SECRET_KEY')!, raw)) return new Response('bad signature', { status: 401 });
  const ev = JSON.parse(raw); if (ev.event !== 'charge.success') return new Response('ignored');
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const ref = ev.data.reference;
  const { data: pay } = await admin.from('payments').select('*').eq('reference', ref).maybeSingle();
  if (!pay || pay.status === 'success') return new Response('ok');
  await admin.from('payments').update({ status: 'success' }).eq('reference', ref);

  const notify = (user_id: string, title: string, body: string, urgent = false) =>
    admin.from('notifications').insert({ user_id, title, body, urgent, channel: urgent ? ['in_app', 'email', 'sms', 'whatsapp'] : ['in_app', 'email'] });

  if (pay.purpose === 'booking' && pay.booking_id) {
    const { data: b } = await admin.from('bookings').update({ payment_status: 'paid' }).eq('id', pay.booking_id).select('*, listings(owner_id,title)').single();
    if (b) { await notify(b.listings.owner_id, 'New paid booking', `${b.listings.title}: respond by ${new Date(b.respond_by).toLocaleString()}`, b.urgent); await notify(b.user_id, 'Payment received', 'Waiting for the host to accept.'); }
  } else if (pay.purpose === 'package' && pay.package_id) {
    await admin.from('trip_packages').update({ payment_status: 'paid' }).eq('id', pay.package_id);
    const { data: bs } = await admin.from('bookings').update({ payment_status: 'paid' }).eq('package_id', pay.package_id).select('*, listings(owner_id,title)');
    for (const b of bs || []) await notify(b.listings.owner_id, 'New package booking', `${b.listings.title}: respond by ${new Date(b.respond_by).toLocaleString()}`);
  } else if (pay.purpose === 'transfer') {
    await admin.from('airport_transfers').update({ payment_status: 'paid' }).eq('id', ev.data.metadata?.transferId);
  } else if (pay.purpose === 'subscription') {
    const { data: p } = await admin.from('profiles').select('subscription_until').eq('id', pay.user_id).single();
    const base = p?.subscription_until && new Date(p.subscription_until) > new Date() ? new Date(p.subscription_until) : new Date();
    base.setDate(base.getDate() + 30);
    await admin.from('profiles').update({ subscription_until: base.toISOString() }).eq('id', pay.user_id);
  } else if (pay.purpose === 'prioritization') {
    const lid = ev.data.metadata?.listingId;
    const until = new Date(); until.setDate(until.getDate() + 14);
    if (lid) await admin.from('listings').update({ is_prioritized: true, priority_until: until.toISOString() }).eq('id', lid);
  }
  return new Response('ok');
});
