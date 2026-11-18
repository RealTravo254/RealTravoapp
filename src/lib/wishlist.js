import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { useAuth } from './AuthContext';

const KEY = 'wishlist:v1';
const Ctx = createContext({ ids: [], has: () => false, toggle: () => {} });
export const useWishlist = () => useContext(Ctx);

export function WishlistProvider({ children }) {
  const { session } = useAuth();
  const [ids, setIds] = useState([]);
  const persist = (next) => { setIds(next); AsyncStorage.setItem(KEY, JSON.stringify(next)); };
  useEffect(() => { AsyncStorage.getItem(KEY).then((v) => v && setIds(JSON.parse(v))); }, []);

  useEffect(() => { // on sign-in: merge the phone list with the saved list in the database
    if (!session) return;
    (async () => {
      try {
        const local = JSON.parse((await AsyncStorage.getItem(KEY)) || '[]');
        const { data } = await supabase.from('wishlist').select('listing_id').eq('user_id', session.user.id);
        const remote = (data || []).map((x) => x.listing_id);
        const merged = [...new Set([...remote, ...local])];
        const push = merged.filter((x) => !remote.includes(x));
        if (push.length) await supabase.from('wishlist').upsert(push.map((id) => ({ user_id: session.user.id, listing_id: id })), { onConflict: 'user_id,listing_id', ignoreDuplicates: true });
        persist(merged);
      } catch (e) {}
    })();
  }, [session?.user?.id]);

  const has = (id) => ids.includes(id);
  const toggle = async (id) => {
    const adding = !ids.includes(id);
    persist(adding ? [id, ...ids] : ids.filter((x) => x !== id));
    if (!session) return;
    if (adding) await supabase.from('wishlist').upsert({ user_id: session.user.id, listing_id: id }, { onConflict: 'user_id,listing_id', ignoreDuplicates: true });
    else await supabase.from('wishlist').delete().eq('user_id', session.user.id).eq('listing_id', id);
  };
  return <Ctx.Provider value={{ ids, has, toggle }}>{children}</Ctx.Provider>;
}
