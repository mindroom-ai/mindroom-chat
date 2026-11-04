import { useEffect, useState } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';
import { getLivekitServiceUrl } from './rtcFocus';

/** Whether this browser can place calls at all. */
export const browserSupportsCalls = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.RTCPeerConnection === 'function' &&
  !!navigator.mediaDevices?.getUserMedia;

/** Whether this browser can share a screen; phone browsers cannot. */
export const browserSharesScreens = (): boolean =>
  typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function';

export type CallSupport = 'checking' | 'supported' | 'unsupported';

/** Whether the account's deployment announces a call backend. */
export const useCallSupport = (mx: MatrixClient): CallSupport => {
  const [support, setSupport] = useState<CallSupport>('checking');
  useEffect(() => {
    let active = true;
    getLivekitServiceUrl(mx).then((url) => {
      if (active) setSupport(url ? 'supported' : 'unsupported');
    });
    return () => {
      active = false;
    };
  }, [mx]);
  return support;
};
