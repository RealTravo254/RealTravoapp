import Constants from 'expo-constants';

// Values come from .env when present, otherwise from app.json "extra" (so an installed build always has them)
const extra = Constants.expoConfig?.extra || {};
const pick = (a, b) => (a && !String(a).startsWith('YOUR_') ? a : b);
export const CONFIG = {
  supabaseUrl: pick(process.env.EXPO_PUBLIC_SUPABASE_URL, extra.supabaseUrl),
  supabaseAnonKey: pick(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY, extra.supabaseAnonKey),
  googleKey: pick(process.env.EXPO_PUBLIC_GOOGLE_PLACES_KEY, extra.googleKey),
  googleWebClientId: pick(process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID, extra.googleWebClientId), // Web client ID from Google Cloud (also set in Supabase > Auth > Google)
};
