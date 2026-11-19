// In-app Google account chooser (installed build only, not Expo Go).
// Needs: @react-native-google-signin/google-signin installed + a rebuilt app,
// and CONFIG.googleWebClientId set (EXPO_PUBLIC_GOOGLE_CLIENT_ID).
// Returns true  -> signed in (the session arrives and the app moves on)
// Returns false -> native Google is not available here, AuthForm falls back to the browser
// Throws        -> cancelled or failed (AuthForm stops the spinner and ignores cancels)
import { supabase } from './supabase';
import { CONFIG } from './config';

export async function nativeGoogle() {
  let GS = null;
  try { GS = require('@react-native-google-signin/google-signin').GoogleSignin; } catch (e) { return false; }
  if (!GS || !CONFIG.googleWebClientId) return false;

  GS.configure({ webClientId: CONFIG.googleWebClientId, offlineAccess: false, scopes: ['email', 'profile'] });
  await GS.hasPlayServices({ showPlayServicesUpdateDialog: true });

  // forget the last account so the chooser lists every account on the phone
  try { await GS.signOut(); } catch (e) {}

  const r = await GS.signIn();

  // cancelled: throw so AuthForm stops the loading screen (returning true would leave it spinning)
  if (r?.type === 'cancelled') throw Object.assign(new Error('cancelled'), { code: 'SIGN_IN_CANCELLED' });

  // newer versions return { type, data: { idToken } }, older ones return the user directly
  const idToken = r?.data?.idToken || r?.idToken;
  if (!idToken) throw new Error('Google did not return a token');

  const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken });
  if (error) throw error;
  return true;
}