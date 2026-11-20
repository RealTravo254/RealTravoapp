import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { i18n } from '../i18n';

const KES_RATE_CACHE = 'settings:kes_per_usd';
const DEFAULT_KES_PER_USD = 130;
const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lang, setLangState] = useState(i18n.locale);
  const [pendingLegal, setPendingLegal] = useState([]); const [legalLoading, setLegalLoading] = useState(false);
  const [kesPerUsd, setKesPerUsd] = useState(DEFAULT_KES_PER_USD);
  const agreed = useRef(false);      // user ticked the Terms & Privacy box on the sign-in screen
  const loadedFor = useRef(null);    // which user we already loaded (later refreshes must NOT show the full-screen loader)

  useEffect(() => {
    let active = true;
    const refreshRate = async () => {
      try {
        const { data, error } = await supabase.from('app_settings').select('kes_per_usd').eq('id', 1).maybeSingle();
        if (error) throw error;
        const rate = Number(data?.kes_per_usd);
        if (!Number.isFinite(rate) || rate <= 0) throw new Error('The admin exchange rate is missing or invalid.');
        if (active) {
          setKesPerUsd(rate);
          await AsyncStorage.setItem(KES_RATE_CACHE, String(rate));
        }
      } catch (e) {
        console.warn('Could not refresh the KES exchange rate:', e.message);
      }
    };
    AsyncStorage.getItem(KES_RATE_CACHE).then((value) => {
      const rate = Number(value);
      if (active && Number.isFinite(rate) && rate > 0) setKesPerUsd(rate);
    }).catch((e) => console.warn('Could not read the saved KES exchange rate:', e.message));
    refreshRate();
    const appState = AppState.addEventListener('change', (state) => { if (state === 'active') refreshRate(); });
    return () => { active = false; appState.remove(); };
  }, []);

  const loadLegal = useCallback(async (uid, spinner) => {
    if (!uid) { setPendingLegal([]); return; }
    if (spinner) setLegalLoading(true);
    try {
      if (agreed.current) { await supabase.rpc('accept_legal'); agreed.current = false; }
      const { data } = await supabase.rpc('pending_legal'); setPendingLegal(data || []);
    } catch (e) {} finally { if (spinner) setLegalLoading(false); }
  }, []);

  const loadProfile = useCallback(async (uid) => {
    if (!uid) { loadedFor.current = null; setProfile(null); setPendingLegal([]); return; }
    const first = loadedFor.current !== uid;
    const { data } = await supabase.from('profiles').select('*').eq('id', uid).single();
    setProfile(data);
    if (data?.language) { i18n.locale = data.language; setLangState(data.language); }
    await loadLegal(uid, first);
    loadedFor.current = uid;
  }, [loadLegal]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); loadProfile(data.session?.user?.id).finally(() => setLoading(false)); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { setSession(s); loadProfile(s?.user?.id); });
    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  const setLang = async (code) => {
    i18n.locale = code; setLangState(code);
    if (session) await supabase.from('profiles').update({ language: code }).eq('id', session.user.id);
  };
  const profileComplete = !!(profile?.first_name && profile?.last_name && profile?.gender && profile?.country && profile?.date_of_birth);
  const subscribed = !!(profile?.subscription_until && new Date(profile.subscription_until) > new Date());
  const currency = String(profile?.country || '').trim().toLowerCase() === 'kenya' ? 'KES' : 'USD';
  const formatMoney = useCallback((amount) => {
    const value = Number(amount || 0);
    if (currency === 'KES') return `KES ${Math.round(value * kesPerUsd).toLocaleString()}`;
    return `$${value.toFixed(2)}`;
  }, [currency, kesPerUsd]);

  const ensureLogin = (navigation, reason) => {
    if (!session) { navigation.navigate('Auth', { reason }); return false; }
    if (!profileComplete) { navigation.navigate('CompleteProfile'); return false; }
    return true;
  };
  const markAgreed = () => { agreed.current = true; };
  const acceptLegal = async () => { await supabase.rpc('accept_legal'); await loadLegal(session?.user?.id, false); };

  return <Ctx.Provider value={{ session, profile, loading, lang, setLang, refresh: () => loadProfile(session?.user?.id), profileComplete, subscribed, ensureLogin,
    currency, kesPerUsd, formatMoney,
    pendingLegal, legalLoading, markAgreed, acceptLegal,
    isProvider: profile?.role === 'provider' || profile?.role === 'admin', isAdmin: profile?.role === 'admin' }}>{children}</Ctx.Provider>;
}
