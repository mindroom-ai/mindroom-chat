import { ReactNode } from 'react';
import { useAtomValue } from 'jotai';
import { createPortal } from 'react-dom';
import { ScreenSize, useScreenSizeContext } from '../lib/hooks/useScreenSize';
import { phoneNavSlotAtom } from '../navigation/phoneNavDrawer';

/**
 * A section's navigation list: beside the page on wider screens, in the navigation drawer on
 * phones, where it is portaled into the drawer's slot (keeping the section's React context).
 */
export function MobileFriendlyPageNav({ children }: { children: ReactNode }) {
  const onPhone = useScreenSizeContext() === ScreenSize.Mobile;
  const slot = useAtomValue(phoneNavSlotAtom);
  if (!onPhone) return <>{children}</>;
  return slot ? createPortal(children, slot) : null;
}
