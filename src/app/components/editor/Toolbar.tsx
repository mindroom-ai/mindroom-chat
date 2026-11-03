import React, { MouseEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Icon, IconButton, IconSrc, Icons, Line, config } from 'folds';
import { Editor, Element, Node, Transforms } from 'slate';
import { ReactEditor, useSlate } from 'slate-react';
import { BlockType, HeadingLevel, MarkType } from './types';
import type { CustomElement } from './slate';
import { isMarkActive, toggleMark } from './keyboard';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';

type ContainerType =
  | typeof BlockType.BlockQuote
  | typeof BlockType.CodeBlock
  | typeof BlockType.OrderedList
  | typeof BlockType.UnorderedList;

/** The line element each container holds. */
const CONTAINER_LINE: Record<ContainerType, CustomElement['type']> = {
  [BlockType.BlockQuote]: BlockType.QuoteLine,
  [BlockType.CodeBlock]: BlockType.CodeLine,
  [BlockType.OrderedList]: BlockType.ListItem,
  [BlockType.UnorderedList]: BlockType.ListItem,
};

const CONTAINERS: ReadonlySet<string> = new Set(Object.keys(CONTAINER_LINE));
const LINES: ReadonlySet<string> = new Set([
  BlockType.Paragraph,
  BlockType.Heading,
  BlockType.QuoteLine,
  BlockType.CodeLine,
  BlockType.ListItem,
]);

const isLine = (node: Node): boolean => Element.isElement(node) && LINES.has(node.type);
const isContainer = (node: Node): boolean => Element.isElement(node) && CONTAINERS.has(node.type);

export const isBlockActive = (
  editor: Editor,
  type: CustomElement['type'],
  level?: HeadingLevel





      (level === undefined || ('level' in node && node.level === level)),
  });
  return !!match;
};

/** Turns the selected lines into (or back out of) a heading, quote, code block, or list. */
export const toggleBlock = (
  editor: Editor,
  type: ContainerType | typeof BlockType.Heading,
  level?: HeadingLevel
) => {
  const active = isBlockActive(editor, type, level);
  Editor.withoutNormalizing(editor, () => {
    Transforms.unwrapNodes(editor, { match: isContainer, split: true });
    Transforms.unsetNodes(editor, 'level', { match: isLine });
    if (active) {
      Transforms.setNodes(editor, { type: BlockType.Paragraph } as Partial<CustomElement>, {
        match: isLine,
      });
      return;
    }
    if (type === BlockType.Heading) {
      Transforms.setNodes(
        editor,
        { type: BlockType.Heading, level: level ?? 1 } as Partial<CustomElement>,
        { match: isLine }
      );
      return;
    }
    Transforms.setNodes(editor, { type: CONTAINER_LINE[type] } as Partial<CustomElement>, {
      match: isLine,
    });
    Transforms.wrapNodes(editor, { type, children: [] } as CustomElement, { match: isLine });
  });
};

const MARKS: MarkType[] = [






];

/** Back to plain paragraphs without marks. */
export const resetFormatting = (editor: Editor) => {
  Editor.withoutNormalizing(editor, () => {
    MARKS.forEach((mark) => Editor.removeMark(editor, mark));
    Transforms.unwrapNodes(editor, { match: isContainer, split: true });
    Transforms.unsetNodes(editor, 'level', { match: isLine });
    Transforms.setNodes(editor, { type: BlockType.Paragraph } as Partial<CustomElement>, {
      match: isLine,
    });
  });
};

type ToolbarButtonProps = {
  label: string;
  icon: IconSrc;
  active?: boolean;
  onClick: () => void;
};

function ToolbarButton({ label, icon, active, onClick }: ToolbarButtonProps) {
  return (
    <IconButton
      size="300"
      radii="300"
      variant={active ? 'Primary' : 'SurfaceVariant'}
      fill={active ? 'Soft' : 'None'}
      aria-label={label}
      aria-pressed={active}
      title={label}
      // Keep the caret in the composer while formatting.
      onMouseDown={(evt: MouseEvent<HTMLButtonElement>) => evt.preventDefault()}
      onClick={onClick}
    >
      <Icon size="50" src={icon} />
    </IconButton>
  );
}

function Separator() {
  return <Line variant="SurfaceVariant" direction="Vertical" style={{ height: '1rem' }} />;
}

/** Formatting controls above the composer; they act on the selection or the next typed text. */





  const act = (change: () => void) => () => {
    change();
    ReactEditor.focus(editor);
  };

  const mark = (type: MarkType, label: string, icon: IconSrc): ReactNode => (
    <ToolbarButton
      key={type}
      label={label}
      icon={icon}
      active={isMarkActive(editor, type)}
      onClick={act(() => toggleMark(editor, type))}
    />
  );

  const block = (
    type: ContainerType | typeof BlockType.Heading,
    label: string,
    icon: IconSrc,
    level?: HeadingLevel
  ): ReactNode => (
    <ToolbarButton
      key={`${type}${level ?? ''}`}
      label={label}
      icon={icon}
      active={isBlockActive(editor, type, level)}
      onClick={act(() => toggleBlock(editor, type, level))}
    />
  );

  return (
    <Box
      alignItems="Center"
      gap="100"
      wrap="Wrap"
      style={{ padding: `${config.space.S100} ${config.space.S200}` }}
    >
      {mark(MarkType.Bold, t('sharedUi.toolbar.bold'), Icons.Bold)}
      {mark(MarkType.Italic, t('sharedUi.toolbar.italic'), Icons.Italic)}
      {mark(MarkType.Underline, t('sharedUi.toolbar.underline'), Icons.Underline)}
      {mark(MarkType.StrikeThrough, t('sharedUi.toolbar.strikeThrough'), Icons.Strike)}
      {mark(MarkType.Code, t('sharedUi.toolbar.inlineCode'), Icons.Code)}
      {mark(MarkType.Spoiler, t('sharedUi.toolbar.spoiler'), Icons.EyeBlind)}
      <Separator />
      {block(BlockType.Heading, t('sharedUi.toolbar.heading1'), Icons.Heading1, 1)}
      {block(BlockType.Heading, t('sharedUi.toolbar.heading2'), Icons.Heading2, 2)}
      {block(BlockType.Heading, t('sharedUi.toolbar.heading3'), Icons.Heading3, 3)}
      {block(BlockType.BlockQuote, t('sharedUi.toolbar.blockQuote'), Icons.BlockQuote)}
      {block(BlockType.CodeBlock, t('sharedUi.toolbar.blockCode'), Icons.BlockCode)}
      {block(BlockType.OrderedList, t('sharedUi.toolbar.orderedList'), Icons.OrderList)}
      {block(BlockType.UnorderedList, t('sharedUi.toolbar.unorderedList'), Icons.UnorderList)}
      <Separator />
      <ToolbarButton
        label={t('sharedUi.toolbar.exitFormatting')}
        icon={Icons.Cross}
        onClick={act(() => resetFormatting(editor))}
      />
      <ToolbarButton
        label={
          isMarkdown ? t('sharedUi.toolbar.disableMarkdown') : t('sharedUi.toolbar.enableMarkdown')
        }
        icon={Icons.Markdown}
        active={isMarkdown}
        onClick={() => setIsMarkdown(!isMarkdown)}
      />
    </Box>
  );
}
