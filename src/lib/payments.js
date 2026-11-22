import { supabase } from './supabase';
export function choosePayment(navigation, params) {
  navigation.navigate('PaymentMethods', params);
}

export async function startPayment({ purpose, amount, bookingId, packageId, transferId, listingId, paymentMethod = 'card', useBalance = false }) {
  const { data, error } = await supabase.functions.invoke('init-payment', {
    body: { purpose, amount, bookingId, packageId, transferId, listingId, paymentMethod, useBalance },
  });
  if (error) throw error; return data;
}
