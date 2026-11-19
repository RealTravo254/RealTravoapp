import React from 'react';
import { ScrollView, Text, View, Alert, Image, TouchableOpacity } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/AuthContext';
import ScreenHeader from '../components/ScreenHeader';
import AuthForm from '../components/AuthForm';
import { Muted } from '../components/ui';
import { tr } from '../i18n';
import { pickAndUploadPhoto } from '../lib/upload';
import { C } from '../lib/theme';

const Row = ({ icon, label, value, onPress, danger }) => (
  <TouchableOpacity disabled={!onPress} onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 13, borderBottomWidth: 1, borderColor: C.border }}>
    <Ionicons name={icon} size={20} color={danger ? C.danger : C.primary} style={{ width: 32 }} />
    <Text style={{ flex: 1, color: danger ? C.danger : C.text, fontSize: 15 }}>{label}</Text>
    {value ? <Text style={{ color: C.muted, maxWidth: '55%' }} numberOfLines={1}>{value}</Text> : null}
    {onPress && !danger ? <Ionicons name="chevron-forward" size={18} color={C.muted} style={{ marginLeft: 6 }} /> : null}
  </TouchableOpacity>);
const Section = ({ title, children }) => (<View style={{ marginTop: 16 }}><Text style={{ marginHorizontal: 16, marginBottom: 4, fontWeight: '800', color: C.muted, fontSize: 12, textTransform: 'uppercase' }}>{title}</Text>
  <View style={{ backgroundColor: '#fff', marginHorizontal: 12, borderRadius: 14, paddingHorizontal: 14, borderWidth: 1, borderColor: C.border }}>{children}</View></View>);

export default function ProfileScreen({ navigation }) {
  const { profile, subscribed, isProvider, isAdmin, session, refresh, ensureLogin } = useAuth();

  // Signed out: the whole page is the login / sign up / Google screen
  if (!session) return (
    <View style={{ flex: 1 }}>
      <ScreenHeader />
      <AuthForm reason="profile" />
    </View>);

  const avatar = async () => { try { const u = await pickAndUploadPhoto(session.user.id, 'avatars'); if (u) { await supabase.from('profiles').update({ avatar_url: u }).eq('id', session.user.id); refresh(); } } catch (e) { Alert.alert('Upload failed', e.message); } };
  const name = `${profile?.first_name || ''} ${profile?.last_name || ''}`.trim();
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScreenHeader />
      <ScrollView>
        <View style={{ alignItems: 'center', paddingVertical: 20, backgroundColor: '#fff', borderBottomWidth: 1, borderColor: C.border }}>
          <TouchableOpacity onPress={avatar}>
            {profile?.avatar_url ? <Image source={{ uri: profile.avatar_url }} style={{ width: 92, height: 92, borderRadius: 46 }} />
              : <View style={{ width: 92, height: 92, borderRadius: 46, backgroundColor: C.deep, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontSize: 34, fontWeight: '800' }}>{(profile?.first_name || session.user.email)[0].toUpperCase()}</Text></View>}
            <View style={{ position: 'absolute', right: 0, bottom: 0, backgroundColor: C.primary, borderRadius: 14, width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="camera" size={15} color="#fff" /></View>
          </TouchableOpacity>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}>
            <Text style={{ fontSize: 20, fontWeight: '800' }}>{name || 'Your name'}</Text>
            {isProvider && <View style={{ marginLeft: 6 }}><MaterialCommunityIcons name="check-decagram" size={22} color="#1D9BF0" /></View>}
          </View>
          <Muted>{session.user.email}</Muted>
          {isProvider && <Text style={{ marginTop: 6, color: '#1D9BF0', fontWeight: '800' }}>Verified host</Text>}
          <View style={{ flexDirection: 'row', marginTop: 12 }}>
            <View style={{ alignItems: 'center', paddingHorizontal: 20 }}><Text style={{ fontSize: 18, fontWeight: '800' }}>${Number(profile?.balance || 0).toFixed(2)}</Text><Muted>{tr('balance')}</Muted></View>
          </View>
        </View>

        <Section title="Personal details">
          <Row icon="person-outline" label="First name" value={profile?.first_name} onPress={() => navigation.navigate('EditProfile')} />
          <Row icon="person-outline" label="Last name" value={profile?.last_name} onPress={() => navigation.navigate('EditProfile')} />
          <Row icon="male-female-outline" label="Gender" value={profile?.gender} />
          <Row icon="calendar-outline" label="Date of birth" value={profile?.date_of_birth} />
          <Row icon="flag-outline" label="Country" value={profile?.country ? (isProvider ? `🔒 ${profile.country}` : profile.country) : 'Not set'} />
          <Row icon="call-outline" label="Phone" value={profile?.phone || 'Not added'} />
          <Row icon="mail-outline" label="Email" value={session.user.email} onPress={() => navigation.navigate('ChangeEmail')} />
        </Section>

        <Section title="Account settings">
          <Row icon="create-outline" label="Edit name & details" onPress={() => navigation.navigate('EditProfile')} />
          <Row icon="lock-closed-outline" label="Change password" onPress={() => navigation.navigate('ChangePassword')} />
          <Row icon="notifications-outline" label="Notifications" onPress={() => navigation.navigate('Notifications')} />
          <Row icon="chatbubbles-outline" label="Messages" onPress={() => navigation.navigate('Inbox')} />
          {isProvider ? <Row icon="document-text-outline" label="Booking forms" onPress={() => navigation.navigate('BookingForms')} />
            : <Row icon="swap-horizontal" label="Become a host" value="ID verification" onPress={() => { if (ensureLogin(navigation, 'host')) navigation.navigate('ProviderRegister'); }} />}
          {isAdmin && <Row icon="construct-outline" label="Admin panel" onPress={() => navigation.navigate('Admin')} />}
          <Row icon="log-out-outline" label={tr('logout')} danger onPress={() => supabase.auth.signOut()} />
        </Section>
        <View style={{ height: 30 }} />
      </ScrollView>
    </View>
  );
}