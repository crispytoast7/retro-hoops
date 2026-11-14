import type { CapacitorConfig } from '@capacitor/cli';

// Native iPhone shell around the same web build (dist/). See README: "iPhone app".
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
};

export default config;
