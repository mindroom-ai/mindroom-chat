import {
  Editor as SlateEditor,
  Element as SlateElement,
  Node as SlateNode,
  Range as SlateRange,
  Text as SlateText,
  Transforms,
  type BaseRange,
  type Editor,
} from 'slate';
import { HistoryEditor } from 'slate-history';
import { ReactEditor } from 'slate-react';
import { startsWithGluedPunctuation } from './stitchTranscript';

const OPENING_NO_SPACE = /[([{"']$/;

const isValidPoint = (editor: Editor, point: BaseRange['anchor']): boolean => {
  if (!SlateNode.has(editor, point.path)) return false;
  const node = SlateNode.get(editor, point.path);
  return SlateText.isText(node) && point.offset >= 0 && point.offset <= node.text.length;
};

const isValidRange = (editor: Editor, range: BaseRange | null | undefined): range is BaseRange =>
  !!range && isValidPoint(editor, range.anchor) && isValidPoint(editor, range.focus);

const withSmartSpacing = (editor: Editor, text: string): string => {
  const selection = editor.selection;
  if (!selection) return text;

  const [start, end] = SlateRange.edges(selection);
  const blockEntry = SlateEditor.above(editor, {
    at: start,
    match: (node) => SlateElement.isElement(node) && SlateEditor.isBlock(editor, node),
  });
  if (!blockEntry) return text;
  const [, blockPath] = blockEntry;

  const beforeText = SlateEditor.string(editor, {
    anchor: SlateEditor.start(editor, blockPath),
    focus: start,
  });
  const afterText = SlateEditor.string(editor, {
    anchor: end,
    focus: SlateEditor.end(editor, blockPath),
  });

  const charBefore = beforeText.slice(-1);
  const charAfter = afterText.slice(0, 1);

  const needsLeadingSpace =
    charBefore !== '' &&
    !/\s/.test(charBefore) &&
    !OPENING_NO_SPACE.test(charBefore) &&
    !startsWithGluedPunctuation(text);

  const needsTrailingSpace =
    charAfter !== '' &&
    !/\s/.test(charAfter) &&
    !startsWithGluedPunctuation(charAfter) &&
    !/\s$/.test(text);

  return `${needsLeadingSpace ? ' ' : ''}${text}${needsTrailingSpace ? ' ' : ''}`;
};

/**
 * Inserts transcribed dictation text atomically as a single undo step at `savedSelection` (or
 * the current selection / end of document), preserving smart leading and trailing spacing.
 */
export const insertDictatedText = (
  editor: Editor,
  rawText: string,
  savedSelection?: BaseRange | null
): boolean => {
  const trimmed = rawText.trim();
  if (!trimmed) return false;

  if (isValidRange(editor, savedSelection)) {
    Transforms.select(editor, savedSelection);
  } else if (!editor.selection) {
    Transforms.select(editor, SlateEditor.end(editor, []));
  }

  const formatted = withSmartSpacing(editor, trimmed);
  const run = () => {
    SlateEditor.insertText(editor, formatted);
  };

  if (HistoryEditor.isHistoryEditor(editor)) {
    HistoryEditor.withoutMerging(editor, run);
  } else {
    run();
  }

  try {
    ReactEditor.focus(editor);
  } catch {
    // Editor may not be attached to a DOM tree in headless unit tests.
  }
  return true;
};
