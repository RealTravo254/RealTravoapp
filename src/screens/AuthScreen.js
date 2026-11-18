import React, { useEffect } from 'react';
import { useAuth } from '../lib/AuthContext';
import AuthForm from '../components/AuthForm';

export default function AuthScreen({ navigation, route }) {
  const { session, profile, profileComplete } = useAuth();
  useEffect(() => { // after signing in: return to where the user was (or complete the profile first)
    if (session && profile) { if (profileComplete) navigation.goBack(); else navigation.replace('CompleteProfile'); }
  }, [session, profile]);
  return <AuthForm reason={route.params?.reason} onGuest={() => navigation.goBack()} />;
}
