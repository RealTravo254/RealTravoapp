# TravelApp (React Native / Expo + Supabase)

All-in-one travel search & booking: hotels, campsites, attractions, Airbnb, activities, event tickets, guides, airport transfers, custom trips.

## Run
```
npm install
npx expo start        # scan with Expo Go, or: npx expo run:android / run:ios (maps need a dev build)
```
`.env` is already pointed at your Supabase project **TRAVELAPP** (whtyrqbmbgyospyrlznx).
Add your Google keys to `.env` and `app.json` (Maps SDK + Places API).

## Supabase (already applied to the connected project)
Tables, RLS, storage buckets (`listing-photos`, `provider-docs`), RPCs (`respond_booking`, `cancel_booking`, `scan_qr`, `get_listing_contact`),
cron jobs (auto-decline unanswered bookings every 10 min, review requests hourly) and edge functions `init-payment` + `paystack-webhook` are live.

### You must still do
1. Edge-function secrets: `supabase secrets set PAYSTACK_SECRET_KEY=sk_... PAYSTACK_CURRENCY=KES`
2. Paystack dashboard -> webhook URL: `https://whtyrqbmbgyospyrlznx.supabase.co/functions/v1/paystack-webhook`
3. Supabase Auth -> Providers -> enable Google; add redirect `travelapp://`
4. Make yourself admin (after you sign up in the app):
   `update profiles set role='admin' where id = (select id from auth.users where email='YOU@EMAIL');`

## Roles
- **User**: search, map, book, pay, QR ticket, chat after acceptance, review, cancel -> refund to balance, custom trips, transfers.
- **Provider**: register with registration no. + TRA + document (hotel/campsite/attraction/guide = ONE listing each; Airbnb/activity/event hosts unlimited once verified), listings, accept/decline, scan QR, analytics, payout settings, promotion.
- **Admin** (Profile -> Admin panel): verify providers & listings (reject with note), vehicles/pricing per km, destinations, commission %, custom trip requests.

## v2 additions
- **In-app travel map**: Navigate button on every listing and on map pins (route, distance/time, driving/walking/transit/bicycling, live follow, step list). Needs Google *Directions API* enabled on the same key as Places.
- **Last booking step** (also reachable later from My Trips -> "Add pickup / stopover / stay / activity"): pickup (vehicle by group size, price by km), stopover, accommodation, activities. Suggestions are within 40 km of the main booking and never the same category as it. Everything is paid together.
- **Availability**: host sets a daily limit per listing; the booking screen shows places left and the database refuses overbooking.
- **Editing**: hosts can edit everything except category and location after the listing is first verified.
- **Payout methods**: admin manages methods per country (bank code / SWIFT, PayPal, mobile money, Wise) in Admin -> Payouts; hosts add their payout accounts in Host -> Payments.
- **Sample data**: 14 sample listings (2 per category) owned by `sample-host@travelapp.invalid`. Delete them before launch: `delete from auth.users where email='sample-host@travelapp.invalid';`

## Database SQL
`supabase/schema.sql` is the full database (tables, rules, functions, storage buckets, starter vehicles and payout methods). Your connected project already has it. To use it on a new project, paste it into Supabase -> SQL Editor and run it, then change the two values in `.env`.
Windows + very new Node versions: if `npx expo start` fails with ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING, run `set NODE_OPTIONS=--no-experimental-strip-types` first, or use Node 20 LTS.

## Version 3 (this zip)
Guest browsing (login only for booking, contact, trips, notifications, profile and hosting), saved places (bookmark), share, download booking as PDF,
safe-area header with notification bell on every screen, category grid with icons, searchable suggestions (recent / most searched / locations / places),
top rated near you (GPS) or in your country, fixed Book now bar, per-day opening hours, amenities list, facilities and activities with photo + details, admin-managed countries.

### Install into your existing working folder (recommended)
Copy `App.js`, `src/`, `supabase/`, `app.json` and `.env` from this zip over your folder. Keep your own `package.json` and `node_modules`, then run:
```
npx expo install expo-print expo-sharing @expo/vector-icons expo-file-system
npx expo start -c
```
### Fresh install (new folder)
```
npm install
npx expo install --fix
npx expo start
```

