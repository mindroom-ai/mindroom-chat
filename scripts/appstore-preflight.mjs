#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const configPath = path.join(repoRoot, 'config.json');
const infoPlistPath = path.join(repoRoot, 'ios', 'App', 'App', 'Info.plist');
const appIconDir = path.join(
  repoRoot,
  'ios',
  'App',
  'App',
  'Assets.xcassets',
  'AppIcon.appiconset'
);
const appIconContentsPath = path.join(appIconDir, 'Contents.json');

const failures = [];

const readText = (filePath) => fs.readFileSync(filePath, 'utf8');

const check = (condition, message) => {
  if (!condition) failures.push(message);
};

const config = JSON.parse(readText(configPath));
const infoPlist = readText(infoPlistPath);
const appIconContents = JSON.parse(readText(appIconContentsPath));

const authConfig = config.auth ?? {};
const isHttpsUrl = (value) => {
  if (typeof value !== 'string' || value.trim().length === 0) return false;

  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

check(authConfig.allowRegistration === true, 'config.json: auth.allowRegistration must be true.');
check(
  authConfig.requireAppleProvider === true,
  'config.json: auth.requireAppleProvider must be true.'
);
check(
  isHttpsUrl(authConfig.supportUrl),
  'config.json: auth.supportUrl must be a public HTTPS URL.'
);
check(
  isHttpsUrl(authConfig.privacyPolicyUrl),
  'config.json: auth.privacyPolicyUrl must be a public HTTPS URL.'
);
check(isHttpsUrl(authConfig.termsUrl), 'config.json: auth.termsUrl must be a public HTTPS URL.');

const requiredPlistKeys = [
  'ITSAppUsesNonExemptEncryption',
  'NSAppTransportSecurity',
  'NSAllowsLocalNetworking',
  'NSLocalNetworkUsageDescription',
  'NSMicrophoneUsageDescription',
  'NSCameraUsageDescription',
  'NSPhotoLibraryUsageDescription',
  'NSPhotoLibraryAddUsageDescription',
];

requiredPlistKeys.forEach((key) => {
  check(infoPlist.includes(`<key>${key}</key>`), `Info.plist: missing key ${key}.`);
});

check(
  !infoPlist.includes('<key>NSAllowsArbitraryLoads</key>'),
  'Info.plist: NSAllowsArbitraryLoads should not be present.'
);

check(
  infoPlist.includes('<string>arm64</string>'),
  'Info.plist: arm64 device capability should be declared.'
);

const iconImages = Array.isArray(appIconContents.images) ? appIconContents.images : [];
check(iconImages.length > 0, 'AppIcon Contents.json: images array is empty.');

const requiredIconFilenames = [
  'AppIcon-1024.png',
  'Icon-App-20x20@2x.png',
  'Icon-App-20x20@3x.png',
  'Icon-App-29x29@2x.png',
  'Icon-App-29x29@3x.png',
  'Icon-App-40x40@2x.png',
  'Icon-App-40x40@3x.png',
  'Icon-App-60x60@2x.png',
  'Icon-App-60x60@3x.png',
  'Icon-App-20x20@1x~ipad.png',
  'Icon-App-20x20@2x~ipad.png',
  'Icon-App-29x29@1x~ipad.png',
  'Icon-App-29x29@2x~ipad.png',
  'Icon-App-40x40@1x~ipad.png',
  'Icon-App-40x40@2x~ipad.png',
  'Icon-App-76x76@1x~ipad.png',
  'Icon-App-76x76@2x~ipad.png',
  'Icon-App-83.5x83.5@2x~ipad.png',
];

const iconFilenameSet = new Set(
  iconImages
    .map((image) => (typeof image?.filename === 'string' ? image.filename : ''))
    .filter(Boolean)
);

requiredIconFilenames.forEach((filename) => {
  check(
    iconFilenameSet.has(filename),
    `AppIcon Contents.json: missing icon slot filename ${filename}.`
  );
  check(fs.existsSync(path.join(appIconDir, filename)), `AppIcon asset missing file ${filename}.`);
});

check(
  iconImages.some(
    (image) => image?.idiom === 'ios-marketing' && image?.filename === 'AppIcon-1024.png'
  ),
  'AppIcon Contents.json: missing ios-marketing 1024 icon entry.'
);

if (failures.length > 0) {
  console.error('App Store preflight failed:\n');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('App Store preflight passed.');
