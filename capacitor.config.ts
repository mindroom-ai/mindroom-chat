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
    // Let the web app own safe-area rendering instead of leaving native gutters
    // around the WKWebView that can drift from the active app theme.
    contentInset: 'never',
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
      // Keep the WKWebView below the iOS status bar/Dynamic Island so top
      // navigation controls remain visible and tappable on real devices.
      overlaysWebView: false,
      style: 'dark',
    },
  },
};

export default config;
