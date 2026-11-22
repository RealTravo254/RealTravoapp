import React, { createContext, useContext, useState } from 'react';
import { View } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import CrashReport from './src/components/CrashReport';
import { AuthProvider, useAuth } from './src/lib/AuthContext';
import { WishlistProvider } from './src/lib/wishlist';
import { tr } from './src/i18n';
import { C } from './src/lib/theme';
import { Loader } from './src/components/ui';
import { Bell } from './src/components/ScreenHeader';
import Splash from './src/components/Splash';
import ErrorBoundary from './src/components/ErrorBoundary';
import PermissionPrompt from './src/components/PermissionPrompt';
import UpdatePrompt from './src/components/UpdatePrompt';
import ChangePassword from './src/screens/ChangePassword';
import Inbox from './src/screens/Inbox';
import ChangeEmail from './src/screens/ChangeEmail';
import BookingForms from './src/screens/host/BookingForms';
import BookingFormScreen from './src/screens/BookingFormScreen';
import { MenuProvider } from './src/components/MenuDrawer';
import PickLocation from './src/screens/PickLocation';
import EditProfile from './src/screens/EditProfile';
import Legal from './src/screens/Legal';
import Consent from './src/screens/Consent';
import Inquiry from './src/screens/Inquiry';
import HostInquiries from './src/screens/host/HostInquiries';
import AuthScreen from './src/screens/AuthScreen';
import CompleteProfile from './src/screens/CompleteProfile';
import Explore from './src/screens/Explore';
import MapScreen from './src/screens/MapScreen';
import Wishlist from './src/screens/Wishlist';
import Notifications from './src/screens/Notifications';
import TravelMap from './src/screens/TravelMap';
import AddOns from './src/screens/AddOns';
import ListingDetail from './src/screens/ListingDetail';
import BookingScreen from './src/screens/BookingScreen';
import BookingDetail from './src/screens/BookingDetail';
import EditBooking from './src/screens/EditBooking';
import MyTrips from './src/screens/MyTrips';
import Chat from './src/screens/Chat';
import ProfileScreen from './src/screens/ProfileScreen';
import Wallet from './src/screens/Wallet';
import TripBuilder from './src/screens/TripBuilder';
import AirportTransfer from './src/screens/AirportTransfer';
import CustomTrip from './src/screens/CustomTrip';
import PayWebView from './src/screens/PayWebView';
import PaymentMethods from './src/screens/PaymentMethods';
import ReviewScreen from './src/screens/ReviewScreen';
import HostHome from './src/screens/host/HostHome';
import ProviderRegister from './src/screens/host/ProviderRegister';
import ListingForm from './src/screens/host/ListingForm';
import HostBookings from './src/screens/host/HostBookings';
import ScanQR from './src/screens/host/ScanQR';
import Analytics from './src/screens/host/Analytics';
import PaymentSettings from './src/screens/host/PaymentSettings';
import AdminHome, { AdminSection } from './src/screens/admin/AdminHome';
import AdminListing from './src/screens/admin/AdminListing';
import AdminUsers from './src/screens/admin/AdminUsers';

// Remember the last JavaScript error so it can be shown (and sent) after a crash
try {
  const prevHandler = global.ErrorUtils && global.ErrorUtils.getGlobalHandler && global.ErrorUtils.getGlobalHandler();
  if (global.ErrorUtils && global.ErrorUtils.setGlobalHandler) global.ErrorUtils.setGlobalHandler((e, fatal) => {
    try { AsyncStorage.setItem('last_crash', `${fatal ? 'FATAL ' : ''}${e && e.message}\n${String((e && e.stack) || '').slice(0, 1500)}`); } catch (x) {}
    if (prevHandler) prevHandler(e, fatal);
  });
} catch (x) {}

const navRef = createNavigationContainerRef();
const ExploreReadyContext = createContext(() => {});
// Every stack page keeps clear of the phone's bottom/side safe areas (the native header handles the top)
const safe = (Comp) => function Safe(props) {
  const i = useSafeAreaInsets();
  return <View style={{ flex: 1, paddingBottom: i.bottom, paddingLeft: i.left, paddingRight: i.right }}><ErrorBoundary><Comp {...props} /></ErrorBoundary></View>;
};
const S = Object.fromEntries(Object.entries({ AuthScreen, CompleteProfile, Notifications, BookingScreen, BookingDetail, EditBooking, TravelMap, AddOns, Chat, TripBuilder, AirportTransfer, CustomTrip, PayWebView, PaymentMethods, ReviewScreen,
  ProviderRegister, ListingForm, HostBookings, ScanQR, Analytics, PaymentSettings, AdminHome, AdminSection, AdminUsers, PickLocation, EditProfile, Legal, Consent, Inquiry, HostInquiries, ChangePassword, Inbox, ChangeEmail, BookingForms, BookingFormScreen, AdminListing, Wallet }).map(([k, v]) => [k, safe(v)]));
