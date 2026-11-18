import React, { useEffect, useState } from 'react';
import { ScrollView, Text, View, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import { supabase } from '../lib/supabase';
import { C } from '../lib/theme';

// Terms & privacy are set by the admin (Admin -> Legal): a realtravo.com page address and/or pasted text.
export default function Legal({ navigation, route }) {
  const kind = route.params?.kind || 'terms';
  const [doc, setDoc] = useState(undefined);
  useEffect(() => {
    supabase.from('legal_documents').select('*').eq('kind', kind).maybeSingle().then(({ data }) => { setDoc(data || null); if (data?.title) navigation.setOptions({ title: data.title }); });
  }, [kind]);
  if (doc === undefined) return <ActivityIndicator color={C.primary} style={{ margin: 30 }} />;
  if (!doc || !doc.published) return <Text style={{ margin: 24, color: C.muted }}>This document has not been published yet.</Text>;
  if (doc.content) return (
    <ScrollView contentContainerStyle={{ padding: 18 }}>
      <Text style={{ color: C.text, lineHeight: 22 }}>{doc.content}</Text>
      <Text style={{ color: C.muted, marginTop: 20, fontSize: 12 }}>Version {doc.version} · updated {new Date(doc.updated_at).toLocaleDateString()}</Text>
      {doc.url ? <Text style={{ color: C.primary, marginTop: 8 }}>{doc.url}</Text> : null}
    </ScrollView>);
  return <View style={{ flex: 1 }}><WebView source={{ uri: doc.url }} startInLoadingState renderLoading={() => <ActivityIndicator color={C.primary} style={{ margin: 30 }} />} /></View>;
}
