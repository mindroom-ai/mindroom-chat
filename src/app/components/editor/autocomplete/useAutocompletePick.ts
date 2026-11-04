import { type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect } from 'react';
import { useKeyDown } from '../../../hooks/useKeyDown';
import { onTabPress } from '../../../utils/keyboard';

/**
 * What an autocomplete menu shares: it tells the composer whether it has suggestions, and while
 * it has any, Tab anywhere picks the first one. Returns whether there are suggestions.
 */
export const useAutocompletePick = <T>(
  suggestions: readonly T[],
  onPick: (suggestion: T) => void,
  onSuggestionsChange?: (hasSuggestions: boolean) => void
): boolean => {
  const hasSuggestions = suggestions.length > 0;
  useEffect(() => {
    onSuggestionsChange?.(hasSuggestions);
  }, [hasSuggestions, onSuggestionsChange]);

  const pickFirst = useCallback(
    (event: KeyboardEvent) =>
      onTabPress(event, () => {
        const [first] = suggestions;
        if (first !== undefined) onPick(first);
      }),
    [suggestions, onPick]
  );
  useKeyDown(typeof window === 'undefined' || !hasSuggestions ? undefined : window, pickFirst);
  return hasSuggestions;
};

/** A suggestion row's key handler: Tab on the row picks that row instead of the first one. */
export const pickOnTab =
  (pick: () => void) =>
  (event: ReactKeyboardEvent<HTMLElement>): void =>
    onTabPress(event, () => {
      // The menu's window listener would pick the first suggestion as well.
      event.stopPropagation();
      pick();
    });
