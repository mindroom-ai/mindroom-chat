import { useCallback } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import { useKeyDown } from '../../lib/hooks/useKeyDown';
import { useComposingCheck } from '../../lib/hooks/useComposingCheck';
import { settingsAtom } from '../../preferences/settings';
import { useSettingValue } from '../../preferences/useSettingValue';
import { commandPaletteOpenAtom } from '../../command-palette/commandPaletteState';
import { computerOwnsKeyboardEvent, computerOwnsKeyboardFocus } from '../../computer/computerFocus';
import { ShortcutHelpDialog } from './ShortcutHelpDialog';
import { ShortcutHints, useShortcutHintHold } from './ShortcutHints';
import { openOverlay } from '../../shortcuts/shortcutDom';
import { shortcutHelpOpenAtom } from '../../navigation/shortcutHelpState';
import { SHORTCUTS, findShortcut, usesCommandKey } from '../../shortcuts/shortcuts';
import { hasShortcutHandler, runShortcut, useShortcut } from '../../shortcuts/useShortcut';

/**
 * The one window listener for the app's keyboard shortcuts, after every focused widget has had
 * the key; the help dialog (⌘/ or Ctrl+/); and the hints that holding ⌘ or Ctrl shows.
 */
export function ShortcutRoot() {
  const composing = useComposingCheck();
  const [helpOpen, setHelpOpen] = useAtom(shortcutHelpOpenAtom);
  const openPalette = useSetAtom(commandPaletteOpenAtom);
  const hintsEnabled = useSettingValue(settingsAtom, 'shortcutHints');
  const hintsShown = useShortcutHintHold(hintsEnabled);
  const closeHelp = useCallback(() => setHelpOpen(false), [setHelpOpen]);

  useShortcut('help', () => {
    setHelpOpen((open) => !open);
    return true;
  });
  // The palette on its Messages tab.
  useShortcut('messageSearch', () => {
    openPalette('messages');
    return true;
  });

  useKeyDown(
    window,
    useCallback(
      (event: KeyboardEvent) => {
        const id = findShortcut(event, {
          apple: usesCommandKey(),
          composing: composing(event),
          computer: computerOwnsKeyboardEvent(event) || computerOwnsKeyboardFocus(),
          overlay: openOverlay(),
          registered: hasShortcutHandler,
        });
        if (!id) return;
        // Holding a toggle's keys acts once; the browser keeps none of them either.
        if (event.repeat && !SHORTCUTS[id].repeats) {
          event.preventDefault();
          return;
        }
        if (runShortcut(id, event)) event.preventDefault();
      },
      [composing]
    )
  );

  return (
    <>
      {helpOpen && <ShortcutHelpDialog onClose={closeHelp} />}
      {hintsShown && <ShortcutHints />}
    </>
  );
}
