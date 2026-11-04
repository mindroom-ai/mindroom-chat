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

type Answer = { support: Exclude<CallSupport, 'checking'>; at: number };

/**
 * The newest answer for each client, so a component that mounts again (the header of the next
 * room) starts from it instead of hiding its call controls while it asks.
 */
const answers = new WeakMap<MatrixClient, Answer>();

/** How long a deployment without a call service is believed before it is asked again. */
const ASK_AGAIN_AFTER_MS = 60_000;

/** Whether the account's deployment announces a call backend. */
export const useCallSupport = (mx: MatrixClient): CallSupport => {
  const [support, setSupport] = useState<CallSupport>(() => answers.get(mx)?.support ?? 'checking');
  useEffect(() => {
    let active = true;
    const known = answers.get(mx);
    setSupport(known?.support ?? 'checking');
    // A found service is kept for the client's life (`getLivekitServiceUrl`); a missing one is
    // looked for again only now and then, not on every room the header shows.
    if (known?.support === 'unsupported' && Date.now() - known.at < ASK_AGAIN_AFTER_MS) {
      return undefined;
    }
    void getLivekitServiceUrl(mx).then((url) => {
      const answer: Answer = { support: url ? 'supported' : 'unsupported', at: Date.now() };
      answers.set(mx, answer);
      if (active) setSupport(answer.support);
    });
    return () => {
      active = false;
    };
  }, [mx]);
  return support;
};
