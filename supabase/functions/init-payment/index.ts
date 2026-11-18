// Initializes a Paystack transaction. Amounts are ALWAYS computed server-side from the database.
// Secrets needed:  supabase secrets set PAYSTACK_SECRET_KEY=sk_live_xxx PAYSTACK_CURRENCY=KES
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const token = (req.headers.get('Authorization') || '').replace('Bearer ', '');
    const { data: u } = await admin.auth.getUser(token);
    const user = u.user; if (!user) return json({ error: 'Not signed in' }, 401);
    const { purpose, bookingId, packageId, transferId, listingId, useBalance } = await req.json();
    const { data: settings } = await admin.from('app_settings').select('*').eq('id', 1).single();

    let amount = 0; let subaccount: string | undefined; let commission = 0;
    if (purpose === 'booking') {
      const { data: b } = await admin.from('bookings').select('*').eq('id', bookingId).eq('user_id', user.id).single();
      if (!b || b.payment_status === 'paid') return json({ error: 'Booking not payable' }, 400);
      amount = Number(b.total); commission = Number(b.commission);
      if (useBalance) {
        const { data: p } = await admin.from('profiles').select('balance').eq('id', user.id).single();
        if (Number(p!.balance) >= amount) {
          await admin.from('profiles').update({ balance: Number(p!.balance) - amount }).eq('id', user.id);
          await admin.from('bookings').update({ payment_status: 'paid' }).eq('id', bookingId);
          await admin.from('payments').insert({ user_id: user.id, booking_id: bookingId, purpose, provider: 'balance', reference: `bal_${crypto.randomUUID()}`, amount, status: 'success' });
          return json({ paid_with_balance: true });
        }
      }
      const { data: l } = await admin.from('listings').select('owner_id').eq('id', b.listing_id).single();
      const { data: ps } = await admin.from('provider_payment_settings').select('paystack_subaccount').eq('provider_user_id', l!.owner_id).maybeSingle();
      subaccount = ps?.paystack_subaccount || undefined; // money goes direct to the host's bank, platform keeps commission
    } else if (purpose === 'package') {
      const { data: pkg } = await admin.from('trip_packages').select('*').eq('id', packageId).eq('user_id', user.id).single();
      const { data: bs } = await admin.from('bookings').select('total').eq('package_id', packageId);
      amount = (bs || []).reduce((a, x) => a + Number(x.total), 0) + Number(pkg!.transfer_price || 0);
      await admin.from('trip_packages').update({ total: amount }).eq('id', packageId);
    } else if (purpose === 'transfer') {
      const { data: t } = await admin.from('airport_transfers').select('*').eq('id', transferId).eq('user_id', user.id).single();
      amount = Number(t!.price);
    } else if (purpose === 'subscription') amount = Number(settings.subscription_price);
    else if (purpose === 'prioritization') amount = 15;
    else return json({ error: 'Unknown purpose' }, 400);
    if (!(amount > 0)) return json({ error: 'Nothing to pay' }, 400);

    const reference = `ta_${crypto.randomUUID().replace(/-/g, '')}`;
    const body: Record<string, unknown> = { email: user.email, amount: Math.round(amount * 100), currency: Deno.env.get('PAYSTACK_CURRENCY') || settings.currency, reference, callback_url: 'travelapp://paid',
      metadata: { purpose, bookingId, packageId, transferId, listingId, user_id: user.id } };
    if (subaccount) { body.subaccount = subaccount; body.transaction_charge = Math.round(commission * 100); }
    const r = await fetch('https://api.paystack.co/transaction/initialize', { method: 'POST', headers: { Authorization: `Bearer ${Deno.env.get('PAYSTACK_SECRET_KEY')}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(x => x.json());
    if (!r.status) return json({ error: r.message || 'Paystack error' }, 400);
    await admin.from('payments').insert({ user_id: user.id, booking_id: bookingId || null, package_id: packageId || null, purpose, reference, amount, currency: body.currency });
    return json({ authorization_url: r.data.authorization_url, reference });
  } catch (e) { return json({ error: String(e) }, 500); }
});
