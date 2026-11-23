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
import { needsSpaceBetween } from './stitchTranscript';

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
  const isBlock = (node: SlateNode) =>
    SlateElement.isElement(node) && SlateEditor.isBlock(editor, node);
  const startBlock = SlateEditor.above(editor, { at: start, match: isBlock });
  const endBlock = SlateEditor.above(editor, { at: end, match: isBlock });
  if (!startBlock || !endBlock) return text;

  const beforeText = SlateEditor.string(editor, {
    anchor: SlateEditor.start(editor, startBlock[1]),
    focus: start,
  });
  const afterText = SlateEditor.string(editor, {
    anchor: end,
    focus: SlateEditor.end(editor, endBlock[1]),
  });

  const leadingSpace = needsSpaceBetween(beforeText, text) ? ' ' : '';
  const trailingSpace = needsSpaceBetween(text, afterText) ? ' ' : '';
  return `${leadingSpace}${text}${trailingSpace}`;
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
    // Starts a fresh undo batch and merges replacement delete + insert into one undo step.
    HistoryEditor.withNewBatch(editor, run);
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
