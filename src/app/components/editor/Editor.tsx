import React, {
  ClipboardEventHandler,
  CSSProperties,
  KeyboardEventHandler,
  ReactNode,
  useState,
} from 'react';
import classNames from 'classnames';
import { Box, Scroll, Text } from 'folds';
import { createEditor, Descendant, Editor } from 'slate';
import { withHistory } from 'slate-history';
import {
  Editable,
  RenderElementProps,
  RenderLeafProps,
  RenderPlaceholderProps,
  Slate,
  useFocused,
  useSelected,
  withReact,
} from 'slate-react';
import { BlockType } from './types';
import type { CustomElement, InlineElement } from './slate';
import { withWordUndo } from './history';
import { createParagraphElement, withInlineElements } from './utils';
import * as css from './Editor.css';

const initialValue: Descendant[] = [createParagraphElement()];

/** Creates the composer's Slate editor once per mount: React, word-wise undo, inline atoms. */
export const useEditor = (): Editor => {
  const [editor] = useState(() =>
    withInlineElements(withWordUndo(withHistory(withReact(createEditor()))))
  );
  return editor;
};

function InlineAtom({
  attributes,
  children,
  element,
}: RenderElementProps & { element: InlineElement }) {
  const selected = useSelected();
  const focused = useFocused();
  const active = selected && focused;

  if (element.type === BlockType.Emoticon) {
    return (
      <span {...attributes} contentEditable={false}>
        {element.key.startsWith('mxc://') ? (
          <span className={classNames(css.InlineChip, active && css.InlineChipSelected)}>
            :{element.shortcode}:
          </span>
        ) : (
          element.key
        )}
        {children}
      </span>
    );
  }

  let label: string;
  let highlight = false;
  if (element.type === BlockType.Mention) {
    label = element.name;
    highlight = element.highlight;
  } else if (element.type === BlockType.Command) {
    label = `/${element.command}`;
  } else if (element.type === BlockType.PasteMarker) {
    label = element.fileName;
  } else {
    return <span {...attributes}>{children}</span>;
  }

  return (
    <span
      {...attributes}
      contentEditable={false}
      data-editor-inline={element.type}
      className={classNames(
        css.InlineChip,
        highlight && css.InlineChipHighlight,
        active && css.InlineChipSelected
      )}
    >
      {label}
      {children}
    </span>
  );
}

function RenderElement(props: RenderElementProps) {
  const { attributes, children } = props;
  const element = props.element as CustomElement;

  switch (element.type) {
    case BlockType.ListItem:
      return <li {...attributes}>{children}</li>;




      return (
        <p {...attributes} style={{ margin: 0 }}>
          {children}
        </p>
      );
    case BlockType.Heading:
      return (
        <Text as={`h${element.level}`} size={`H${element.level + 2}` as 'H3'} {...attributes}>
          {children}
        </Text>
      );
    case BlockType.CodeBlock:
      return (
        <pre {...attributes} className={css.CodeBlock}>
          {children}
        </pre>
      );
    case BlockType.BlockQuote:
      return (
        <blockquote {...attributes} className={css.BlockQuote}>
          {children}
        </blockquote>
      );
    case BlockType.OrderedList:
      return <ol {...attributes}>{children}</ol>;
    case BlockType.UnorderedList:
      return <ul {...attributes}>{children}</ul>;
    case BlockType.Link:
      return (
        <a {...attributes} href={element.href}>
          {children}
        </a>
      );
    default:
      return <InlineAtom {...props} element={element} />;
  }
}

function RenderLeaf({ attributes, children, leaf }: RenderLeafProps) {
  let content = children;
  if (leaf.code) content = <code className={css.InlineCode}>{content}</code>;
  if (leaf.bold) content = <strong>{content}</strong>;
  if (leaf.italic) content = <i>{content}</i>;
  if (leaf.underline) content = <u>{content}</u>;
  if (leaf.strikeThrough) content = <s>{content}</s>;
  if (leaf.spoiler) content = <span className={css.Spoiler}>{content}</span>;
  return <span {...attributes}>{content}</span>;
}

function RenderPlaceholder({ attributes, children }: RenderPlaceholderProps) {
  return (
    <span {...attributes} className={css.EditorPlaceholder} style={{}}>
      <Text as="span" truncate>
        {children}
      </Text>
    </span>
  );
}

type CustomEditorProps = {
  editor: Editor;
  /** Names the text box for code: `data-editable-name`, such as `RoomInput` for the composer. */
  editableName?: string;
  /** Accessible name of the text box; the placeholder when not given. */
  ariaLabel?: string;
  placeholder?: string;
  /** Tallest the text box grows before it scrolls; `50vh` by default. */




  /** Controls at the start and end of the text row. */
  before?: ReactNode;
  after?: ReactNode;
  className?: string;
  style?: CSSProperties;
  readOnly?: boolean;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  onKeyUp?: KeyboardEventHandler<HTMLDivElement>;
  onChange?: (value: Descendant[]) => void;
  onPaste?: ClipboardEventHandler<HTMLDivElement>;
};

// Module-level renderers keep one identity for every editor, so Slate never re-renders for them.
const renderElement = (props: RenderElementProps) => <RenderElement {...props} />;
const renderLeaf = (props: RenderLeafProps) => <RenderLeaf {...props} />;
const renderPlaceholder = (props: RenderPlaceholderProps) => <RenderPlaceholder {...props} />;

/** A row of controls beside the text box; renders nothing without controls. */
function EditorControls({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <Box shrink="No" gap="100" alignItems="Center" className={css.EditorOptions}>
      {children}
    </Box>
  );
}

/** The composer text box: Slate editing between optional leading and trailing controls. */
export const CustomEditor = React.forwardRef<HTMLDivElement, CustomEditorProps>((props, ref) => {
  const { editor, onChange, top, bottom, before, after, className, style } = props;
  const { placeholder, ariaLabel = placeholder, editableName, maxHeight = '50vh' } = props;
  const { readOnly, onKeyDown, onKeyUp, onPaste } = props;

  const textBox = (
    <Editable
      className={css.EditorTextarea}
      data-editable-name={editableName}
      aria-label={ariaLabel}
      readOnly={readOnly}
      placeholder={placeholder}
      renderPlaceholder={renderPlaceholder}
      renderElement={renderElement}
      renderLeaf={renderLeaf}
      onPaste={onPaste}
      onKeyUp={onKeyUp}
      onKeyDown={onKeyDown}
    />
  );

  return (
    <div ref={ref} style={style} className={classNames(css.Editor, className)}>
      <Slate initialValue={initialValue} editor={editor} onChange={onChange}>
        {top}
        <Box alignItems="Start">
          <EditorControls>{before}</EditorControls>
          <Scroll
            hideTrack
            visibility="Hover"
            size="300"
            variant="SurfaceVariant"
            style={{ maxHeight }}
            className={css.EditorTextareaScroll}
          >
            {textBox}
          </Scroll>
          <EditorControls>{after}</EditorControls>
        </Box>
        {bottom}
      </Slate>
    </div>
  );
});
CustomEditor.displayName = 'CustomEditor';
