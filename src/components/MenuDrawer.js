import React, { createContext, useContext, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabase';
import { CATS } from '../lib/categories';
import { tr, LANGS, i18n } from '../i18n';
import { C } from '../lib/theme';
import Logo, { TAGLINE } from './Logo';

const Ctx = createContext({ open: () => {}, close: () => {} });
export const useMenu = () => useContext(Ctx);

// Three-line menu with shortcuts and the language dropdown. `navRef` is the root navigation ref.
export function MenuProvider({ navRef, children }) {
  const [show, setShow] = useState(false); const [langOpen, setLangOpen] = useState(false); const insets = useSafeAreaInsets();
  const { session, profile, isProvider, isAdmin, ensureLogin, setLang } = useAuth();
  const close = () => { setShow(false); setLangOpen(false); };
  const go = (name, params, needLogin) => { close(); if (needLogin && !ensureLogin(navRef, needLogin)) return; navRef.navigate(name, params); };
  const tab = (screen, params, needLogin) => go('Tabs', { screen, params }, needLogin);
  const curLang = (LANGS.find(([c]) => c === i18n.locale) || LANGS[0])[1];

  const Item = ({ icon, label, onPress, tint }) => (
    <TouchableOpacity onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 18 }}>
      <Ionicons name={icon} size={22} color={tint || C.primary} style={{ width: 34 }} /><Text style={{ fontSize: 15, color: C.text }}>{label}</Text>
    </TouchableOpacity>);
  const Group = ({ title, children: kids }) => (<View><Text style={{ fontSize: 12, fontWeight: '800', color: C.muted, marginTop: 14, marginBottom: 2, paddingHorizontal: 18, textTransform: 'uppercase' }}>{title}</Text>{kids}</View>);

  return (
    <Ctx.Provider value={{ open: () => setShow(true), close }}>
      {children}
      {/* statusBarTranslucent + navigationBarTranslucent: the panel draws under the system bars, so the safe-area padding is applied once (no double gap) */}
      <Modal visible={show} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={close}>
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <View style={{ width: '82%', maxWidth: 340, backgroundColor: '#fff', paddingTop: insets.top, paddingBottom: insets.bottom }}>
            <View style={{ padding: 18, borderBottomWidth: 1, borderColor: C.border }}>
              <Logo size={40} withText />
              <Text style={{ color: C.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1, marginTop: 6 }}>{TAGLINE.toUpperCase()}</Text>
              <Text style={{ color: C.text, marginTop: 10, fontWeight: '700' }}>{session ? `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim() || session.user.email : 'Browsing as a guest'}</Text>
              {!session && <TouchableOpacity onPress={() => tab('Profile')} style={{ marginTop: 10, alignSelf: 'flex-start', backgroundColor: C.primary, borderRadius: 18, paddingHorizontal: 18, paddingVertical: 8 }}><Text style={{ color: '#fff', fontWeight: '800' }}>Log in</Text></TouchableOpacity>}
            </View>
            <ScrollView>
              <TouchableOpacity onPress={() => (isProvider ? tab('Host') : go('ProviderRegister', undefined, 'host'))}
                style={{ margin: 14, backgroundColor: '#E3EDE8', borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="swap-horizontal" size={24} color={C.primary} />
                <View style={{ marginLeft: 12, flex: 1 }}><Text style={{ fontWeight: '800', color: C.text }}>{isProvider ? 'Switch to hosting' : 'Become a host'}</Text>
                  <Text style={{ color: C.muted, fontSize: 12 }}>{isProvider ? 'Open your host dashboard' : 'ID verification required'}</Text></View>
                <Ionicons name="chevron-forward" size={18} color={C.muted} />
              </TouchableOpacity>

              <TouchableOpacity onPress={() => setLangOpen(!langOpen)} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 18, borderTopWidth: 1, borderBottomWidth: 1, borderColor: C.border }}>
                <Ionicons name="language-outline" size={22} color={C.primary} style={{ width: 34 }} />
                <Text style={{ flex: 1, fontSize: 15, color: C.text }}>Language</Text>
                <Text style={{ color: C.muted, marginRight: 6 }}>{curLang}</Text>
                <Ionicons name={langOpen ? 'chevron-up' : 'chevron-down'} size={18} color={C.muted} />
              </TouchableOpacity>
              {langOpen && LANGS.map(([c, n]) => (
                <TouchableOpacity key={c} onPress={() => { close(); setLang(c); }} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingLeft: 52, paddingRight: 18, backgroundColor: '#F7F8FA' }}>
                  <Text style={{ flex: 1, color: i18n.locale === c ? C.primary : C.text, fontWeight: i18n.locale === c ? '800' : '400' }}>{n}</Text>
                  {i18n.locale === c && <Ionicons name="checkmark" size={18} color={C.primary} />}
                </TouchableOpacity>))}

              <Group title="Explore">
                <Item icon="home-outline" label="Home" onPress={() => tab('Explore')} />
                <Item icon="map-outline" label={tr('map')} onPress={() => tab('Map')} />
                <Item icon="heart-outline" label="Favourite places" onPress={() => tab('Saved')} />
                <Item icon="ticket-outline" label="My bookings" onPress={() => tab('Trips')} />
                <Item icon="chatbubbles-outline" label="Messages" onPress={() => go('Inbox', undefined, 'trips')} />
                <Item icon="notifications-outline" label="Notifications" onPress={() => go('Notifications', undefined, 'notifications')} />
              </Group>
              <Group title="Browse by category">
                {CATS.map((c) => <Item key={c.key} icon={c.icon} label={tr(c.key)} onPress={() => tab('Explore', { cat: c.key })} />)}
              </Group>
              <Group title="Travel services">
                <Item icon="car-outline" label={tr('transfer')} onPress={() => go('AirportTransfer', undefined, 'book')} />
                <Item icon="briefcase-outline" label="Trip builder" onPress={() => go('TripBuilder', undefined, 'book')} />
                <Item icon="people-outline" label={tr('custom')} onPress={() => go('CustomTrip', undefined, 'book')} />
              </Group>
              {isProvider && <Group title="Hosting">
                <Item icon="business-outline" label="Host dashboard" onPress={() => tab('Host')} />
                <Item icon="calendar-outline" label="Host bookings" onPress={() => go('HostBookings')} />
                <Item icon="help-buoy-outline" label="Guest inquiries" onPress={() => go('HostInquiries')} />
                <Item icon="qr-code-outline" label="Scan booking QR" onPress={() => go('ScanQR')} />
                <Item icon="stats-chart-outline" label="Analytics & earnings" onPress={() => go('Analytics')} />
                <Item icon="document-text-outline" label="Booking forms" onPress={() => go('BookingForms')} />
              </Group>}
              <Group title="Account">
                <Item icon="person-outline" label={tr('profile')} onPress={() => tab('Profile')} />
                <Item icon="shield-checkmark-outline" label="Privacy policy" onPress={() => go('Legal', { kind: 'privacy' })} />
                <Item icon="document-text-outline" label="Terms & conditions" onPress={() => go('Legal', { kind: 'terms' })} />
                {isAdmin && <Item icon="construct-outline" label="Admin panel" onPress={() => go('Admin')} />}
                {session && <Item icon="log-out-outline" label={tr('logout')} tint={C.danger} onPress={() => { close(); supabase.auth.signOut(); }} />}
              </Group>
              <View style={{ height: 24 }} />
            </ScrollView>
          </View>
          <TouchableOpacity activeOpacity={1} onPress={close} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }} />
        </View>
      </Modal>
    </Ctx.Provider>
  );
}
