import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Alert, ActivityIndicator, ScrollView, TouchableOpacity, StyleSheet, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import { createClient } from '@supabase/supabase-js';
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

// Set to false if you only want the code at sign-up and not at every login
const LOGIN_CODE = true;

const WHY = { book: 'Log in to book.', profile: 'Log in to open your account.', subscribe: 'Log in to continue.', inquiry: 'Log in to contact the host.',
  trips: 'Log in to see your bookings.', host: 'Log in first to become a host.', notifications: 'Log in to see your notifications.' };

// Password box with an eye button: tap to show or hide what you typed
function PasswordField({ value, onChangeText, placeholder }) {
  const [show, setShow] = useState(false);
  return (
    <View style={{ justifyContent: 'center' }}>
      <Input placeholder={placeholder} secureTextEntry={!show} autoCapitalize="none" autoCorrect={false} value={value} onChangeText={onChangeText} style={{ paddingRight: 48 }} />
      <TouchableOpacity onPress={() => setShow(!show)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} style={{ position: 'absolute', right: 14, top: 0, bottom: 0, justifyContent: 'center' }}>
        <Ionicons name={show ? 'eye-off-outline' : 'eye-outline'} size={22} color={C.muted} />
      </TouchableOpacity>
    </View>
  );
}

// "Forgot password" popup: 1) enter email -> 2) enter the emailed code + new password
function ForgotPasswordModal({ visible, initialEmail, onClose, onDone }) {
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) { setStep('email'); setEmail(initialEmail || ''); setCode(''); setPass(''); setConfirm(''); setBusy(false); }
  }, [visible]);

  const sendCode = async () => {
    const e = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(e)) return Alert.alert('Enter a valid email');
    setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(e);
      if (error) Alert.alert('Could not send code', error.message);
      else { setStep('code'); Alert.alert('Check your email', 'We sent a code to ' + e + '.'); }
    } catch (x) {
      Alert.alert('Could not send code', x?.message || 'Check your internet connection and try again.');
    }
    setBusy(false);
  };

  const resetPassword = async () => {
    const e = email.trim();
    if (code.trim().length < 6) return Alert.alert('Enter the code from your email');
    if (pass.length < 6) return Alert.alert('Password', 'Use at least 6 characters.');
    if (pass !== confirm) return Alert.alert('Password', 'The two passwords do not match.');
    setBusy(true);
    try {
      const v = await supabase.auth.verifyOtp({ email: e, token: code.trim(), type: 'recovery' });
      if (v.error) { setBusy(false); return Alert.alert('Invalid or expired code', v.error.message); }
      const u = await supabase.auth.updateUser({ password: pass });
      await supabase.auth.signOut({ scope: 'local' });
      if (u.error) { setBusy(false); return Alert.alert('Could not change password', u.error.message); }
      setBusy(false);
      onDone(e);
    } catch (x) {
      setBusy(false);
      Alert.alert('Could not change password', x?.message || 'Check your internet connection and try again.');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 20, maxHeight: '90%' }}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 20, fontWeight: '800', color: C.text }}>Forgot password</Text>
                <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Ionicons name="close" size={24} color={C.muted} />
                </TouchableOpacity>
              </View>
              {step === 'email' ? (
                <>
                  <Text style={{ color: C.muted, marginTop: 6 }}>Enter your email and we will send you a code.</Text>
                  <Label>Email</Label>
                  <Input placeholder="you@example.com" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
                  <Btn title={busy ? 'Sending…' : 'Send code'} onPress={busy ? () => {} : sendCode} />
                </>
              ) : (
                <>
                  <Text style={{ color: C.muted, marginTop: 6 }}>Enter the code we sent to {email.trim()} and choose a new password.</Text>
                  <Label>Code</Label>
                  <Input placeholder="Code from your email" keyboardType="number-pad" maxLength={8} value={code} onChangeText={(t) => setCode(t.replace(/\D/g, ''))} />
                  <Label>New password</Label>
                  <PasswordField placeholder="New password" value={pass} onChangeText={setPass} />
                  <Label>Confirm new password</Label>
                  <PasswordField placeholder="Type it again" value={confirm} onChangeText={setConfirm} />
                  <Btn title={busy ? 'Saving…' : 'Change password'} onPress={busy ? () => {} : resetPassword} />
                  <TouchableOpacity onPress={() => { if (!busy) { setStep('email'); setCode(''); } }} style={{ marginTop: 14, alignItems: 'center' }}>
                    <Text style={{ color: C.primary, fontWeight: '700' }}>Didn't get a code? Send again</Text>
                  </TouchableOpacity>
                </>
              )}
              {busy && <ActivityIndicator color={C.primary} style={{ marginTop: 12 }} />}
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export default function AuthForm({ reason, onGuest }) {
  const [mode, setMode] = useState('login');
  const [f, setF] = useState({ first_name: '', last_name: '', gender: '', country: '', phone: '', email: '', password: '', confirm: '' });
  const [dob, setDob] = useState(new Date(2000, 0, 1));
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState('Logging in…');
  const [forgot, setForgot] = useState(false);
  const [verify, setVerify] = useState(null); // null | { email, kind: 'signup' | 'login' }  -> inline code step
  const [code, setCode] = useState('');
  const [wait, setWait] = useState(0);        // seconds before "Send again" works
  const timer = useRef(null);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const start = (m) => { setMsg(m); setBusy(true); clearTimeout(timer.current); timer.current = setTimeout(() => setBusy(false), 25000); };
  const stop = () => { clearTimeout(timer.current); setBusy(false); };
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => { if (wait <= 0) return; const t = setTimeout(() => setWait(wait - 1), 1000); return () => clearTimeout(t); }, [wait]);

  const openCodeStep = (email, kind) => { setCode(''); setWait(60); setVerify({ email, kind }); };

  const login = async () => {
    if (!f.email.trim() || !f.password) return Alert.alert('Enter your email and password');
    start('Logging in…');
    const email = f.email.trim();
    try {
      // Code login turned off: normal password login
      if (!LOGIN_CODE) {
        const { error } = await supabase.auth.signInWithPassword({ email, password: f.password });
        if (error) { stop(); return Alert.alert('Could not log in', error.message); }
        return; // session arrives and the app moves on
      }

      // 1) Check the password on a throwaway client: no stored session, no app auth events
      const checker = createClient(supabase.supabaseUrl, supabase.supabaseKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      const { error } = await checker.auth.signInWithPassword({ email, password: f.password });
      if (error) { stop(); return Alert.alert('Could not log in', error.message); }

      // 2) Password is correct: email the code with the main client (no session yet)
      const r = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
      stop();
      if (r.error) return Alert.alert('Could not send code', r.error.message);

      // 3) Show the code page. The user is only logged in after confirmCode succeeds
      openCodeStep(email, 'login');
    } catch (x) {
      stop();
      Alert.alert('Could not log in', x?.message || 'Check your internet connection and try again.');
    }
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
    try {
      const { data, error } = await supabase.auth.signUp({ email: f.email.trim(), password: f.password,
        options: { data: { first_name: f.first_name.trim(), last_name: f.last_name.trim(), gender: f.gender, country: f.country, date_of_birth: ymd(dob), phone: f.phone || '' } } });
      stop();
      if (error) return Alert.alert('Could not create account', error.message);
      if (!data.session) openCodeStep(f.email.trim(), 'signup'); // email confirmation is on: ask for the code
    } catch (x) {
      stop();
      Alert.alert('Could not create account', x?.message || 'Check your internet connection and try again.');
    }
  };

  const confirmCode = async () => {
    if (code.trim().length < 6) return Alert.alert('Enter the code from your email');
    start('Checking code…');
    try {
      const { error } = await supabase.auth.verifyOtp({ email: verify.email, token: code.trim(), type: verify.kind === 'signup' ? 'signup' : 'email' });
      if (error) { stop(); return Alert.alert('Invalid or expired code', error.message); }
      // success: the session arrives and the app moves on
    } catch (x) {
      stop();
      Alert.alert('Could not check code', x?.message || 'Check your internet connection and try again.');
    }
  };

  const resendCode = async () => {
    if (wait > 0) return;
    start('Sending code…');
    try {
      const r = verify.kind === 'signup'
        ? await supabase.auth.resend({ type: 'signup', email: verify.email })
        : await supabase.auth.signInWithOtp({ email: verify.email, options: { shouldCreateUser: false } });
      stop();
      if (r.error) return Alert.alert('Could not send code', r.error.message);
      setWait(60); setCode('');
      Alert.alert('Code sent', 'Check your email.');
    } catch (x) {
      stop();
      Alert.alert('Could not send code', x?.message || 'Try again.');
    }
  };

  const google = async () => {
    start('Opening Google…');
    try {
      if (await nativeGoogle()) { setMsg('Logging in…'); return; }
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

  const onResetDone = (email) => {
    setForgot(false);
    setMode('login');
    setF((x) => ({ ...x, email, password: '' }));
    Alert.alert('Password changed', 'Log in with your new password.');
  };

  const spinner = busy && (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(255,255,255,0.96)', alignItems: 'center', justifyContent: 'center' }]}>
      <Logo size={64} />
      <ActivityIndicator size="large" color={C.primary} style={{ marginTop: 22 }} />
      <Text style={{ marginTop: 14, fontSize: 16, fontWeight: '700', color: C.text }}>{msg}</Text>
    </View>
  );

  // ---- Inline code step (a full page, not a popup) ----
  if (verify) {
    return (
      <View style={{ flex: 1, backgroundColor: '#fff' }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 24, justifyContent: 'center' }} keyboardShouldPersistTaps="handled">
          <View style={{ alignItems: 'center', marginBottom: 20 }}>
            <Logo size={70} withText />
          </View>
          <Text style={{ fontSize: 24, fontWeight: '800', color: C.text }}>{verify.kind === 'signup' ? 'Confirm your email' : 'Enter your login code'}</Text>
          <Text style={{ color: C.muted, marginBottom: 10 }}>We sent a code to {verify.email}. Type it below.</Text>
          <Label>Code</Label>
          <Input placeholder="Code from your email" keyboardType="number-pad" maxLength={8} value={code} onChangeText={(t) => setCode(t.replace(/\D/g, ''))} />
          <Btn title={verify.kind === 'signup' ? 'Confirm and continue' : 'Log in'} onPress={confirmCode} />
          <TouchableOpacity onPress={resendCode} disabled={wait > 0} style={{ marginTop: 16, alignItems: 'center' }}>
            <Text style={{ color: wait > 0 ? C.muted : C.primary, fontWeight: '700' }}>{wait > 0 ? `Send again in ${wait}s` : "Didn't get a code? Send again"}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { setVerify(null); setCode(''); setF((x) => ({ ...x, password: '', confirm: '' })); }} style={{ marginTop: 14, alignItems: 'center' }}>
            <Text style={{ color: C.muted }}>Back</Text>
          </TouchableOpacity>
        </ScrollView>
        {spinner}
      </View>
    );
  }

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
        <Label>Password</Label><PasswordField placeholder="Password" value={f.password} onChangeText={set('password')} />
        {signupMode && <><Label>Confirm password</Label><PasswordField placeholder="Type the password again" value={f.confirm} onChangeText={set('confirm')} /></>}
        {!signupMode && (
          <TouchableOpacity onPress={() => setForgot(true)} style={{ alignSelf: 'flex-end', marginTop: 8, marginBottom: 4 }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={{ color: C.primary, fontWeight: '700' }}>Forgot password?</Text>
          </TouchableOpacity>
        )}
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
      {spinner}
      <ForgotPasswordModal visible={forgot} initialEmail={f.email} onClose={() => setForgot(false)} onDone={onResetDone} />
    </View>
  );
}