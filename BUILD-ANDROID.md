# Building the APK on Windows
Your build failed with: ninja: error: Filename longer than 260 characters
(react-native-safe-area-context native files). Nothing is wrong with the app code (the JS bundle built fine).

1. Move the project to a SHORT folder, e.g. C:\ta  (not Downloads\travelapp-update\travelapp).
2. Run fix-android-build.ps1 in PowerShell as Administrator (enables Windows long paths, builds only arm64, cleans old build folders).
3. Reboot once, then:  cd C:\ta\android   then   .\gradlew.bat assembleRelease
4. APK: android\app\build\outputs\apk\release\app-release.apk

If the installed APK crashes on the phone, connect it with USB debugging and run:
  adb logcat -c
  adb logcat *:E | findstr /i "FATAL AndroidRuntime ReactNativeJS"
and open the app. Send me those lines.
