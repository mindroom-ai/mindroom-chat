const pkg = require('../package.json');

const marketingVersion = (process.env.MARKETING_VERSION || '').trim();
const sign = process.env.MINDROOM_DESKTOP_SIGN === '1';

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'chat.mindroom.app',
  productName: 'MindRoom Chat',
  afterPack: 'electron/afterPack.cjs',
  asar: true,
  npmRebuild: false,
  electronVersion: pkg.devDependencies.electron,
  ...(marketingVersion ? { buildVersion: marketingVersion } : {}),
  // Always set productName in packaged package.json so Electron derives app.getName()
  // and the userData profile folder as "MindRoom Chat" (not "mindroom-client").
  extraMetadata: {
    productName: 'MindRoom Chat',
    desktopName: 'mindroom-chat.desktop',
    ...(marketingVersion ? { version: marketingVersion } : {}),
  },
  directories: {
    output: 'build/desktop-dist',
  },
  // Use the static-pie AppImage runtime (1.0.3) instead of the legacy FUSE2 runtime (0.0.0),
  // whose arm64 binary links against unversioned libz.so (absent on Ubuntu 24.04 without zlib1g-dev)
  // and requires libfuse2.
  toolsets: {
    appimage: '1.0.3',
  },
  // Main and preload are self-contained esbuild bundles with only 'electron' external,
  // so no node_modules need to be packed into app.asar.
  files: [
    'build/electron/**/*',
    '!build/electron/mindroom-screenshot-helper',
    '!build/electron/mindroom-trackpad-swipe.node',
    '!build/electron/MindRoom Desktop Helper.app/**',
    'dist/**/*',
    'package.json',
    '!node_modules/**/*',
  ],
  mac: {
    // electron-builder 26.18.0 rejects a top-level `zip` key in schema validation;
    // zip targets inherit mac.artifactName while dmg overrides it below.
    artifactName: 'MindRoom-Chat-${arch}-mac.${ext}',
    ...(marketingVersion
      ? {
          bundleShortVersion: marketingVersion,
          bundleVersion: marketingVersion,
        }
      : {}),
    hardenedRuntime: true,
    gatekeeperAssess: false,
    forceCodeSigning: sign,
    entitlements: 'electron/entitlements.mac.plist',
    entitlementsInherit: 'electron/entitlements.helper.plist',
    // Preserve the pre-signed, notarized PyInstaller helper signature and entitlements.
    signIgnore: ['Contents/Helpers/MindRoom Desktop Helper\\.app(/|$)'],
    icon: 'ios/App/App/Assets.xcassets/AppIcon.appiconset/Icon-Mac-512x512@2x.png',
    category: 'public.app-category.social-networking',
    notarize: sign,
    extraResources: [
      { from: 'build/electron/mindroom-screenshot-helper', to: 'mindroom-screenshot-helper' },
      { from: 'build/electron/mindroom-trackpad-swipe.node', to: 'mindroom-trackpad-swipe.node' },
    ],
    target: [
      { target: 'dmg', arch: ['universal'] },
      { target: 'zip', arch: ['arm64', 'x64'] },
    ],
    extendInfo: {
      NSMicrophoneUsageDescription:
        'MindRoom needs microphone access to record voice messages and talk in voice calls.',
      NSCameraUsageDescription:
        'MindRoom needs camera access to capture photos and videos to send in chats.',
      NSLocalNetworkUsageDescription: 'MindRoom needs to connect to your local Matrix homeserver.',
      NSAudioCaptureUsageDescription:
        'MindRoom needs audio capture access to share system audio during screen sharing.',
      NSAppleEventsUsageDescription:
        'MindRoom controls only the applications you explicitly allow.',
      ITSAppUsesNonExemptEncryption: false,
    },
    publish: {
      provider: 'generic',
      url: 'https://github.com/mindroom-ai/mindroom-chat/releases/download/mac-feed',
      useMultipleRangeRequest: false,
    },
  },
  dmg: {
    artifactName: 'MindRoom-Chat.dmg',
    title: 'MindRoom Chat',
    background: 'scripts/macos-dmg/background.png',
    window: { width: 660, height: 400 },
    iconSize: 128,
    // Signing and stapling the DMG happens after electron-builder packs it, so do not emit
    // a pre-signature DMG blockmap; macOS updates use the ZIP blockmaps only.
    writeUpdateInfo: false,
    contents: [
      { x: 180, y: 160 },
      { x: 480, y: 160, type: 'link', path: '/Applications' },
    ],
  },
  linux: {
    executableName: 'mindroom-chat',
    icon: 'ios/App/App/Assets.xcassets/AppIcon.appiconset/Icon-Mac-512x512@2x.png',
    category: 'Network',
    maintainer: 'MindRoom <support@mindroom.chat>',
    vendor: 'MindRoom',
    desktop: {
      entry: {
        Name: 'MindRoom Chat',
        Comment: 'Open-source Matrix client for MindRoom',
        Categories: 'Network;InstantMessaging;Chat;',
        StartupWMClass: 'mindroom-chat',
      },
    },
    target: ['AppImage', 'deb'],
    publish: {
      provider: 'generic',
      url: 'https://github.com/mindroom-ai/mindroom-chat/releases/download/linux-feed',
      useMultipleRangeRequest: false,
    },
  },
  appImage: {
    artifactName: 'MindRoom-Chat-${arch}.AppImage',
    // Do not hardcode --no-sandbox in the AppImage .desktop entry; keep Chromium's
    // sandbox enabled wherever unprivileged user namespaces are available.
    executableArgs: [],
  },
  deb: {
    packageName: 'mindroom-chat',
    artifactName: 'MindRoom-Chat-${arch}.deb',
  },
  electronFuses: {
    runAsNode: false,
    enableCookieEncryption: true,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    grantFileProtocolExtraPrivileges: false,
    resetAdHocDarwinSignature: !sign,
  },
};
