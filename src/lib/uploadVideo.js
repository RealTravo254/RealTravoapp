import * as ImagePicker from 'expo-image-picker';
import { supabase } from './supabase';

const BUCKET = 'listing-photos';
const MAX_DURATION_MS = 30_000;

export async function pickAndUploadListingVideo(userId, onStatus) {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error('Allow photo and video access in your phone settings to add a video.');

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['videos'],
    allowsMultipleSelection: false,
    videoMaxDuration: 30,
    quality: 1,
  });
  if (result.canceled || !result.assets?.length) return null;

  const asset = result.assets[0];
  const pickedDuration = Number(asset.duration);
  const durationMs = Number.isFinite(pickedDuration) && pickedDuration > 0
    ? pickedDuration
    : MAX_DURATION_MS;
  if (!Number.isFinite(durationMs)) throw new Error('Could not read the video duration. Choose another video.');
  if (durationMs > MAX_DURATION_MS) {
    throw new Error('Choose a video that is 30 seconds or shorter.');
  }

  onStatus?.('Compressing video…');
  const compressedUri = asset.uri;

  onStatus?.('Uploading video…');
  const body = await fetch(compressedUri).then((response) => response.arrayBuffer());
  const path = `${userId}/${Date.now()}-listing-video.mp4`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, body, {
    contentType: 'video/mp4',
    cacheControl: '31536000',
    upsert: false,
  });
  if (error) throw new Error(error.message);

  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
