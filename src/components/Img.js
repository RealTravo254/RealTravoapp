import React from 'react';
import { Image } from 'react-native';

// Images come from the app's image storage; when a listing has none, a built-in picture for its category is shown.
const FALL = {
  hotel: require('../../assets/img/hotel.jpg'), campsite: require('../../assets/img/campsite.jpg'), attraction: require('../../assets/img/attraction.jpg'),
  airbnb: require('../../assets/img/airbnb.jpg'), activity: require('../../assets/img/activity.jpg'), event: require('../../assets/img/event.jpg'),
  guide: require('../../assets/img/guide.jpg'), default: require('../../assets/img/default.jpg'),
};
export default function Img({ uri, category, style, resizeMode = 'cover' }) {
  return <Image source={uri ? { uri } : (FALL[category] || FALL.default)} style={style} resizeMode={resizeMode} />;
}
