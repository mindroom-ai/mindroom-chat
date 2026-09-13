import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.mindroom.app',
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
      resize: 'body',
      resizeOnFullScreen: true,
    },
    StatusBar: {
      style: 'dark',
    },
  },
};

export default config;
