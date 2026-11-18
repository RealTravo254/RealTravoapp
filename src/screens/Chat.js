import React, { useEffect, useState, useRef } from 'react';
import { View, FlatList, Text } from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { Input, Btn } from '../components/ui';

export default function Chat({ route, navigation }) {
  const { bookingId, title } = route.params; const { session } = useAuth();
  const [msgs, setMsgs] = useState([]); const [text, setText] = useState(''); const ref = useRef();
  useEffect(() => { navigation.setOptions({ title: title || 'Chat' }); }, []);
  useEffect(() => {
    supabase.from('messages').select('*').eq('booking_id', bookingId).order('created_at').then(({ data }) => setMsgs(data || []));
    const ch = supabase.channel(`chat-${bookingId}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `booking_id=eq.${bookingId}` },
      (p) => setMsgs(m => m.some(x => x.id === p.new.id) ? m : [...m, p.new])).subscribe();
    return () => supabase.removeChannel(ch);
  }, [bookingId]);
  const send = async () => { if (!text.trim()) return; const body = text; setText(''); await supabase.from('messages').insert({ booking_id: bookingId, sender_id: session.user.id, body }); };
  return (
    <View style={{ flex: 1 }}>
      <FlatList ref={ref} data={msgs} keyExtractor={(m) => m.id} onContentSizeChange={() => ref.current?.scrollToEnd()}
        renderItem={({ item: m }) => <View style={{ alignSelf: m.sender_id === session.user.id ? 'flex-end' : 'flex-start', backgroundColor: m.sender_id === session.user.id ? '#D3E3DA' : '#fff', margin: 6, padding: 10, borderRadius: 12, maxWidth: '80%' }}><Text>{m.body}</Text></View>} />
      <View style={{ flexDirection: 'row', padding: 8 }}><Input style={{ flex: 1 }} value={text} onChangeText={setText} placeholder="Message" /><Btn title="Send" onPress={send} /></View>
    </View>
  );
}
