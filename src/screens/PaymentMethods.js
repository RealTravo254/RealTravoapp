import React, { useEffect, useState } from 'react';
import { Alert, Platform, ScrollView, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { StripeProvider, usePlatformPay } from '@stripe/stripe-react-native';
import { startPayment } from '../lib/payments';
import { Btn, Card, H, Muted } from '../components/ui';
import { C } from '../lib/theme';

const stripeKey = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY
  || Constants.expoConfig?.extra?.stripePublishableKey
  || '';
const stripeTestEnv = __DEV__ || process.env.EXPO_PUBLIC_STRIPE_TEST_MODE === 'true';

function PaymentMethodsContent({ route, navigation, googlePayAvailable, onGooglePay }) {
  const params = route.params || {};
  const [selected, setSelected] = useState(params.useBalance && params.purpose === 'booking' ? 'balance' : 'card');
  const [busy, setBusy] = useState(false);
  const allowBalance = params.useBalance && params.purpose === 'booking';

  const finish = (message) => {
    navigation.popToTop();
    navigation.navigate('Tabs', { screen: 'Trips', params: { tab: 'pending', ts: Date.now() } });
    Alert.alert('Payment received', message);
  };

  const pay = async () => {
    setBusy(true);
    try {
      if (selected === 'google_pay') {
        const result = await onGooglePay();
        if (result?.cancelled) return;
        finish('We are confirming your payment. Your booking will update shortly.');
        return;
      }

      const method = selected === 'balance' ? 'balance' : selected;
      const result = await startPayment({
        ...params,
        paymentMethod: method,
        useBalance: method === 'balance',
      });
      if (result.paid_with_balance) {
        finish('Paid from your account balance.');
      } else if (result.authorization_url) {
        navigation.replace('Pay', { url: result.authorization_url });
      } else {
        throw new Error('The payment provider did not return a checkout link.');
      }
    } catch (error) {
      Alert.alert('Could not start payment', error.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const methodCard = (key, title, detail, icon, disabled = false) => (
    <Card
      key={key}
      onPress={() => !disabled && setSelected(key)}
      style={{
        borderColor: selected === key ? C.primary : C.border,
        borderWidth: selected === key ? 2 : 1,
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ color: C.primary, fontSize: 24, marginRight: 12 }}>{icon}</Text>
        <View style={{ flex: 1 }}>
          <Text style={{ color: C.text, fontSize: 16, fontWeight: '800' }}>{title}</Text>
          <Muted>{detail}</Muted>
        </View>
        <Text style={{ color: selected === key ? C.primary : C.muted, fontSize: 18 }}>
          {selected === key ? '●' : '○'}
        </Text>
      </View>
    </Card>
  );

  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
      <H>Choose a payment method</H>
      <Muted style={{ marginHorizontal: 12 }}>Your payment details are handled securely by the payment provider.</Muted>
      {methodCard('card', 'Card', 'Pay securely with a debit or credit card through Paystack.', '💳')}
      {methodCard('mpesa', 'M-Pesa', 'Pay with M-Pesa through Paystack mobile money.', '📱')}
      {allowBalance && methodCard('balance', 'Account balance', 'Use your RealTravo balance for this booking.', '👛')}
      {Platform.OS === 'android' && methodCard(
        'google_pay',
        'Google Pay',
        googlePayAvailable
          ? 'Pay with a card saved in your Google account.'
          : stripeKey
            ? 'Google Pay is not available on this device.'
            : 'Google Pay setup is required before this method can be used.',
        'G',
        !googlePayAvailable,
      )}
      {selected === 'google_pay' && !googlePayAvailable && (
        <Muted style={{ marginHorizontal: 16, marginTop: 4 }}>
          Configure the Stripe publishable key and build the app with Google Pay enabled.
        </Muted>
      )}
      {selected === 'google_pay' && googlePayAvailable ? (
        <View style={{ marginHorizontal: 12, marginTop: 12 }}>
          <Btn title={busy ? 'Opening Google Pay…' : 'Continue with Google Pay'} disabled={busy} onPress={pay} />
        </View>
      ) : (
        <View style={{ marginHorizontal: 12, marginTop: 12 }}>
          <Btn
            title={busy ? 'Preparing payment…' : selected === 'mpesa' ? 'Continue to M-Pesa' : selected === 'balance' ? 'Pay with balance' : 'Continue to card payment'}
            disabled={busy}
            onPress={pay}
          />
        </View>
      )}
    </ScrollView>
  );
}

function ConfiguredPaymentMethods({ route, navigation }) {
  const { isPlatformPaySupported, confirmPlatformPayPayment } = usePlatformPay();
  const [googlePayAvailable, setGooglePayAvailable] = useState(false);

  useEffect(() => {
    let active = true;
    isPlatformPaySupported({ googlePay: { testEnv: stripeTestEnv } })
      .then((available) => { if (active) setGooglePayAvailable(available); })
      .catch(() => { if (active) setGooglePayAvailable(false); });
    return () => { active = false; };
  }, [isPlatformPaySupported]);

  const onGooglePay = async () => {
    const intent = await startPayment({ ...route.params, paymentMethod: 'google_pay', useBalance: false });
    if (!intent.client_secret) throw new Error('Stripe did not return a payment intent.');
    const { error } = await confirmPlatformPayPayment(intent.client_secret, {
      googlePay: {
        testEnv: stripeTestEnv,
        merchantName: 'RealTravo',
        merchantCountryCode: intent.merchant_country_code,
        currencyCode: intent.currency,
      },
    });
    if (error) {
      if (String(error.code).toLowerCase().includes('cancel')) return { cancelled: true };
      throw new Error(error.message || 'Google Pay could not complete the payment.');
    }
    return { success: true };
  };

  return (
    <PaymentMethodsContent
      route={route}
      navigation={navigation}
      googlePayAvailable={googlePayAvailable}
      onGooglePay={onGooglePay}
    />
  );
}

export default function PaymentMethods({ route, navigation }) {
  if (!stripeKey) {
    return <PaymentMethodsContent route={route} navigation={navigation} googlePayAvailable={false} onGooglePay={null} />;
  }
  return (
    <StripeProvider publishableKey={stripeKey} urlScheme="travelapp">
      <ConfiguredPaymentMethods route={route} navigation={navigation} />
    </StripeProvider>
  );
}
