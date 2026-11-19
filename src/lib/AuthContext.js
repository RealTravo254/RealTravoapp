import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from './supabase';
import { i18n } from '../i18n';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lang, setLangState] = useState(i18n.locale);
  const [pendingLegal, setPendingLegal] = useState([]); const [legalLoading, setLegalLoading] = useState(false);
  const [kesPerUsd, setKesPerUsd] = useState(null);
  const agreed = useRef(false);      // user ticked the Terms & Privacy box on the sign-in screen
  const loadedFor = useRef(null);    // which user we already loaded (later refreshes must NOT show the full-screen loader)

  useEffect(() => {
    let active = true;
    supabase.from('app_settings').select('kes_per_usd').eq('id', 1).maybeSingle().then(({ data, error }) => {
      if (error) {
        console.warn('Could not load the KES exchange rate:', error.message);
        return;
      }
      const rate = Number(data?.kes_per_usd);
      if (active && Number.isFinite(rate) && rate > 0) setKesPerUsd(rate);
    });
    return () => { active = false; };
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
  const currency = profile?.preferred_currency || (String(profile?.country || '').toLowerCase() === 'kenya' ? 'KES' : 'USD');
  const formatMoney = useCallback((amount) => {
    const value = Number(amount || 0);
    if (currency === 'KES') return kesPerUsd ? `KES ${Math.round(value * kesPerUsd).toLocaleString()}` : 'KES rate unavailable';
    return `$${value.toFixed(2)}`;
  }, [currency, kesPerUsd]);
  const setCurrency = async (value) => {
    if (!session || !['USD', 'KES'].includes(value)) throw new Error('Choose a supported currency.');
    const { error } = await supabase.from('profiles').update({ preferred_currency: value }).eq('id', session.user.id);
    if (error) throw error;
    setProfile((current) => current ? { ...current, preferred_currency: value } : current);
  };

  const ensureLogin = (navigation, reason) => {
    if (!session) { navigation.navigate('Auth', { reason }); return false; }
    if (!profileComplete) { navigation.navigate('CompleteProfile'); return false; }
    return true;
  };
  const markAgreed = () => { agreed.current = true; };
  const acceptLegal = async () => { await supabase.rpc('accept_legal'); await loadLegal(session?.user?.id, false); };

  return <Ctx.Provider value={{ session, profile, loading, lang, setLang, refresh: () => loadProfile(session?.user?.id), profileComplete, subscribed, ensureLogin,
    currency, kesPerUsd, formatMoney, setCurrency,
    pendingLegal, legalLoading, markAgreed, acceptLegal,
    isProvider: profile?.role === 'provider' || profile?.role === 'admin', isAdmin: profile?.role === 'admin' }}>{children}</Ctx.Provider>;
}
