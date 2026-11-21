import { createClient } from 'npm:@supabase/supabase-js@2';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char] || char));

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const cronSecret = Deno.env.get('EMAIL_CRON_SECRET');
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return json({ error: 'Not authorized' }, 401);
  }

  const apiKey = Deno.env.get('RESEND_API_KEY');
  const from = Deno.env.get('EMAIL_FROM');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!apiKey || !from || !supabaseUrl || !serviceKey) {
    return json({ error: 'Email service is not configured' }, 500);
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: notifications, error } = await admin.rpc('claim_email_notifications', { batch_size: 50 });
  if (error) {
    console.error('Could not claim email notifications:', error.message);
    return json({ error: 'Could not load queued emails' }, 500);
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const notification of notifications || []) {
    try {
      if (notification.data?.type === 'booking_pending_payment' && notification.data?.booking_id) {
        const { data: booking, error: bookingError } = await admin.from('bookings')
          .select('status,payment_status').eq('id', notification.data.booking_id).maybeSingle();
        if (bookingError) throw bookingError;
        if (!booking || booking.status !== 'pending' || booking.payment_status !== 'unpaid') {
          const { error: updateError } = await admin.from('notifications').update({
            email_sent_at: new Date().toISOString(),
            email_error: null,
          }).eq('id', notification.id);
          if (updateError) throw updateError;
          skipped += 1;
          continue;
        }
      }

      let recipient = notification.data?.email;
      if (!recipient) {
        const { data, error: userError } = await admin.auth.admin.getUserById(notification.user_id);
        if (userError) throw userError;
        recipient = data.user?.email;
      }
      if (!recipient) throw new Error('The booking has no email address.');

      const body = String(notification.body || '');
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': notification.id,
        },
        body: JSON.stringify({
          from,
          to: [recipient],
          subject: notification.title,
          text: `${body}\n\nOpen RealTravo → My bookings → Pending, then choose Pay now to complete your booking.`,
          html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#14231c"><h2>${escapeHtml(notification.title)}</h2><p>${escapeHtml(body)}</p><p>Open RealTravo → My bookings → Pending, then choose <b>Pay now</b> to complete your booking.</p></div>`,
        }),
      });
      if (!response.ok) throw new Error(`Email provider returned ${response.status}: ${(await response.text()).slice(0, 500)}`);

      const { error: updateError } = await admin.from('notifications').update({
        email_sent_at: new Date().toISOString(),
        email_error: null,
      }).eq('id', notification.id);
      if (updateError) throw updateError;
      sent += 1;
    } catch (e) {
      failed += 1;
      const message = e instanceof Error ? e.message : String(e);
      console.error(`Could not send notification ${notification.id}:`, message);
      const { error: updateError } = await admin.from('notifications').update({ email_error: message }).eq('id', notification.id);
      if (updateError) console.error(`Could not record email failure for ${notification.id}:`, updateError.message);
    }
  }

  return json({ claimed: notifications?.length || 0, sent, skipped, failed });
});
