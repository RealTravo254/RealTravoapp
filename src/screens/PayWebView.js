import React, { useRef } from 'react';
import { WebView } from 'react-native-webview';
import { Alert } from 'react-native';

export default function PayWebView({ route, navigation }) {
  const done = useRef(false);
  return <WebView source={{ uri: route.params.url }} onNavigationStateChange={(s) => {
    if (!done.current && /callback|trxref=|reference=/.test(s.url) && /travelapp|paystack\.co\/close|callback/.test(s.url)) {
      done.current = true;
      navigation.popToTop(); navigation.navigate('Tabs', { screen: 'Trips', params: { tab: 'pending', ts: Date.now() } });
      Alert.alert('Payment received', 'We are confirming your payment. You can now chat with your host.', [{ text: 'Later' }, { text: 'Message host', onPress: () => navigation.navigate('Inbox') }]);
    }
  }} />;
}
