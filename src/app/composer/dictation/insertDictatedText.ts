import {
  Editor as SlateEditor,
  Element as SlateElement,
  Node as SlateNode,
  Range as SlateRange,
  Text as SlateText,
  Transforms,
  type BasePoint,
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

export type InsertDictatedTextOptions = {
  focus?: boolean;
};

const withSmartSpacing = (editor: Editor, text: string, target: BaseRange | BasePoint): string => {
  const [start, end] = SlateRange.isRange(target) ? SlateRange.edges(target) : [target, target];
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
  savedSelection?: BaseRange | null,
  options?: InsertDictatedTextOptions
): boolean => {
  const trimmed = rawText.trim();
  if (!trimmed) return false;

  const focus = options?.focus ?? false;
  const targetRange: BaseRange | BasePoint = isValidRange(editor, savedSelection)
    ? savedSelection
    : editor.selection ?? SlateEditor.end(editor, []);
  const formatted = withSmartSpacing(editor, trimmed, targetRange);

  const run = () => {
    if (focus) {
      Transforms.select(editor, targetRange);
      SlateEditor.insertText(editor, formatted);
    } else {
      Transforms.insertText(editor, formatted, { at: targetRange });
    }
  };

  if (HistoryEditor.isHistoryEditor(editor)) {
    // Starts a fresh undo batch and merges replacement delete + insert into one undo step.
    HistoryEditor.withNewBatch(editor, run);
  } else {
    run();
  }

  if (focus) {
    try {
      ReactEditor.focus(editor);
    } catch {
      // Editor may not be attached to a DOM tree in headless unit tests.
    }
  }
  return true;
};
