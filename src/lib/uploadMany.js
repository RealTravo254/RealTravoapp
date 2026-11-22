// lib/uploadMany.js — pick several photos at once and upload them with progress.
// Needs: npx expo install expo-image-picker
import * as ImagePicker from 'expo-image-picker';
import { supabase } from './supabase';
import { withMediaCompressor } from './nativeMediaCompressor';

const BUCKET = 'listing-photos';

export async function pickAndUploadPhotos(userId, { limit = 10, onStart, onProgress } = {}) {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error('Allow photo access in your phone settings to add photos.');

  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions?.Images ?? ['images'],
    allowsMultipleSelection: limit > 1,
    selectionLimit: limit,
    quality: 0.7,
  });
  if (res.canceled || !res.assets?.length) return [];

  const assets = res.assets.slice(0, limit);
  onStart?.(assets.length);

  const urls = [];
  for (let i = 0; i < assets.length; i++) {
    const a = assets[i];
    const compressedUri = await withMediaCompressor(({ Image }) => Image.compress(a.uri, {
        compressionMethod: 'manual',
        maxWidth: 1600,
        maxHeight: 1200,
        quality: 0.68,
        output: 'jpg',
      }));
    const path = `${userId}/${Date.now()}-${i}.jpg`;

    const body = await fetch(compressedUri).then((r) => r.arrayBuffer());
    const { error } = await supabase.storage.from(BUCKET).upload(path, body, {
      contentType: 'image/jpeg',
      cacheControl: '31536000',
      upsert: false,
    });
    if (error) throw new Error(error.message);

    urls.push(supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl);
    onProgress?.(i + 1, assets.length);
  }
  return urls;
}