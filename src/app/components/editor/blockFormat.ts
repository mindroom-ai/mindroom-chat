import { Editor, Element, Range, Transforms } from 'slate';
import type { Node, Path } from 'slate';
import { BlockType } from './types';

/** Line formats the formatting toolbar switches: a heading, or a quote, code block or list. */
export type BlockFormat =
  | typeof BlockType.Heading
  | typeof BlockType.BlockQuote
  | typeof BlockType.CodeBlock
  | typeof BlockType.OrderedList
  | typeof BlockType.UnorderedList;

type ContainerFormat = Exclude<BlockFormat, typeof BlockType.Heading>;

// Each container holds lines of one type.
const containerLines: Record<ContainerFormat, Element['type']> = {
  [BlockType.BlockQuote]: BlockType.QuoteLine,
  [BlockType.CodeBlock]: BlockType.CodeLine,
  [BlockType.OrderedList]: BlockType.ListItem,
  [BlockType.UnorderedList]: BlockType.ListItem,
};

const isContainerFormat = (type: string): type is ContainerFormat => type in containerLines;

const isTopLevelBlock = (node: Node, path: Path): node is Element =>
  path.length === 1 && Element.isElement(node);

/** The top-level blocks from the start of the selection to its end. */
const blocksInSelection = (editor: Editor): Element[] => {
  if (!editor.selection) return [];
  const [start, end] = Range.edges(editor.selection);
  const first = start.path[0];
  const last = end.path[0];
  if (first === undefined || last === undefined) return [];
  return editor.children
    .slice(first, last + 1)
    .filter((node): node is Element => Element.isElement(node));
};

/** The format every selected block shares, or undefined for plain or mixed lines. */
export const getActiveBlockFormat = (editor: Editor): BlockFormat | undefined => {
  const blocks = blocksInSelection(editor);
  const shared = blocks[0]?.type;
  if (!shared || blocks.some((block) => block.type !== shared)) return undefined;
  if (shared === BlockType.Heading || isContainerFormat(shared)) return shared;
  return undefined;
};

/**
 * Gives the selected lines `format`, or makes them paragraphs again when they all have it.
 * Lines first leave any quote, code block or list they are in (splitting it around them), take
 * their new line type, and are then grouped into one container of the new format.
 */
export const toggleBlockFormat = (editor: Editor, format: BlockFormat): void => {
  if (!editor.selection) return;
  const clearing = getActiveBlockFormat(editor) === format;
  Editor.withoutNormalizing(editor, () => {
    Transforms.unwrapNodes(editor, {
      match: (node, path) => isTopLevelBlock(node, path) && isContainerFormat(node.type),
      split: true,
    });
    const lines = { match: isTopLevelBlock };
    if (clearing || format !== BlockType.Heading) {
      Transforms.unsetNodes(editor, 'level', lines);
    }
    if (clearing) {
      Transforms.setNodes(editor, { type: BlockType.Paragraph }, lines);
      return;
    }
    if (format === BlockType.Heading) {
      Transforms.setNodes(editor, { type: BlockType.Heading, level: 1 }, lines);
      return;
    }
    Transforms.setNodes(editor, { type: containerLines[format] }, lines);
    Transforms.wrapNodes(editor, { type: format, children: [] }, lines);
  });
};
