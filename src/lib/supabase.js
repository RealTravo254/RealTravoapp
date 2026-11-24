import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { CONFIG } from './config';

export const supabase = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey,
  { auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false } });
export const PAGE_SIZE = 10;
export const CATEGORIES = ['hotel', 'campsite', 'airbnb', 'activity', 'event', 'guide'];
export const COUNTRIES = ['Tanzania', 'Kenya', 'Uganda', 'Rwanda', 'Zanzibar', 'Other'];
