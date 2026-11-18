import React from 'react';
import { Image, Dimensions } from 'react-native';

// RealTravo logo images (assets/logo.png = full wordmark, assets/logo-mark.png = pin only)
const FULL = require('../../assets/logo.png');
const MARK = require('../../assets/logo-mark.png');
export const BRAND = 'RealTravo';
export const TAGLINE = 'Search · Book · Travel · Experience';

// size = height in pixels. withText = full wordmark, otherwise just the pin. Never wider than 80% of the screen.
export default function Logo({ size = 34, withText = false, style }) {
  const src = withText ? FULL : MARK;
  const a = Image.resolveAssetSource(src); const ratio = a.width / a.height;
  const maxW = Dimensions.get('window').width * 0.8;
  const w = Math.min(size * ratio, maxW);
  return <Image source={src} style={[{ width: w, height: w / ratio }, style]} resizeMode="contain" />;
}
