import React, {
  ClipboardEventHandler,
  CSSProperties,
  KeyboardEventHandler,
  ReactNode,
  useCallback,
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





  className?: string;
  style?: CSSProperties;
  readOnly?: boolean;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  onKeyUp?: KeyboardEventHandler<HTMLDivElement>;
  onChange?: (value: Descendant[]) => void;
  onPaste?: ClipboardEventHandler<HTMLDivElement>;
};

/** The composer text box: Slate editing between optional leading and trailing controls. */
export const CustomEditor = React.forwardRef<HTMLDivElement, CustomEditorProps>(
  (
    {
      editor,
      editableName,
      ariaLabel,
      placeholder,
      top,
      bottom,
      before,
      after,
      maxHeight = '50vh',
      className,
      style,














      (props: RenderPlaceholderProps) => <RenderPlaceholder {...props} />,
      []
    );

    return (











































CustomEditor.displayName = 'CustomEditor';