## Version 4
Menu drawer, restyled profile, airports (admin), app-calculated distance with map routes, map pickers, per-item booking times, pay later, host ID verification, inquiries, reminders,
bundled category images (no external links).
Extra packages: `npx expo install expo-print expo-sharing @expo/vector-icons expo-file-system`
Pending bookings create an in-app notification and queue an email telling the guest how to finish payment. Deploy `supabase/functions/send-emails` with
`supabase functions deploy send-emails --no-verify-jwt`, then set the Supabase secrets `RESEND_API_KEY`, `EMAIL_FROM` (a verified Resend sender),
and `EMAIL_CRON_SECRET`. Schedule a POST to `/functions/v1/send-emails` every 5 minutes with
`Authorization: Bearer <EMAIL_CRON_SECRET>`. Run `supabase/app-update-9.sql` in the SQL Editor to enable the queue and booking notification trigger.

## Version 5
Terms & privacy are managed in Admin -> Legal (realtravo.com page address and/or pasted text). Users must tick the box to sign in or create an account,
and must confirm again whenever the admin publishes a new version. Payments: Paystack only.

## Version 6
RealTravo logo images (assets/logo.png, logo-mark.png, icon.png, splash.png), white headers without page names, search bar that scrolls away (search icon appears in the header),
top rated per category, host name on listings, phone field with country dial codes, cities + region on map for hosts, chat opens when a booking is paid, password change,
host subscription paid with an M-Pesa prompt (set MPESA_* secrets), bookings paid with Paystack.

## Version 7
App name RealTravo. Coloured category icons, Pager only when needed ("See more"), red bell badge (live), paid bookings cannot be cancelled and unpaid ones only until 6 h before,
unpaid bookings kept 5 h (admin setting), bookings must fit open days / hours / event date, TRA certificate is a photo, crash-proof config (app.json extra), error screen, eas.json.
Build an installable Android file: `npx eas build -p android --profile preview`

## Version 8
Sign-up with full details, Google account chooser inside the app (needs the Google Sign-In native module + a development/installed build), change email with a code,
legal-document uploads, host earnings (platform deduction + balance), booking-form plans (M-Pesa) and forms, per-category charges, guide/activity/event/Airbnb hosted the same way,
pickup place and time for guided trips and activities, host cancellation requests.
Google sign-in setup: create a Web client ID in Google Cloud, add it to Supabase > Auth > Providers > Google (enable "Skip nonce check"), put it in .env as EXPO_PUBLIC_GOOGLE_CLIENT_ID, and register your Android SHA-1.
Change-email codes: Supabase > Auth > Email Templates > "Change email address" must contain {{ .Token }}.

## If the installed app closes right after opening
1. `npx expo install --fix` then `npx expo-doctor` (all checks must pass) BEFORE building. package.json uses "*" for many packages; --fix replaces them with the exact versions for your Expo SDK. Native packages with the wrong version crash an installed build.
2. Rebuild: `npx eas build -p android --profile preview` and install the new file (uninstall the old one first).
3. Still closing? Phone connected with USB debugging: `adb logcat -d *:E` right after the crash and send the lines with FATAL EXCEPTION.
The in-app Google account chooser is OFF by default (see src/lib/googleNative.real.js) so no extra native module can affect startup.

## Google keys (Maps, Places, Directions)
Maps need a key BUILT INTO the app. In app.json put the same key in three places, then rebuild:
  expo.android.config.googleMaps.apiKey, expo.ios.config.googleMapsApiKey, expo.extra.googleKey
(and EXPO_PUBLIC_GOOGLE_PLACES_KEY in .env). In Google Cloud enable: Maps SDK for Android, Places API, Directions API.
Without a key the app shows "Map not available yet" instead of crashing.

## Version 10
Maps work without a Google key (OpenStreetMap), real road routes (Google if a key exists, else OpenStreetMap), big opening logo with the theme line, styled location prompt,
admin-announced app updates (needs the SQL in README-update.sql), app.json has no `splash` field (not allowed by this Expo version).
IMPORTANT: keep the project OUTSIDE OneDrive (e.g. C:\dev\realtravo). OneDrive placeholder files break Metro ("EINVAL readlink").

## Version 11
Activities and guides: ongoing, activity with an end date, tour/trip with start and end date, or one-time date and time. Admin Listings tab: filter by status and open every detail of any listing.

## Building an installable APK (Windows)
Use the EAS cloud build (no Windows path-length problems, no 40-minute downloads):
  1. delete the local `android` folder if it exists (rmdir /s /q android)
  2. npx expo install --fix   then   npx expo-doctor
  3. npx eas build -p android --profile preview      (open the link on the phone, uninstall the old app first)
Local build on Windows: keep the project in a SHORT folder such as C:\rt (not Downloads\...), enable long paths, delete android\.cxx and android\app\build, and build one CPU type only: add reactNativeArchitectures=arm64-v8a to android\gradle.properties.
