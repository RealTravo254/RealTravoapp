import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { supabase } from './supabase';

// Reads any picked file. Tries the base64 way first (works for photos and copied files), then a plain fetch (works for content:// files).
async function toBuffer(uri) {
  try { const b64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' }); return decode(b64); }
  catch (e) { const res = await fetch(uri); return await res.arrayBuffer(); }
}
async function put(bucket, path, uri, contentType) {
  const { error } = await supabase.storage.from(bucket).upload(path, await toBuffer(uri), { contentType, upsert: true });
  if (error) throw error; return path;
}

export async function pickAndUploadPhoto(uid, bucket = 'listing-photos') {
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
  if (r.canceled) return null;
  const path = `${uid}/${Date.now()}.jpg`;
  await put(bucket, path, r.assets[0].uri, 'image/jpeg');
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}
export async function pickAndUploadDoc(uid, bucket = 'provider-docs') {
  const r = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'], copyToCacheDirectory: true });
  if (r.canceled) return null;
  const a = r.assets[0]; const safe = (a.name || 'file').replace(/[^\w.\-]/g, '_');
  return put(bucket, `${uid}/${Date.now()}-${safe}`, a.uri, a.mimeType || 'application/pdf'); // private bucket: store the path
}
export async function takeSelfie(uid) {
  const perm = await ImagePicker.requestCameraPermissionsAsync(); if (!perm.granted) throw new Error('Camera permission is needed for the selfie');
  const r = await ImagePicker.launchCameraAsync({ cameraType: ImagePicker.CameraType.front, quality: 0.6 });
  if (r.canceled) return null;
  return put('host-verification', `${uid}/selfie-${Date.now()}.jpg`, r.assets[0].uri, 'image/jpeg');
}
export async function pickAndUploadImagePrivate(uid, bucket = 'provider-docs', prefix = 'tra') {
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
  if (r.canceled) return null;
  return put(bucket, `${uid}/${prefix}-${Date.now()}.jpg`, r.assets[0].uri, 'image/jpeg');
}

// Any legal document (TRA certificate, licence, registration, ID): photo from gallery, camera, or a PDF/file. Uses the same upload path as the profile photo.
export function chooseAndUploadDocument(uid, bucket = 'provider-docs', prefix = 'doc') {
  return new Promise((resolve, reject) => {
    const run = (fn) => fn().then(resolve).catch(reject);
    const fromGallery = async () => { const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 }); return r.canceled ? null : put(bucket, `${uid}/${prefix}-${Date.now()}.jpg`, r.assets[0].uri, 'image/jpeg'); };
    const fromCamera = async () => {
      const p = await ImagePicker.requestCameraPermissionsAsync(); if (!p.granted) throw new Error('Camera permission is needed');
      const r = await ImagePicker.launchCameraAsync({ quality: 0.8 }); return r.canceled ? null : put(bucket, `${uid}/${prefix}-${Date.now()}.jpg`, r.assets[0].uri, 'image/jpeg');
    };
    const fromFile = () => pickAndUploadDoc(uid, bucket);
    Alert.alert('Upload legal document', 'Choose how to add it', [
      { text: 'Gallery photo', onPress: () => run(fromGallery) }, { text: 'Take a photo', onPress: () => run(fromCamera) }, { text: 'PDF / file', onPress: () => run(fromFile) },
    ], { cancelable: true, onDismiss: () => resolve(null) });
  });
}
