import type { CapacitorConfig } from '@capacitor/cli';

// Native shells (iOS, Android) load the production build from `dist/`.
const capacitorConfig: CapacitorConfig = {
  appId: 'chat.mindroom.app',
  appName: 'MindRoom Chat',
  webDir: 'dist',
  ios: {
    // iPhone and iPad get the mobile layout; Mac Catalyst asks for the desktop one natively.
    preferredContentMode: 'mobile',
  },
  plugins: {
    StatusBar: {
      // The web view starts below the status bar on Android too, the inset iOS already applies.
      overlaysWebView: false,
      // The default app background, so the bar does not stand out before the theme loads.
      backgroundColor: '#1A1A1A',
    },
  },
};

export default capacitorConfig;
