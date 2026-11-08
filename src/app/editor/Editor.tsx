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
import type { BlockElement, CustomElement, HeadingElement, InlineElement } from './slate';
import { withWordUndo } from './history';
import { createParagraphElement, isAfterMentionSpace, withInlineElements } from './utils';
import * as css from './Editor.css';
import { useOptionalMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../matrix/hooks/useMediaAuthentication';
import { mxcUrlToHttp } from '../matrix/mediaUrl';
import { findShortcut, usesCommandKey } from '../shortcuts/shortcuts';
import { openOverlay } from '../shortcuts/shortcutDom';
import { hasShortcutHandler } from '../shortcuts/useShortcut';
import { revealDirectionControls } from '../ui/directional';

const emptyDocument: Descendant[] = [createParagraphElement()];

/** Creates the composer's Slate editor once per mount: React, word-wise undo, inline atoms. */
export const useEditor = (): Editor => {
  const [editor] = useState(() =>
    withInlineElements(withWordUndo(withHistory(withReact(createEditor()))))
  );
  return editor;
};

/**
 * A custom emoji in the text box: its image at text height, or its `:shortcode:` as a chip where
 * no client can resolve the image.
 */
function EditorCustomEmoji({
  mxc,
  shortcode,
  active,
}: {
  mxc: string;
  shortcode: string;
  active: boolean;
}) {
  const client = useOptionalMatrixClient();
  const authenticated = useMediaAuthentication();
  const src = client ? mxcUrlToHttp(client, mxc, authenticated, 64, 64, 'scale') : undefined;
  if (!src) {
    return (
      <span className={classNames(css.InlineChip, active && css.InlineChipSelected)}>
        :{shortcode}:
      </span>
    );
  }
  return (
    <img
      className={classNames(css.Emoticon, active && css.InlineChipSelected)}
      src={src}
      alt={`:${shortcode}:`}
      title={`:${shortcode}:`}
      draggable={false}
    />
  );
}

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
          <EditorCustomEmoji mxc={element.key} shortcode={element.shortcode} active={active} />
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
    // The label is text the message sends, such as one an edited message already holds.
    label = revealDirectionControls(element.name);
    highlight = element.highlight;
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

type BlockTag = {
  Tag: 'blockquote' | 'div' | 'li' | 'ol' | 'p' | 'pre' | 'ul';
  className?: string;
  style?: CSSProperties;
};

/** Block elements that are one HTML tag around their children. */
type TaggedBlock = Exclude<BlockElement, HeadingElement>;

const blockTags: Record<TaggedBlock['type'], BlockTag> = {
  [BlockType.Paragraph]: { Tag: 'p', style: { margin: 0 } },
  [BlockType.QuoteLine]: { Tag: 'p', style: { margin: 0 } },
  [BlockType.CodeBlock]: { Tag: 'pre', className: css.CodeBlock },
  [BlockType.CodeLine]: { Tag: 'div' },
  [BlockType.BlockQuote]: { Tag: 'blockquote', className: css.BlockQuote },
  [BlockType.ListItem]: { Tag: 'li' },
  [BlockType.OrderedList]: { Tag: 'ol' },
  [BlockType.UnorderedList]: { Tag: 'ul' },
};

const isTaggedBlock = (element: CustomElement): element is TaggedBlock => element.type in blockTags;

function RenderElement(props: RenderElementProps) {
  const { attributes, children } = props;
  const element = props.element;

  if (isTaggedBlock(element)) {
    const { Tag, className, style } = blockTags[element.type];
    return (
      <Tag {...attributes} className={className} style={style}>
        {children}
      </Tag>
    );
  }

  switch (element.type) {
    case BlockType.Heading:
      return (
        <Text as={`h${element.level}`} size={`H${element.level + 2}` as 'H3'} {...attributes}>
          {children}
        </Text>
      );
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

/** What the editor frames: `top` and `bottom` rows around the text row, `before` and `after` controls beside the text box. */
type EditorSlots = Partial<Record<'top' | 'bottom' | 'before' | 'after', ReactNode>>;

type CustomEditorProps = EditorSlots & {
  editor: Editor;
  /** The document at mount, such as the message being edited; one empty line when not given. */
  initialValue?: Descendant[];
  /** Names the text box for code: `data-editable-name`, such as `RoomInput` for the composer. */
  editableName?: string;
  /** Accessible name of the text box; the placeholder when not given. */
  ariaLabel?: string;
  placeholder?: string;
  /** Tallest the text box grows before it scrolls; `50vh` by default. */
  maxHeight?: string;
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

/**
 * Whether one of the app's shortcuts takes the key from the text box, such as Option (Alt) with
 * an arrow in an empty composer, which opens the room above or below. On Apple platforms Slate
 * moves by line on those keys, also in an empty text box, and its preventDefault would keep them
 * from the shortcut listener on the window.
 */
const takenByShortcut = (event: KeyboardEvent): boolean =>
  findShortcut(event, {
    apple: usesCommandKey(),
    composing: false,
    computer: false,
    overlay: openOverlay(),
    registered: hasShortcutHandler,
  }) !== undefined;

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
  const { readOnly, onKeyDown, onKeyUp, onPaste, initialValue = emptyDocument } = props;

  // When this returns true, Slate skips its own handling of the key (as after a preventDefault
  // here), so a shortcut's key goes on to the window unprevented.
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      onKeyDown?.(event);
      if (event.isDefaultPrevented() || event.isPropagationStopped()) return true;
      return takenByShortcut(event.nativeEvent);
    },
    [onKeyDown]
  );

  // The space a picked mention brings stands in for the one typed after the name. Android's
  // input events cannot be cancelled; that space stays there.
  const handleBeforeInput = useCallback(
    (event: InputEvent) => {
      if (event.inputType !== 'insertText' || event.data !== ' ' || !event.cancelable) return;
      if (isAfterMentionSpace(editor)) event.preventDefault();
    },
    [editor]
  );

  const textBox = (
    <Editable
      className={css.EditorTextarea}
      data-editable-name={editableName}
      // The text runs in the direction of the language it starts in, whatever the app language.
      dir="auto"
      // Chat is full of names, numbers and file names a dictionary does not know, so the browser
      // draws no spell-check squiggles here, as in MindRoom Chat.
      spellCheck={false}
      aria-label={ariaLabel}
      readOnly={readOnly}
      placeholder={placeholder}
      renderPlaceholder={renderPlaceholder}
      renderElement={renderElement}
      renderLeaf={renderLeaf}
      onPaste={onPaste}
      onKeyUp={onKeyUp}
      onKeyDown={handleKeyDown}
      onDOMBeforeInput={handleBeforeInput}
    />
  );

  return (
    <div ref={ref} style={style} className={classNames(css.Editor, className)}>
      <Slate initialValue={initialValue} editor={editor} onChange={onChange}>
        {top}
        <Box alignItems="Start">
          <EditorControls>{before}</EditorControls>
          {/* The thumb shows whenever the text overflows, not only under a pointer: on a touch
              screen, or with the pointer elsewhere, it is the only sign of the lines out of view. */}
          <Scroll
            hideTrack
            visibility="Always"
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
