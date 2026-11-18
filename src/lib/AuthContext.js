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
  const agreed = useRef(false);      // user ticked the Terms & Privacy box on the sign-in screen
  const loadedFor = useRef(null);    // which user we already loaded (later refreshes must NOT show the full-screen loader)

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

  const ensureLogin = (navigation, reason) => {
    if (!session) { navigation.navigate('Auth', { reason }); return false; }
    if (!profileComplete) { navigation.navigate('CompleteProfile'); return false; }
    return true;
  };
  const markAgreed = () => { agreed.current = true; };
  const acceptLegal = async () => { await supabase.rpc('accept_legal'); await loadLegal(session?.user?.id, false); };

  return <Ctx.Provider value={{ session, profile, loading, lang, setLang, refresh: () => loadProfile(session?.user?.id), profileComplete, subscribed, ensureLogin,
    pendingLegal, legalLoading, markAgreed, acceptLegal,
    isProvider: profile?.role === 'provider' || profile?.role === 'admin', isAdmin: profile?.role === 'admin' }}>{children}</Ctx.Provider>;
}
