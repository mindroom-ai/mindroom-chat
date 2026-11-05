import { useEffect } from 'react';

/** Calls `onChange(true)` when the window gains focus and `onChange(false)` when it loses it. */
export const useDocumentFocusChange = (onChange: (inFocus: boolean) => void): void => {
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleFocus = () => onChange(true);
    const handleBlur = () => onChange(false);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
    };
  }, [onChange]);
};
