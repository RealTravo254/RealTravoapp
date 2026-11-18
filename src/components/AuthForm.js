import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Alert, ActivityIndicator, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import DateField from './DateField';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { nativeGoogle } from '../lib/googleNative';
import { ymd } from '../lib/pricing';
import { Btn, Input, Label, Chip, Muted } from './ui';
import CountryPicker from './CountryPicker';
import PhoneField from './PhoneField';
import Logo, { TAGLINE } from './Logo';
import { C } from '../lib/theme';
WebBrowser.maybeCompleteAuthSession();

const WHY = { book: 'Log in to book.', profile: 'Log in to open your account.', subscribe: 'Log in to continue.', inquiry: 'Log in to contact the host.',
  trips: 'Log in to see your bookings.', host: 'Log in first to become a host.', notifications: 'Log in to see your notifications.' };

export default function AuthForm({ reason, onGuest }) {
  const [mode, setMode] = useState('login');
  const [f, setF] = useState({ first_name: '', last_name: '', gender: '', country: '', phone: '', email: '', password: '', confirm: '' });
  const [dob, setDob] = useState(new Date(2000, 0, 1));
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState('Logging in…');
  const timer = useRef(null);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const start = (m) => { setMsg(m); setBusy(true); clearTimeout(timer.current); timer.current = setTimeout(() => setBusy(false), 25000); }; // never spin forever
  const stop = () => { clearTimeout(timer.current); setBusy(false); };
  useEffect(() => () => clearTimeout(timer.current), []);

  const login = async () => {
    if (!f.email.trim() || !f.password) return Alert.alert('Enter your email and password');
    start('Logging in…');
    const { error } = await supabase.auth.signInWithPassword({ email: f.email.trim(), password: f.password });
    if (error) { stop(); Alert.alert('Could not log in', error.message); }
  };
  const signup = async () => {
    if (!f.first_name.trim() || !f.last_name.trim()) return Alert.alert('Enter your first and last name');
    if (!f.gender) return Alert.alert('Choose your gender');
    if (!f.country) return Alert.alert('Choose your country');
    if ((Date.now() - dob.getTime()) / 31557600000 < 16) return Alert.alert('Sorry', 'You must be 16 or older to create an account.');
    if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) return Alert.alert('Enter a valid email');
    if (f.password.length < 6) return Alert.alert('Password', 'Use at least 6 characters.');
    if (f.password !== f.confirm) return Alert.alert('Password', 'The two passwords do not match.');
    start('Creating your account…');
    const { data, error } = await supabase.auth.signUp({ email: f.email.trim(), password: f.password,
      options: { data: { first_name: f.first_name.trim(), last_name: f.last_name.trim(), gender: f.gender, country: f.country, date_of_birth: ymd(dob), phone: f.phone || '' } } });
    stop();
    if (error) return Alert.alert('Could not create account', error.message);
    if (!data.session) Alert.alert('Check your email', 'We sent you a link to confirm your email. Then log in.');
  };
  const google = async () => {
    start('Opening Google…');
    try {
      if (await nativeGoogle()) { setMsg('Logging in…'); return; } // success arrives as a session; the spinner stays until the app moves on
      // fallback (Expo Go or no Google setup): browser sign-in
      const redirectTo = makeRedirectUri({ scheme: 'travelapp' });
      const { data, error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, skipBrowserRedirect: true } });
      if (error) throw error;
      const res = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (res.type === 'success') {
        setMsg('Logging in…');
        const q = new URLSearchParams(res.url.split('#')[1] || '');
        if (q.get('access_token')) await supabase.auth.setSession({ access_token: q.get('access_token'), refresh_token: q.get('refresh_token') }); else stop();
      } else stop();
    } catch (e) {
      stop();
      if (!/cancel|12501|SIGN_IN_CANCELLED/i.test(String(e?.code || e?.message))) Alert.alert('Google sign-in', e.message || 'Could not sign in with Google');
    }
  };

  const signupMode = mode === 'signup';
  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 24, justifyContent: signupMode ? 'flex-start' : 'center' }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', marginBottom: 20 }}>
          <Logo size={signupMode ? 56 : 70} withText />
          <Text style={{ marginTop: 10, fontSize: 11, fontWeight: '800', letterSpacing: 1.2, color: C.muted, textAlign: 'center' }}>{TAGLINE.toUpperCase()}</Text>
        </View>
        <Text style={{ fontSize: 24, fontWeight: '800', color: C.text }}>{signupMode ? 'Create your account' : 'Welcome back'}</Text>
        <Text style={{ color: C.muted, marginBottom: 10 }}>{WHY[reason] || (signupMode ? 'Fill in your details, it takes a minute.' : 'Log in to continue.')}</Text>

        {signupMode && <>
          <Label>First name</Label><Input value={f.first_name} onChangeText={set('first_name')} />
          <Label>Last name</Label><Input value={f.last_name} onChangeText={set('last_name')} />
          <Label>Gender</Label>
          <View style={{ flexDirection: 'row' }}>{['Male', 'Female', 'Other'].map((g) => <Chip key={g} label={g} active={f.gender === g} onPress={() => set('gender')(g)} />)}</View>
          <Label>Country</Label><CountryPicker value={f.country} onChange={set('country')} />
          <Label>Date of birth (16+)</Label>
          <DateField value={dob} maximumDate={new Date()} onChange={setDob} />
          
          <Label>Phone number (optional)</Label><PhoneField country={f.country} value={f.phone} onChange={set('phone')} />
        </>}

        <Label>Email</Label><Input placeholder="you@example.com" autoCapitalize="none" keyboardType="email-address" value={f.email} onChangeText={set('email')} />
        <Label>Password</Label><Input placeholder="Password" secureTextEntry value={f.password} onChangeText={set('password')} />
        {signupMode && <><Label>Confirm password</Label><Input placeholder="Type the password again" secureTextEntry value={f.confirm} onChangeText={set('confirm')} /></>}
        <Btn title={signupMode ? 'Create account' : 'Log in'} onPress={signupMode ? signup : login} />

        <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 12 }}>
          <View style={{ flex: 1, height: 1, backgroundColor: C.border }} /><Text style={{ marginHorizontal: 12, color: C.muted }}>or</Text><View style={{ flex: 1, height: 1, backgroundColor: C.border }} />
        </View>
        <TouchableOpacity onPress={google} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingVertical: 12 }}>
          <Ionicons name="logo-google" size={20} color="#DB4437" /><Text style={{ marginLeft: 10, fontWeight: '700', color: C.text }}>Continue with Google</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setMode(signupMode ? 'login' : 'signup')} style={{ marginTop: 18, alignItems: 'center' }}>
          <Text style={{ color: C.muted }}>{signupMode ? 'Already have an account? ' : 'New here? '}<Text style={{ color: C.primary, fontWeight: '800' }}>{signupMode ? 'Log in' : 'Create an account'}</Text></Text>
        </TouchableOpacity>
        {onGuest ? <TouchableOpacity onPress={onGuest} style={{ marginTop: 14, alignItems: 'center' }}><Text style={{ color: C.muted }}>Keep browsing without an account</Text></TouchableOpacity> : null}
        <View style={{ height: 30 }} />
      </ScrollView>
      {busy && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(255,255,255,0.96)', alignItems: 'center', justifyContent: 'center' }]}>
          <Logo size={64} />
          <ActivityIndicator size="large" color={C.primary} style={{ marginTop: 22 }} />
          <Text style={{ marginTop: 14, fontSize: 16, fontWeight: '700', color: C.text }}>{msg}</Text>
        </View>
      )}
    </View>
  );
}
