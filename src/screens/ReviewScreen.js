import React, { useState } from 'react';
import { View, Text, Alert } from 'react-native';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import { Btn, Input, H } from '../components/ui';

export default function ReviewScreen({ route, navigation }) {
  const { booking } = route.params; const { session } = useAuth();
  const [rating, setRating] = useState(5); const [comment, setComment] = useState('');
  const submit = async () => {
    const { error } = await supabase.from('reviews').insert({ booking_id: booking.id, listing_id: booking.listing_id, user_id: session.user.id, rating, comment });
    if (error) Alert.alert('Error', error.message.includes('duplicate') ? 'You already reviewed this booking.' : error.message); else navigation.goBack();
  };
  return (<View style={{ padding: 16 }}><H>Rate your stay</H>
    <View style={{ flexDirection: 'row', justifyContent: 'center' }}>{[1, 2, 3, 4, 5].map(n => <Text key={n} onPress={() => setRating(n)} style={{ fontSize: 36 }}>{n <= rating ? '⭐' : '☆'}</Text>)}</View>
    <Input multiline placeholder="Write your review" value={comment} onChangeText={setComment} /><Btn title="Submit review" onPress={submit} /></View>);
}
