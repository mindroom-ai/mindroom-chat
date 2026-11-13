import { Capacitor } from '@capacitor/core';
import { MINDROOM_APP_NAME } from '../../ui/branding/branding';
import { isNativeApp } from '../../native/nativeSso';

const getBlockedMicrophoneMessage = (): string => {
  const nativePlatform = isNativeApp() ? Capacitor.getPlatform() : undefined;

  if (nativePlatform === 'android') {
    return `Microphone access is blocked. Allow microphone access for ${MINDROOM_APP_NAME} in Android app settings and try again.`;
  }

  if (nativePlatform === 'ios') {
    return `Microphone access is blocked. Allow microphone access for ${MINDROOM_APP_NAME} in iPhone settings and try again.`;
  }

  return 'Microphone access is blocked. Allow microphone access for this site/app in your browser or system settings and try again.';
};

export const getMicrophoneAccessErrorMessage = (error: unknown): string => {
  const errorName =
    typeof error === 'object' && error !== null && 'name' in error && typeof error.name === 'string'
      ? error.name
      : undefined;

  if (errorName === 'NotAllowedError') {
    return getBlockedMicrophoneMessage();
  }
  if (errorName === 'NotFoundError') {
    return 'No microphone was found on this device.';
  }
  if (errorName === 'NotReadableError') {
    return 'Microphone is unavailable right now (it may be in use by another app).';
  }

  const errorMessage =
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
      ? error.message
      : undefined;

  if (errorMessage !== undefined) {
    if (/not allowed by the user agent|current context/i.test(errorMessage)) {
      return getBlockedMicrophoneMessage();
    }
    return errorMessage;
  }

  return 'Failed to access microphone.';
};
