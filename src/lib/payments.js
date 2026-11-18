import { supabase } from './supabase';
// Calls the init-payment edge function (Paystack). Returns { authorization_url, reference }.
export async function startPayment({ purpose, amount, bookingId, packageId, transferId }) {
  const { data, error } = await supabase.functions.invoke('init-payment', { body: { purpose, amount, bookingId, packageId, transferId } });
  if (error) throw error; return data;
}
