// ENABLE the in-app Google account chooser (installed build only, not Expo Go):
//   1) npx expo install @react-native-google-signin/google-signin     (then rebuild the app)
//   2) replace the contents of src/lib/googleNative.js with this file
//   3) put your Google Web client ID in .env as EXPO_PUBLIC_GOOGLE_CLIENT_ID and in Supabase > Auth > Google (Skip nonce check ON)
import { supabase } from './supabase';
import { CONFIG } from './config';

export async function nativeGoogle() {
  let GS = null;
  try { GS = require('@react-native-google-signin/google-signin').GoogleSignin; } catch (e) { return false; }
  if (!GS || !CONFIG.googleWebClientId) return false;
  GS.configure({ webClientId: CONFIG.googleWebClientId, offlineAccess: false });
  await GS.hasPlayServices({ showPlayServicesUpdateDialog: true });
  try { await GS.signOut(); } catch (e) {}   // forget the last account so the chooser lists every account on the phone
  const r = await GS.signIn();
  if (r?.type === 'cancelled') return true;
  const idToken = r?.data?.idToken || r?.idToken; if (!idToken) throw new Error('Google did not return a token');
  const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken }); if (error) throw error;
  return true;
}
