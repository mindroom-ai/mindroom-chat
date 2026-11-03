/** Whether this browser can place a WebRTC call with the microphone. */
export const webRTCSupported = (): boolean =>
  typeof RTCPeerConnection !== 'undefined' &&
  typeof navigator !== 'undefined' &&
  typeof navigator.mediaDevices?.getUserMedia === 'function';
