import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.mindroom-ai.app',
  appName: 'MindRoom',
  webDir: 'dist',
  server: {
    // Allow connecting to local homeserver over HTTP
    cleartext: true,
    // Allow mixed content (HTTPS app talking to HTTP homeserver)
    androidScheme: 'https',
    iosScheme: 'https',
  },
  ios: {
    contentInset: 'automatic',
    preferredContentMode: 'mobile',
    // Allow arbitrary loads for local network homeservers
    allowsLinkPreview: true,
  },
  plugins: {
    Keyboard: {
      // Use native WebView resizing on iOS so the composer stays above the keyboard
      // (including the predictive/autocorrect suggestion bar) on real devices.
      resize: 'native',
      resizeOnFullScreen: true,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    StatusBar: {
      style: 'dark',
    },
  },
};

export default config;
