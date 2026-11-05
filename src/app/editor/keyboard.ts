import { KeyboardEvent } from 'react';
import isHotkey from 'is-hotkey';
import { Editor } from 'slate';
import { MarkType } from './types';

/**
 * Formatting shortcuts. Mod+1 to Mod+9 stay with the browser (tab switching), so no shortcut
 * here uses a digit.
 */
const MARK_HOTKEYS: ReadonlyArray<[hotkey: string, mark: MarkType]> = [
  ['mod+b', MarkType.Bold],
  ['mod+i', MarkType.Italic],
  ['mod+u', MarkType.Underline],
  ['mod+shift+x', MarkType.StrikeThrough],
  ['mod+e', MarkType.Code],
  ['mod+shift+h', MarkType.Spoiler],
];

/** Whether the mark is on at the caret or across the selection. */
export const isMarkActive = (editor: Editor, mark: MarkType): boolean =>
  Editor.marks(editor)?.[mark] === true;

/** Turns the mark on for the selection (or the next typed text), or off when it already is. */
export const toggleMark = (editor: Editor, mark: MarkType): void => {
  if (isMarkActive(editor, mark)) {
    Editor.removeMark(editor, mark);
    return;
  }
  Editor.addMark(editor, mark, true);
};

/**
 * Applies the formatting shortcut the key event stands for. Returns whether it handled the
 * event; unhandled events keep their default browser behavior.
 */
export const toggleKeyboardShortcut = (editor: Editor, event: KeyboardEvent<Element>): boolean => {
  // is-hotkey reads the same key fields React's synthetic event carries.
  const keyEvent = event as unknown as globalThis.KeyboardEvent;
  const match = MARK_HOTKEYS.find(([hotkey]) => isHotkey(hotkey, keyEvent));
  if (!match) return false;
  event.preventDefault();
  toggleMark(editor, match[1]);
  return true;
};
