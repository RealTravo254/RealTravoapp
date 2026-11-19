// lib/uploadMany.js — pick several photos at once and upload them with progress.
// Needs: npx expo install expo-image-picker
import * as ImagePicker from 'expo-image-picker';
import { supabase } from './supabase';

// ⚠️ Set this to the same storage bucket your existing pickAndUploadPhoto() uses.
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
    const ext = (a.uri.split('.').pop() || 'jpg').split('?')[0].toLowerCase();
    const contentType = a.mimeType || (ext === 'png' ? 'image/png' : 'image/jpeg');
    const path = `${userId}/${Date.now()}-${i}.${ext}`;

    const body = await fetch(a.uri).then((r) => r.arrayBuffer());
    const { error } = await supabase.storage.from(BUCKET).upload(path, body, { contentType, upsert: false });
    if (error) throw new Error(error.message);

    urls.push(supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl);
    onProgress?.(i + 1, assets.length);
  }
  return urls;
}