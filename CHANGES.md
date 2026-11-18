# RealTravo update
Copy this folder's contents over your project (merge, do NOT delete your folder: src/screens/host, src/screens/admin, assets, .env are not in this zip).
Then run supabase/app-update.sql in the Supabase SQL editor, and start with: npx expo start --offline -c

NEW: src/lib/schedule.js, src/components/{PickerSheet,DateField}.js, src/screens/EditBooking.js, supabase/app-update.sql
CHANGED: App.js, package.json (removed invalid "name": null), src/lib/pricing.js (bestOffer local date),
 components/{TimeField,ScreenHeader,AuthForm}.js, screens/{BookingScreen,AddOns,BookingFormScreen,MyTrips,PickLocation,PayWebView,ListingDetail,
 Inquiry,EditProfile,CompleteProfile,TripBuilder,AirportTransfer}.js
UNCHANGED copies: everything else in src/, supabase/schema.sql, the two edge functions.

## Update 2 (host rules, private drop-off, pickup times)
Run supabase/app-update-2.sql after app-update.sql.
NEW: src/components/PickupTimeField.js, supabase/app-update-2.sql, src/screens/host/*, src/screens/admin/* (your files, patched)
CHANGED: host/ProviderRegister.js, host/ListingForm.js, admin/AdminHome.js, screens/{AddOns,BookingFormScreen,BookingScreen,EditBooking,MyTrips,ListingDetail}.js

## Android build
See BUILD-ANDROID.md and fix-android-build.ps1 (Windows 260-character path error).
