import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import Logo from './Logo';
import { emit } from '../lib/events';
import { C } from '../lib/theme';

// Friendly, branded question shown once BEFORE the phone's own permission dialog (which cannot be restyled).
const KEY = 'perm_asked_v1';
const Point = ({ icon, color, text }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 6 }}>
    <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: color + '22', alignItems: 'center', justifyContent: 'center' }}><Ionicons name={icon} size={20} color={color} /></View>
    <Text style={{ flex: 1, marginLeft: 12, color: C.text, fontSize: 15 }}>{text}</Text>
  </View>);
export default function PermissionPrompt() {
  const [show, setShow] = useState(false);
  useEffect(() => { (async () => {
    try { const asked = await AsyncStorage.getItem(KEY); const { status } = await Location.getForegroundPermissionsAsync(); if (!asked && status !== 'granted') setShow(true); } catch (e) {}
  })(); }, []);
  const done = async () => { try { await AsyncStorage.setItem(KEY, '1'); } catch (e) {} setShow(false); };
  const allow = async () => { await done(); try { const { status } = await Location.requestForegroundPermissionsAsync(); if (status === 'granted') emit('location-granted'); } catch (e) {} };
  return (
    <Modal visible={show} transparent animationType="fade" onRequestClose={done}>
      <View style={{ flex: 1, backgroundColor: 'rgba(15,40,28,0.55)', justifyContent: 'center', padding: 24 }}>
        <View style={{ backgroundColor: '#fff', borderRadius: 24, padding: 22, alignItems: 'center' }}>
          <Logo size={64} />
          <View style={{ width: 84, height: 84, borderRadius: 42, backgroundColor: '#E3EDE8', alignItems: 'center', justifyContent: 'center', marginTop: 14 }}><Ionicons name="location" size={42} color={C.primary} /></View>
          <Text style={{ fontSize: 22, fontWeight: '800', color: C.text, marginTop: 14, textAlign: 'center' }}>Find places near you</Text>
          <Text style={{ color: C.muted, textAlign: 'center', marginTop: 6 }}>Allow your location to get the best of RealTravo.</Text>
          <View style={{ alignSelf: 'stretch', marginTop: 12 }}>
            <Point icon="star" color="#E8890C" text="Top rated hotels, camps and tours near you" />
            <Point icon="map" color="#2F6FDE" text="Distances and directions on the real road" />
            <Point icon="car" color="#8E44AD" text="Easy pickups from where you are" />
          </View>
          <TouchableOpacity onPress={allow} style={{ alignSelf: 'stretch', backgroundColor: C.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 16 }}><Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>Allow location</Text></TouchableOpacity>
          <TouchableOpacity onPress={done} style={{ paddingVertical: 12 }}><Text style={{ color: C.muted, fontWeight: '700' }}>Not now</Text></TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