// one crashing screen never closes the whole app
const guard = (Comp) => function Guard(props) { return <ErrorBoundary><Comp {...props} /></ErrorBoundary>; };
const G = { Explore: guard(Explore), MapScreen: guard(MapScreen), Wishlist: guard(Wishlist), MyTrips: guard(MyTrips), HostHome: guard(HostHome), ProfileScreen: guard(ProfileScreen), ListingDetail: guard(ListingDetail) };
function ExploreTab(props) {
  const onInitialLoadComplete = useContext(ExploreReadyContext);
  return <G.Explore {...props} onInitialLoadComplete={onInitialLoadComplete} />;
}
const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();
const linking = { prefixes: ['travelapp://'], config: { screens: { ListingDetail: 'listing/:id', BookingForm: 'form/:slug' } } };

const tabIcon = (name) => ({ color, size, focused }) => <Ionicons name={focused ? name : `${name}-outline`} size={size} color={color} />;

// Booking pages: primary-colour header with a white bell (the bell keeps its unread badge)
const primaryHeader = { headerStyle: { backgroundColor: C.primary }, headerTintColor: '#FFFFFF', headerTitleStyle: { color: '#FFFFFF' } };
const bookingHeader = { ...primaryHeader, headerRight: () => <Bell color="#FFFFFF" /> };

function Tabs() {
  const { isProvider } = useAuth(); const insets = useSafeAreaInsets();
  return (
    <Tab.Navigator screenOptions={{ headerShown: false, tabBarActiveTintColor: '#8FE0B5', tabBarInactiveTintColor: '#A9BFB5',
      tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      tabBarStyle: { backgroundColor: C.deep, borderTopWidth: 0, height: 56 + Math.max(insets.bottom, 6), paddingTop: 6, paddingBottom: Math.max(insets.bottom, 6) } }}>
      <Tab.Screen name="Explore" component={ExploreTab} options={{ title: 'Home', tabBarIcon: tabIcon('home') }} />
      <Tab.Screen name="Map" component={G.MapScreen} options={{ title: tr('map'), tabBarIcon: tabIcon('map') }} />
      <Tab.Screen name="Saved" component={G.Wishlist} options={{ title: 'Favourite', tabBarIcon: tabIcon('heart') }} />
      <Tab.Screen name="Trips" component={G.MyTrips} options={{ title: 'My bookings', tabBarIcon: tabIcon('ticket') }} />
      {isProvider && <Tab.Screen name="Host" component={G.HostHome} options={{ title: tr('host'), tabBarIcon: tabIcon('business') }} />}
      <Tab.Screen name="Profile" component={G.ProfileScreen} options={{ title: tr('profile'), tabBarIcon: tabIcon('person') }} />
    </Tab.Navigator>
  );
}

