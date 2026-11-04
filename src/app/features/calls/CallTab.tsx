import { Suspense, lazy } from 'react';
import { useActiveCall } from './callStore';

// The tab's look loads with the first call, like the rest of the call UI.
const ActiveCallTab = lazy(() =>
  import('./ActiveCallTab').then((module) => ({ default: module.ActiveCallTab }))
);

/** The rail's way back to the call this device is in, wherever the person went meanwhile. */
export function CallTab() {
  const active = useActiveCall();
  if (!active) return null;
  return (
    <Suspense fallback={null}>
      <ActiveCallTab active={active} />
    </Suspense>
  );
}
