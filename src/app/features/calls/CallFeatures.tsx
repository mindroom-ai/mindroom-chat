import React, { useEffect } from 'react';
import { useStore } from 'jotai';
import { activeCallAtom } from './callStore';
import { IncomingCalls } from './IncomingCalls';

/**
 * Ends the call with the signed-in session: when the account signs out or switches (the shell
 * unmounts), and as far as the browser allows when the page goes away, so the membership others
 * see does not outlive the tab until it expires.
 */
function CallLifetime() {
  const store = useStore();
  useEffect(() => {
    const leave = () => {
      const active = store.get(activeCallAtom);
      if (!active) return;
      active.call.leave().catch(() => undefined);
      active.onEnded?.().catch(() => undefined);
    };
    window.addEventListener('pagehide', leave);
    return () => {
      window.removeEventListener('pagehide', leave);
      leave();
      store.set(activeCallAtom, undefined);
    };
  }, [store]);
  return null;
}

/** Account-wide call features: incoming rings and the call's lifetime. */
export function CallFeatures() {
  return (
    <>
      <CallLifetime />
      <IncomingCalls />
    </>
  );
}
