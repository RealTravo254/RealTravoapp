import React, { useEffect, useState } from 'react';
import { View, FlatList } from 'react-native';
import { supabase, PAGE_SIZE } from '../lib/supabase';
import { useWishlist } from '../lib/wishlist';
import ScreenHeader from '../components/ScreenHeader';
import { ListingCard, Pager, Muted, Loader } from '../components/ui';

export default function Wishlist({ navigation }) {
  const { ids } = useWishlist();
  const [rows, setRows] = useState([]); const [page, setPage] = useState(0); const [loading, setLoading] = useState(true);
  useEffect(() => {
    const slice = ids.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
    if (!slice.length) { setRows([]); setLoading(false); return; }
    setLoading(true);
    supabase.from('listing_cards').select('*').in('id', slice).then(({ data }) => { setRows((data || []).sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id))); setLoading(false); });
  }, [ids, page]);
  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title="Favourite" icon="heart-outline" subtitle={`${ids.length} place${ids.length === 1 ? '' : 's'}`} />
      {loading ? <Loader /> : (
        <FlatList data={rows} keyExtractor={(i) => i.id}
          ListEmptyComponent={<Muted style={{ textAlign: 'center', margin: 30 }}>Tap the heart on any place to add it to your favourites.</Muted>}
          renderItem={({ item }) => <ListingCard item={item} onPress={() => navigation.navigate('ListingDetail', { id: item.id })} />}
          ListFooterComponent={<Pager page={page} setPage={setPage} hasMore={ids.length > (page + 1) * PAGE_SIZE} />} />
      )}
    </View>
  );
}
