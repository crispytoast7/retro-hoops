import type { CapacitorConfig } from '@capacitor/cli';

// Native iPhone and Android shells around the same web build (dist/). See README: "iPhone app", "Android app".
const config: CapacitorConfig = {
  appId: 'app.retrohoops.game',
  appName: 'Retro Hoops',
  webDir: 'dist',
  backgroundColor: '#14121f',
  ios: {
    contentInset: 'never',
    scrollEnabled: false,
    backgroundColor: '#14121f',
  },
  android: {
    backgroundColor: '#14121f',
  },
  plugins: {
    // light clock and battery icons over the game's dark background, on both phones
    SystemBars: { style: 'DARK', initialViewportFitValueHint: 'cover' },
  },
};

export default config;
