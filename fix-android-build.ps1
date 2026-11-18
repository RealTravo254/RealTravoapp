# Run in PowerShell AS ADMINISTRATOR, from the project root (use a SHORT folder such as C:\ta).
$ErrorActionPreference = 'Stop'
New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force | Out-Null
Write-Host "1/3 Windows long paths enabled."

$gp = "android\gradle.properties"
if (Test-Path $gp) {
  $t = Get-Content $gp
  if ($t -match '^reactNativeArchitectures=') { $t = $t -replace '^reactNativeArchitectures=.*', 'reactNativeArchitectures=arm64-v8a' } else { $t += 'reactNativeArchitectures=arm64-v8a' }
  Set-Content $gp $t
  Write-Host "2/3 Building only arm64-v8a (phones). Much faster than 4 CPU types."
} else { Write-Host "2/3 android\gradle.properties not found (run: npx expo prebuild --platform android)" }

if (Test-Path "android\gradlew.bat") { Push-Location android; .\gradlew.bat --stop; Pop-Location }
foreach ($d in 'android\app\.cxx', 'android\app\build', 'android\build') { if (Test-Path $d) { cmd /c rmdir /s /q "$d" } }
Write-Host "3/3 Old native build folders removed."
Write-Host "NOW: close Android Studio and all terminals, REBOOT once, then run:  cd android ; .\gradlew.bat assembleRelease"
