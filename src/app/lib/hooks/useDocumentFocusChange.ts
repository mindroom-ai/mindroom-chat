import { useEffect } from 'react';
import { desktopBridge, isAppWindowFocused } from '../nativeShell';

/** Calls `onChange(true)` when the window gains focus and `onChange(false)` when it loses it. */
export const useDocumentFocusChange = (onChange: (inFocus: boolean) => void): void => {
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleFocus = () => onChange(isAppWindowFocused());
    const handleBlur = () => onChange(false);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);
    const stopShellEvents = desktopBridge()?.onShellEvent((event) => {
      if (event.type !== 'window-focus') return;
      onChange(event.focused ? isAppWindowFocused() : false);
    });
    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
      stopShellEvents?.();
    };
  }, [onChange]);
};
