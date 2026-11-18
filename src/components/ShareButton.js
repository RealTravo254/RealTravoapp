import React from 'react';
import { TouchableOpacity, Share } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from '../lib/theme';

// Shares the place itself (opens in the RealTravo app), with the website as a fallback. No map link.
export const shareListing = async (l) => {
  const where = l.location_name || l.region || l.country || '';
  try {
    await Share.share({ title: l.title, message: `${l.title}${where ? ' — ' + where : ''}\nOpen it in the RealTravo app: travelapp://listing/${l.id}\nNo app yet? Visit https://realtravo.com` });
  } catch (e) {}
};

export default function ShareButton({ item, style }) {
  return (
    <TouchableOpacity onPress={() => shareListing(item)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={[{ position: 'absolute', top: 10, right: 54, backgroundColor: 'rgba(255,255,255,0.94)', borderRadius: 18, width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }, style]}>
      <Ionicons name="share-social-outline" size={20} color={C.text} />
    </TouchableOpacity>
  );
}
