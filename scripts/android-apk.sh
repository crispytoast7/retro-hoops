#!/bin/bash
# Build the Android app as one installable file: android/Retro-Hoops.apk
# Usage: npm run android:apk            build the file
#        npm run android:device         build it and install it on the Android phone plugged into this computer
# Needs: Java 21 and the Android SDK (on a Mac: brew install --cask temurin@21 android-commandlinetools, then
#        sdkmanager --licenses and sdkmanager "platform-tools" "platforms;android-36"; the build fetches the rest).
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${JAVA_HOME:-}" ] && [ -x /usr/libexec/java_home ]; then JAVA_HOME="$(/usr/libexec/java_home -v 21 2>/dev/null || true)"; export JAVA_HOME; fi
if [ -z "${ANDROID_HOME:-}" ]; then
  for d in "$HOME/Library/Android/sdk" /opt/homebrew/share/android-commandlinetools /usr/local/share/android-commandlinetools "$HOME/Android/Sdk"; do
    if [ -d "$d/platforms" ]; then ANDROID_HOME="$d"; break; fi
  done
fi
if [ -z "${ANDROID_HOME:-}" ]; then echo "No Android SDK found. See the top of scripts/android-apk.sh for what to install."; exit 1; fi
export ANDROID_HOME

# The signing key: made once, kept in your home folder, never in the repo. Every update must be signed with
# the same key or phones refuse to install it over the old one, so keep a copy of this folder somewhere safe.
KEYDIR="$HOME/.retro-hoops"
PROPS="${RETRO_HOOPS_KEY_PROPS:-$KEYDIR/android-key.properties}"
if [ ! -f "$PROPS" ]; then
  echo "Creating the app's signing key in $KEYDIR (first run only)..."
  mkdir -p "$KEYDIR"; chmod 700 "$KEYDIR"
  PASS="$(openssl rand -hex 24)"
  "${JAVA_HOME:+$JAVA_HOME/bin/}keytool" -genkeypair -keystore "$KEYDIR/android.keystore" -storetype PKCS12 -alias retrohoops \
    -keyalg RSA -keysize 2048 -validity 36500 -storepass "$PASS" -keypass "$PASS" -dname "CN=Retro Hoops" >/dev/null 2>&1
  ( umask 077; printf 'storeFile=%s\nstorePassword=%s\nkeyAlias=retrohoops\nkeyPassword=%s\n' "$KEYDIR/android.keystore" "$PASS" "$PASS" > "$PROPS" )
fi

echo "Building the web app..."
npm run build >/dev/null
npx cap sync android >/dev/null

echo "Building the Android app (first run downloads the build tools and takes a few minutes)..."
( cd android && ./gradlew --quiet assembleRelease )
APK=android/app/build/outputs/apk/release/app-release.apk
if [ ! -f "$APK" ]; then echo "The build did not produce an app."; exit 1; fi
cp "$APK" android/Retro-Hoops.apk
echo "Built: $(pwd)/android/Retro-Hoops.apk ($(du -h android/Retro-Hoops.apk | cut -f1 | tr -d ' '))"

if [ "${1:-}" = "--install" ]; then
  ADB="$ANDROID_HOME/platform-tools/adb"
  if ! "$ADB" get-state >/dev/null 2>&1; then echo "No Android phone found. Plug it in, switch on USB debugging (Settings > Developer options) and allow this computer."; exit 1; fi
  echo "Installing on the phone..."
  "$ADB" install -r android/Retro-Hoops.apk
  echo "Done. Look for Retro Hoops among your apps."
fi
