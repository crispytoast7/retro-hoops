#!/bin/bash
# Build the native iPhone app and install it on the iPhone plugged into this Mac.
# Usage: npm run ios:device
# Needs: Xcode signed in with your Apple ID (Xcode > Settings > Accounts), the iPhone connected
# and trusted, and Developer Mode switched on (iPhone Settings > Privacy & Security).
set -euo pipefail
cd "$(dirname "$0")/.."

# The signing team comes from your keychain at run time; it is never written into the repo.
TEAM="${IOS_TEAM:-$(security find-certificate -c "Apple Development" -p 2>/dev/null | openssl x509 -noout -subject 2>/dev/null | sed -n 's/.*OU *= *\([A-Z0-9]\{10\}\).*/\1/p')}"
if [ -z "$TEAM" ]; then echo "No Apple Development certificate found. Open Xcode > Settings > Accounts, add your Apple ID, then run this again."; exit 1; fi

DEVICE="$(xcrun devicectl list devices 2>/dev/null | awk '/iPhone/ && /(connected|available)/ {for (i = 1; i <= NF; i++) if ($i ~ /^[0-9A-F]{8}-[0-9A-F]{4}-/) {print $i; exit}}')"
if [ -z "$DEVICE" ]; then echo "No iPhone found. Plug it in, unlock it, tap Trust, and make sure Developer Mode is on."; exit 1; fi

echo "Building the web app..."
npm run build >/dev/null
npx cap sync ios >/dev/null

DD="${TMPDIR:-/tmp}/retro-hoops-ios"
echo "Building the iPhone app (first run takes a few minutes)..."
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -destination "id=$DEVICE" -derivedDataPath "$DD" \
  -allowProvisioningUpdates DEVELOPMENT_TEAM="$TEAM" CODE_SIGN_STYLE=Automatic \
  ${IOS_BUNDLE_ID:+PRODUCT_BUNDLE_IDENTIFIER="$IOS_BUNDLE_ID"} build | grep -E "error:|BUILD (SUCCEEDED|FAILED)" || true

APP="$DD/Build/Products/Debug-iphoneos/App.app"
if [ ! -d "$APP" ]; then echo "The build did not produce an app. Run 'npm run ios:open' and press Run in Xcode to see the full error."; exit 1; fi
echo "Installing on the iPhone..."
xcrun devicectl device install app --device "$DEVICE" "$APP"
echo "Done. Look for Retro Hoops on the home screen."
echo "First time only: on the iPhone go to Settings > General > VPN & Device Management and trust your developer certificate."
