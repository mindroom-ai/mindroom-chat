import { Suspense, lazy, useCallback, useState } from 'react';
import { useAtomValue } from 'jotai';
import { incomingPairInviteAtom } from './incomingPairInviteAtom';

const LazyIncomingPairInviteModalDialog = lazy(() =>
  import('./IncomingPairInviteModalDialog').then((mod) => ({
    default: mod.IncomingPairInviteModalDialog,
  }))
);

/**
 * Tiny shell wrapper that watches `incomingPairInviteAtom` and lazy-loads the Mac consent dialog
 * only when a verified browser pairing invite arrives.
 */
export function IncomingPairInviteModal() {
  const incoming = useAtomValue(incomingPairInviteAtom);
  const [mounted, setMounted] = useState(incoming !== null);
  if (incoming !== null && !mounted) {
    setMounted(true);
  }
  const handleDismiss = useCallback(() => setMounted(false), []);
  if (!mounted) return null;
  return (
    <Suspense fallback={null}>
      <LazyIncomingPairInviteModalDialog onDismiss={handleDismiss} />
    </Suspense>
  );
}
