import { createClient } from 'npm:@supabase/supabase-js@2';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type StripeEvent = {
  type: string;
  data?: {
    object?: {
      id?: string;
      metadata?: Record<string, string | undefined>;
    };
  };
};

async function verifySignature(payload: string, header: string, secret: string) {
  const parts = header.split(',').map((part) => part.split('='));
  const timestamp = parts.find(([key]) => key === 't')?.[1];
  const signatures = parts.filter(([key]) => key === 'v1').map(([, value]) => value);
  const timestampSeconds = Number(timestamp);
  if (!timestamp || !Number.isFinite(timestampSeconds) || signatures.length === 0
    || Math.abs(Date.now() / 1000 - timestampSeconds) > 300) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signed = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${timestamp}.${payload}`),
  );
  const expected = Array.from(new Uint8Array(signed), (byte) => byte.toString(16).padStart(2, '0')).join('');
  return signatures.some((signature) => {
    if (signature.length !== expected.length) return false;
    let mismatch = 0;
    for (let index = 0; index < expected.length; index += 1) {
      mismatch |= signature.charCodeAt(index) ^ expected.charCodeAt(index);
    }
    return mismatch === 0;
  });
}

Deno.serve(async (request) => {
  const payload = await request.text();
  const signature = request.headers.get('stripe-signature') || '';
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!webhookSecret) return json({ error: 'Stripe webhook is not configured' }, 500);
  if (!await verifySignature(payload, signature, webhookSecret)) return json({ error: 'Invalid signature' }, 401);

  let event: StripeEvent;
  try {
    event = JSON.parse(payload);
  } catch {
    return json({ error: 'Invalid event payload' }, 400);
  }
  if (!['payment_intent.succeeded', 'payment_intent.payment_failed', 'payment_intent.canceled'].includes(event.type)) {
    return json({ received: true });
  }

  const intent = event.data?.object;
  if (!intent?.id) return json({ error: 'Payment intent is missing' }, 400);
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: payment, error: paymentError } = await admin.from('payments')
    .select('*')
    .eq('provider', 'stripe')
    .eq('reference', intent.id)
    .maybeSingle();
  if (paymentError) return json({ error: paymentError.message }, 500);
  if (!payment) return json({ error: 'Payment record not found yet' }, 500);

  if (event.type !== 'payment_intent.succeeded') {
    if (payment.status === 'pending') {
      const status = event.type === 'payment_intent.canceled' ? 'cancelled' : 'failed';
      const { error } = await admin.from('payments').update({ status }).eq('id', payment.id).eq('status', 'pending');
      if (error) return json({ error: error.message }, 500);
    }
    return json({ received: true });
  }
  if (payment.status === 'success' || payment.status === 'processing') return json({ received: true });

  const { data: claimed, error: claimError } = await admin.from('payments')
    .update({ status: 'processing' })
    .eq('id', payment.id)
    .in('status', ['pending', 'failed'])
    .select('*')
    .maybeSingle();
  if (claimError) return json({ error: claimError.message }, 500);
  if (!claimed) return json({ received: true });

  const notify = async (userId: string, title: string, body: string, urgent = false) => {
    const { error } = await admin.from('notifications').insert({
      user_id: userId,
      title,
      body,
      urgent,
      channel: urgent ? ['in_app', 'email', 'sms', 'whatsapp'] : ['in_app', 'email'],
    });
    if (error) console.error('Stripe payment notification failed:', error.message);
  };

  try {
    if (claimed.purpose === 'booking' && claimed.booking_id) {
      const { data: booking, error } = await admin.from('bookings')
        .update({ payment_status: 'paid' })
        .eq('id', claimed.booking_id)
        .select('*, listings(owner_id,title)')
        .single();
      if (error) throw error;
      await notify(booking.listings.owner_id, 'New paid booking', `${booking.listings.title}: respond by ${new Date(booking.respond_by).toLocaleString()}`, booking.urgent);
      await notify(booking.user_id, 'Payment received', 'Waiting for the host to accept.');
    } else if (claimed.purpose === 'package' && claimed.package_id) {
      const { error: packageError } = await admin.from('trip_packages')
        .update({ payment_status: 'paid' }).eq('id', claimed.package_id);
      if (packageError) throw packageError;
      const { data: bookings, error } = await admin.from('bookings')
        .update({ payment_status: 'paid' })
        .eq('package_id', claimed.package_id)
        .select('*, listings(owner_id,title)');
      if (error) throw error;
      for (const booking of bookings || []) {
        await notify(booking.listings.owner_id, 'New package booking', `${booking.listings.title}: respond by ${new Date(booking.respond_by).toLocaleString()}`);
      }
    } else if (claimed.purpose === 'transfer') {
      const transferId = intent.metadata?.transfer_id;
      if (!transferId) throw new Error('Stripe payment is missing its transfer reference');
      const { error } = await admin.from('airport_transfers')
        .update({ payment_status: 'paid' }).eq('id', transferId).eq('user_id', claimed.user_id);
      if (error) throw error;
    } else if (claimed.purpose === 'subscription') {
      const { data: profile, error } = await admin.from('profiles')
        .select('subscription_until').eq('id', claimed.user_id).single();
      if (error) throw error;
      const base = profile.subscription_until && new Date(profile.subscription_until) > new Date()
        ? new Date(profile.subscription_until)
        : new Date();
      base.setDate(base.getDate() + 30);
      const { error: updateError } = await admin.from('profiles')
        .update({ subscription_until: base.toISOString() }).eq('id', claimed.user_id);
      if (updateError) throw updateError;
    } else if (claimed.purpose === 'prioritization') {
      const listingId = intent.metadata?.listing_id;
      if (!listingId) throw new Error('Stripe payment is missing its listing reference');
      const until = new Date();
      until.setDate(until.getDate() + 14);
      const { error } = await admin.from('listings')
        .update({ is_prioritized: true, priority_until: until.toISOString() }).eq('id', listingId);
      if (error) throw error;
    } else {
      throw new Error(`Unsupported payment purpose: ${claimed.purpose}`);
    }

    const { error } = await admin.from('payments').update({ status: 'success' }).eq('id', claimed.id);
    if (error) throw error;
  } catch (error) {
    await admin.from('payments').update({ status: 'pending' }).eq('id', claimed.id).eq('status', 'processing');
    console.error('Stripe payment fulfillment failed:', error);
    return json({ error: 'Payment was received but fulfillment failed' }, 500);
  }

  return json({ received: true });
});