function Root() {
  const { session, loading, profile, lang, pendingLegal, legalLoading } = useAuth();
  if (loading || (session && !profile) || (session && legalLoading)) return <View style={{ flex: 1, justifyContent: 'center' }}><Loader /></View>;
  const none = { headerRight: () => null };
  if (session && pendingLegal.length > 0) return (
    <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: '#FFFFFF' }, headerTintColor: C.text, headerTitleStyle: { color: C.text } }}>
      <Stack.Screen name="Consent" component={S.Consent} options={{ title: 'Terms & privacy', headerBackVisible: false }} />
      <Stack.Screen name="Legal" component={S.Legal} options={{ title: 'Document' }} />
    </Stack.Navigator>);
  return (
    <Stack.Navigator key={lang} screenOptions={{ headerStyle: { backgroundColor: '#FFFFFF' }, headerTintColor: C.text, headerTitleStyle: { color: C.text }, headerRight: () => <Bell /> }}>
      <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
      <Stack.Screen name="Auth" component={S.AuthScreen} options={{ title: 'Sign in', presentation: 'modal', ...none }} />
      <Stack.Screen name="CompleteProfile" component={S.CompleteProfile} options={{ title: 'Complete your profile', ...none }} />
      <Stack.Screen name="Notifications" component={S.Notifications} options={{ title: 'Notifications', ...none }} />
      <Stack.Screen name="ListingDetail" component={G.ListingDetail} options={{ title: '', ...bookingHeader }} />
      <Stack.Screen name="BookingDetail" component={S.BookingDetail} options={{ title: 'Booking details' }} />
      <Stack.Screen name="Booking" component={S.BookingScreen} options={{ title: 'Complete your booking', ...bookingHeader }} />
      <Stack.Screen name="EditBooking" component={S.EditBooking} options={{ title: 'Edit booking', ...bookingHeader }} />
      <Stack.Screen name="Inquiry" component={S.Inquiry} options={{ title: 'Ask the host' }} />
      <Stack.Screen name="TravelMap" component={S.TravelMap} />
      <Stack.Screen name="PickLocation" component={S.PickLocation} options={{ ...none }} />
      <Stack.Screen name="AddOns" component={S.AddOns} options={{ title: 'Complete your travel', ...bookingHeader }} />
      <Stack.Screen name="Chat" component={S.Chat} />
      <Stack.Screen name="TripBuilder" component={S.TripBuilder} options={{ title: tr('custom') }} />
      <Stack.Screen name="AirportTransfer" component={S.AirportTransfer} options={{ title: tr('transfer'), ...bookingHeader }} />
      <Stack.Screen name="CustomTrip" component={S.CustomTrip} options={{ title: 'Custom trip request', ...bookingHeader }} />
      <Stack.Screen name="Pay" component={S.PayWebView} options={{ title: 'Pay securely' }} />
      <Stack.Screen name="PaymentMethods" component={S.PaymentMethods} options={{ title: 'Payment method' }} />
      <Stack.Screen name="Review" component={S.ReviewScreen} />
      <Stack.Screen name="EditProfile" component={S.EditProfile} options={{ title: 'Edit profile', ...none }} />
      <Stack.Screen name="Wallet" component={S.Wallet} options={{ title: 'Wallet', ...none }} />
      <Stack.Screen name="Legal" component={S.Legal} options={{ ...none }} />
      <Stack.Screen name="ChangePassword" component={S.ChangePassword} options={{ title: 'Change password', ...none }} />
      <Stack.Screen name="Inbox" component={S.Inbox} options={{ title: 'Messages' }} />
      <Stack.Screen name="ChangeEmail" component={S.ChangeEmail} options={{ title: 'Change email', ...none }} />
      <Stack.Screen name="BookingForms" component={S.BookingForms} options={{ title: 'Booking forms' }} />
      <Stack.Screen name="BookingForm" component={S.BookingFormScreen} options={{ title: 'Complete your booking', ...bookingHeader }} />
      <Stack.Screen name="ProviderRegister" component={S.ProviderRegister} options={{ title: 'Become a host' }} />
      <Stack.Screen name="ListingForm" component={S.ListingForm} options={{ title: 'Listing' }} />
      <Stack.Screen name="HostBookings" component={S.HostBookings} options={{ title: 'Bookings' }} />
      <Stack.Screen name="HostInquiries" component={S.HostInquiries} options={{ title: 'Guest inquiries' }} />
      <Stack.Screen name="ScanQR" component={S.ScanQR} options={{ title: 'Scan booking QR' }} />
      <Stack.Screen name="Analytics" component={S.Analytics} />
      <Stack.Screen name="PaymentSettings" component={S.PaymentSettings} options={{ title: 'Payment settings' }} />
      <Stack.Screen name="Admin" component={S.AdminHome} options={{ title: 'Admin' }} />
      <Stack.Screen name="AdminSection" component={S.AdminSection} options={{ title: 'Admin' }} />
      <Stack.Screen name="AdminUsers" component={S.AdminUsers} options={{ title: 'Admin access' }} />
      <Stack.Screen name="AdminListing" component={S.AdminListing} options={{ title: 'Review listing' }} />
    </Stack.Navigator>
  );
}

export default function App() {
  const [splash, setSplash] = useState(true);
  return (
    <SafeAreaProvider>
      <ExploreReadyContext.Provider value={() => setSplash(false)}>
        <AuthProvider>
          <WishlistProvider>
            <NavigationContainer ref={navRef} linking={linking}><StatusBar style="dark" /><MenuProvider navRef={navRef}><ErrorBoundary><Root /></ErrorBoundary></MenuProvider></NavigationContainer>
          </WishlistProvider>
        </AuthProvider>
      </ExploreReadyContext.Provider>
      {splash && <Splash />}
      {!splash && <PermissionPrompt />}
      {!splash && <UpdatePrompt />}
      {!splash && <CrashReport />}
    </SafeAreaProvider>
  );
}