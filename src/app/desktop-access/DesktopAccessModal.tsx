import { Suspense, lazy } from 'react';
import { useAtomValue } from 'jotai';
import { desktopAccessModalAtom } from '../navigation/desktopAccessModal';

const LazyDesktopAccessModalDialog = lazy(() =>
  import('./DesktopAccessModalDialog').then((mod) => ({
    default: mod.DesktopAccessModalDialog,
  }))
);

/**
 * Tiny shell wrapper that reads `desktopAccessModalAtom` and lazy-loads the Mac Computer Access
 * dialog chunk only when opened.
 */
export function DesktopAccessModalRenderer() {
  const request = useAtomValue(desktopAccessModalAtom);
  if (!request) return null;
  return (
    <Suspense fallback={null}>
      <LazyDesktopAccessModalDialog />
    </Suspense>
  );
}
