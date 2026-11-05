import { useCallback, useEffect, useRef } from 'react';

// Safari fires the Enter keydown that ends an IME composition after `compositionend`.
const COMPOSITION_END_GRACE_MS = 50;

/**
 * A function telling whether an IME composition is running (or just ended), so Enter that
 * confirms a composed character does not also send the message.
 */
export const useComposingCheck = (): ((event?: { isComposing?: boolean }) => boolean) => {
  const composingRef = useRef(false);
  const endedAtRef = useRef(0);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleStart = () => {
      composingRef.current = true;
    };
    const handleEnd = () => {
      composingRef.current = false;
      endedAtRef.current = Date.now();
    };
    window.addEventListener('compositionstart', handleStart, true);
    window.addEventListener('compositionend', handleEnd, true);
    return () => {
      window.removeEventListener('compositionstart', handleStart, true);
      window.removeEventListener('compositionend', handleEnd, true);
    };
  }, []);

  return useCallback(
    (event) =>
      event?.isComposing === true ||
      composingRef.current ||
      Date.now() - endedAtRef.current < COMPOSITION_END_GRACE_MS,
    []
  );
};
