import { Capacitor } from '@capacitor/core';
import { isNativeApp } from '../native/nativeSso';

const getBlockedMicrophoneMessage = (): string => {
  const nativePlatform = isNativeApp() ? Capacitor.getPlatform() : undefined;

  if (nativePlatform === 'android') {
    return 'Microphone access is blocked. Allow microphone access for MindRoom in Android app settings and try again.';
  }

  if (nativePlatform === 'ios') {
    return 'Microphone access is blocked. Allow microphone access for MindRoom in iPhone settings and try again.';
  }

  return 'Microphone access is blocked. Allow microphone access for this site/app in your browser or system settings and try again.';
};

export const getMicrophoneAccessErrorMessage = (error: unknown): string => {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') {
      return getBlockedMicrophoneMessage();
    }
    if (error.name === 'NotFoundError') {
      return 'No microphone was found on this device.';
    }
    if (error.name === 'NotReadableError') {
      return 'Microphone is unavailable right now (it may be in use by another app).';
    }
  }

  if (error instanceof Error) {
    if (/not allowed by the user agent|current context/i.test(error.message)) {
      return getBlockedMicrophoneMessage();
    }
    return error.message;
  }

  return 'Failed to access microphone.';
};

/**
 * Request microphone access in the top-level app before an embedded call is
 * created. In WKWebView this makes the native permission prompt happen as a
 * direct consequence of the user's Call tap instead of later in the hidden
 * Element Call iframe. The short-lived stream is only a permission preflight;
 * Element Call opens the stream it publishes to the call.
 */
export const requestMicrophoneAccess = async (): Promise<void> => {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microphone access is not supported on this device.');
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
  } catch (error) {
    throw new Error(getMicrophoneAccessErrorMessage(error));
  }
};
