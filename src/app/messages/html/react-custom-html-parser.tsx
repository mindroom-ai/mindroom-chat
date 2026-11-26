import React, {
  ComponentPropsWithoutRef,
  KeyboardEvent,
  MouseEventHandler,
  ReactElement,
  ReactNode,
  SyntheticEvent,
  useEffect,
  useRef,
  useState,
  type JSX,
} from 'react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import {
  type DOMNode,
  HTMLReactParserOptions,
  attributesToProps,
  domToReact,
} from 'html-react-parser';
import { isTag, isText } from 'domhandler';
import type { ChildNode, Element } from 'domhandler';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import type { IntermediateRepresentation, Opts as LinkifyOpts } from 'linkifyjs';
import { Text } from 'folds';
import { ErrorBoundary } from 'react-error-boundary';
import * as css from '../../rich-text/CustomHtml.css';
import * as footnoteCss from '../../rich-text/Footnote.css';
import * as taskListCss from '../../rich-text/TaskList.css';
import { renderCustomHtmlElement } from './customHtmlRenderers';
import { InlineImage } from './InlineImage';
import { MermaidBlock } from './MermaidBlock';
import { renderTextWithMatrixMath } from '../../rich-text/matrixMath';
import {
  CheckIcon,
  CodeBlockLanguageIcon,
  CollapseIcon,
  CopyIcon,
  ExpandIcon,
  WrapTextIcon,
} from '../../rich-text/code/CodeBlockIcons';
import {
  getCodeBlockLanguage,
  getCodeBlockLanguageIconToken,
} from '../../rich-text/code/codeBlockLanguage';
import { FootnoteItem, FootnoteLink } from '../../rich-text/Footnote';
import { isFootnoteHref, isFootnoteId } from '../../rich-text/sanitize';
import { LinkFaviconContext } from '../../rich-text/MessageLink';
import { CheckedMessageLink } from '../../rich-text/CheckedMessageLink';
import { Callout, extractCallout } from '../../rich-text/Callout';
import { TaskListItem, extractTaskListItem, hasTaskListMarker } from '../../rich-text/TaskList';
import { useDetailsRevealOnOpen, useRevealOnOpen } from '../../ui/disclosureReveal';
import { stripBidiControls } from '../../rich-text/linkDestination';
import { revealDirectionControls } from '../../ui/directional';
import { containsSpoiler } from '../../rich-text/linkFaviconPolicy';
import { copyToClipboard } from '../../lib/dom';
import { getCanonicalAliasRoomId } from '../../matrix/matrix';
import { mxcUrlToHttp } from '../../matrix/mediaUrl';
import { EMOJI_PATTERN, createInsideUrlTest } from '../../lib/regex';
import { useMemberDisplayName } from '../../matrix/hooks/useMemberDisplayName';
import { PrismCode } from '../../rich-text/code/ReactPrism';
import { WithKatex } from '../../rich-text/lazyKatex';
import {
  parseMatrixToRoom,
  parseMatrixToRoomEvent,
  parseMatrixToUser,
  testMatrixTo,
} from '../../matrix/matrix-to';

// Renders `org.matrix.custom.html` message bodies as React: html-react-parser options that
// style the Matrix formatting tags, render mentions, spoilers, math, code blocks and emoji,
// link URLs in text, and hand tables, Matrix math and MindRoom blocks to the MindRoom renderers.

/** Links that leave the app open in a new tab and do not hand it their opener. */
const NEW_TAB_LINK = { rel: 'noreferrer noopener', target: '_blank' } as const;

/** Linkify options for message text: links with a scheme, or starting with `www.`. */
export const LINKIFY_OPTS: LinkifyOpts = {
  ...NEW_TAB_LINK,
  defaultProtocol: 'https',
  // A bare domain such as `example.com` stays text.
  validate: {
    url: (value: string) => /^(?:https?|ftp|mailto|magnet):/i.test(value) || /^www\./i.test(value),
  },
};

type StyledText = Array<string | JSX.Element>;

const toGlobal = (regex: RegExp): RegExp =>
  new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`);

const hasNonEmptyMatch = (text: string, regex: RegExp): boolean => {
  for (const match of text.matchAll(toGlobal(regex))) {
    if (match[0] !== '') return true;
  }
  return false;
};

/** Emoji in `text`, outside URLs, scaled up to match the text around them. */
const scaleEmoji = (
  text: string,
  offset: number,
  insideUrl: (index: number) => boolean
): StyledText => {
  const output: StyledText = [];
  let cursor = 0;
  for (const match of text.matchAll(new RegExp(EMOJI_PATTERN, 'g'))) {
    const index = match.index ?? 0;
    if (insideUrl(offset + index)) continue;
    if (index > cursor) output.push(text.slice(cursor, index));
    output.push(
      <span key={`emoji-${offset + index}`} className={css.Emoticon()}>
        {match[0]}
      </span>
    );
    cursor = index + match[0].length;
  }
  if (cursor < text.length) output.push(text.slice(cursor));
  return output;
};

/** Text with scaled emoji and the search matches of `highlightRegex` marked. */
const renderStyledText = (text: string, highlightRegex?: RegExp): StyledText => {
  const insideUrl = createInsideUrlTest(text);
  if (!highlightRegex) return scaleEmoji(text, 0, insideUrl);
  const output: StyledText = [];
  let cursor = 0;
  for (const match of text.matchAll(toGlobal(highlightRegex))) {
    const index = match.index ?? 0;
    if (match[0] === '') continue;
    output.push(...scaleEmoji(text.slice(cursor, index), cursor, insideUrl));
    output.push(
      <span key={`highlight-${index}`} className={css.highlightText}>
        {scaleEmoji(match[0], index, insideUrl)}
      </span>
    );
    cursor = index + match[0].length;
  }
  output.push(...scaleEmoji(text.slice(cursor), cursor, insideUrl));
  return output;
};

/**
 * Message text with its `$math$` and `$$math$$` rendered, emoji scaled, search matches marked and
 * URLs linked (unless `linkify` is false). Text in backticks stays as written. Bidirectional
 * controls show as code points (`<U+202E>`), so the text reads in the order it holds; Copy Text
 * copies the message as it is.
 */
export const renderTextWithLatex = (
  text: string,
  params: {
    linkify?: boolean;
    linkifyOpts?: LinkifyOpts;
    highlightRegex?: RegExp;
    keyPrefix?: string;
  }
): ReactNode => {
  const shown = revealDirectionControls(text);
  const render = () => renderTextWithMatrixMath(shown, { ...params, renderStyledText });
  // Only text with a dollar sign can hold math, which typesets once KaTeX has loaded.
  return shown.includes('$') ? <WithKatex render={render} /> : render();
};

/** Props for a mention link: it opens in a new tab unless the click handler handles it. */
export const makeMentionCustomProps = (
  handleMentionClick?: MouseEventHandler<HTMLElement>
): ComponentPropsWithoutRef<'a'> => ({ ...NEW_TAB_LINK, onClick: handleMentionClick });

const roomName = (mx: MatrixClient, roomIdOrAlias: string): string => {
  const roomId = roomIdOrAlias.startsWith('#')
    ? getCanonicalAliasRoomId(mx, roomIdOrAlias)
    : roomIdOrAlias;
  const room = roomId ? mx.getRoom(roomId) : undefined;
  return revealDirectionControls(room?.name ? `#${room.name}` : roomIdOrAlias);
};

/**
 * The name of a mentioned user, as `@display name` once the room knows them, else their ID. A room
 * that loads its members lazily may not know them yet (an agent that has not spoken): the name then
 * follows as soon as the members arrive. The name is the one the room shows for their messages
 * (`getMemberDisplayName`: without direction controls, with the ID after a name that held some);
 * an ID comes from the link, which can name any ID, so it shows its controls as code points.
 */
function UserMentionName({
  client,
  room,
  userId,
}: {
  client: MatrixClient;
  room: Room | null;
  userId: string;
}) {
  const name = useMemberDisplayName(client, room, userId);
  return <>{name ? `@${name}` : revealDirectionControls(userId)}</>;
}

/**
 * What a link to a message says instead of its URL: the room it is in (`#room name`, or the
 * alias for a room this account is not in), and whether it is a thread's message as far as the
 * client knows.
 */
function MessageLinkLabel({
  client,
  roomIdOrAlias,
  eventId,
}: {
  client: MatrixClient;
  roomIdOrAlias: string;
  eventId: string;
}) {
  const { t } = useTranslation();
  const isAlias = roomIdOrAlias.startsWith('#');
  const roomId = isAlias ? getCanonicalAliasRoomId(client, roomIdOrAlias) : roomIdOrAlias;
  const room = roomId ? client.getRoom(roomId) : null;
  const place = room?.name
    ? `#${revealDirectionControls(room.name)}`
    : isAlias
      ? revealDirectionControls(roomIdOrAlias)
      : undefined;
  if (!place) return <>{t('sharedUi.messageLink.messageElsewhere')}</>;
  const inThread = !!room?.getThread(eventId) || !!room?.findEventById(eventId)?.threadRootId;
  return (
    <>
      {inThread
        ? t('sharedUi.messageLink.threadIn', { room: place })
        : t('sharedUi.messageLink.messageIn', { room: place })}
    </>
  );
}

/**
 * A Matrix permalink as a mention: a user as `@display name` (the name in `viewedRoomId`), a
 * room as `#room name`, and a link to an event as a link that keeps its text (`content`) but
 * opens the event; without text of its own (a URL in plain text) it names the room it leads to.
 * With `keepRoomLabel`, a link to a room keeps its text in the same way and still opens the room:
 * for a label its author wrote, or one that hides a spoiler, which the room's name would replace.
 * Mentions carry the ID in `data-mention-id`, an optional event in `data-mention-event-id`, and
 * optional routing servers in `data-mention-via`, for the
 * mention click handler. A user or room mention reads in its own direction (`dir="auto"`), so a
 * Matrix ID inside right-to-left text keeps its `@` or `#` in front. Undefined for other links.
 */
export const renderMatrixMention = (
  client: MatrixClient,
  viewedRoomId: string | undefined,
  href: string,
  customProps: ComponentPropsWithoutRef<'a'>,
  content?: ReactNode,
  keepRoomLabel = false
): JSX.Element | undefined => {
  const userId = parseMatrixToUser(href);
  if (userId) {
    const room = viewedRoomId ? client.getRoom(viewedRoomId) : null;
    return (
      <a
        {...customProps}
        href={href}
        className={classNames(
          css.Mention({ highlight: client.getUserId() === userId }),
          customProps.className
        )}
        data-mention-id={userId}
        dir="auto"
      >
        <UserMentionName client={client} room={room} userId={userId} />
      </a>
    );
  }

  const eventLink = parseMatrixToRoomEvent(href);
  if (eventLink) {
    return (
      <a
        href={href}
        {...customProps}
        className={
          content === undefined
            ? classNames(
                css.Mention({ highlight: false }),
                css.MessageLinkPill,
                customProps.className
              )
            : customProps.className
        }
        title={content === undefined ? href : customProps.title}
        data-mention-id={eventLink.roomIdOrAlias}
        data-mention-event-id={eventLink.eventId}
        data-mention-via={eventLink.viaServers?.join(',') || undefined}
      >
        {content ?? (
          <MessageLinkLabel
            client={client}
            roomIdOrAlias={eventLink.roomIdOrAlias}
            eventId={eventLink.eventId}
          />
        )}
      </a>
    );
  }

  const roomLink = parseMatrixToRoom(href);
  if (roomLink && keepRoomLabel && content !== undefined) {
    return (
      <a
        href={href}
        {...customProps}
        data-mention-id={roomLink.roomIdOrAlias}
        data-mention-via={roomLink.viaServers?.join(',') || undefined}
      >
        {content}
      </a>
    );
  }
  if (roomLink) {
    const roomId = roomLink.roomIdOrAlias.startsWith('#')
      ? getCanonicalAliasRoomId(client, roomLink.roomIdOrAlias)
      : roomLink.roomIdOrAlias;
    return (
      <a
        {...customProps}
        href={href}
        className={classNames(
          css.Mention({ highlight: !!roomId && roomId === viewedRoomId }),
          customProps.className
        )}
        data-mention-id={roomLink.roomIdOrAlias}
        data-mention-via={roomLink.viaServers?.join(',') || undefined}
        dir="auto"
      >
        {roomName(client, roomLink.roomIdOrAlias)}
      </a>
    );
  }
  return undefined;
};

/**
 * A linkify `render` option: Matrix permalinks become what `mentionRender` makes of them, other
 * links message links, with the site's icon when `showFavicons` is on.
 */
export const factoryRenderLinkifyWithMention =
  (
    mentionRender: (href: string) => JSX.Element | undefined,
    showFavicons = false
  ): ((ir: IntermediateRepresentation) => JSX.Element) =>
  ({ tagName, attributes, content }) => {
    const href: unknown = attributes.href;
    if (tagName === 'a' && typeof href === 'string' && testMatrixTo(href)) {
      const mention = mentionRender(href);
      if (mention) return mention;
    }
    return (
      <CheckedMessageLink {...attributesToProps(attributes)} showFavicon={showFavicons}>
        {stripBidiControls(content)}
      </CheckedMessageLink>
    );
  };

/** The text of DOM nodes as a reader sees it; links inside code count as their text. */
const textContent = (nodes: ChildNode[]): string =>
  nodes
    .map((node) => {
      if (isText(node)) return node.data;
      if (isTag(node)) return node.name === 'br' ? '\n' : textContent(node.children);
      return '';
    })
    .join('');

// A code block longer than this many lines, as shown, starts collapsed to `COLLAPSED_LINES`.
const LONG_CODE_BLOCK_LINES = 16;
const COLLAPSED_LINES = 12;
// Wrapped lines are estimated from their length; message columns fit about this many characters.
const WRAPPED_LINE_CHARACTERS = 80;
const COPIED_FEEDBACK_MS = 2000;
// The code element of every block; the id repeats per block, so look it up inside its <pre>.
const CODE_BLOCK_CONTENT_ID = 'code-block-content';

const countShownLines = (code: string, wrap: boolean): number =>
  code
    .split('\n')
    .reduce(
      (lines, line) =>
        lines + (wrap ? Math.max(1, Math.ceil(line.length / WRAPPED_LINE_CHARACTERS)) : 1),
      0
    );

type CodeBlockProps = {
  /** The DOM children of the `<pre>`: usually one `<code>`, with the language in its class. */
  children?: ChildNode[];
  /** Parser options for a `<pre>` that holds formatted text rather than code. */
  opts?: HTMLReactParserOptions;
  /** Search matches to mark; a block with a match shows them instead of syntax colors. */
  highlightRegex?: RegExp;
};

/** Parser options that also show the direction controls of text as code points. */
const revealingText = (opts: HTMLReactParserOptions): HTMLReactParserOptions => ({
  ...opts,
  replace: (node, index) => {
    if (!isText(node)) return opts.replace?.(node, index);
    const shown = revealDirectionControls(node.data);
    return shown === node.data ? opts.replace?.(node, index) : <>{shown}</>;
  },
});

/**
 * A fenced code block: a header with the language (as an icon when there is one) or the block's
 * `data-label`, and buttons to wrap lines, expand a long block and copy the code; then the code,
 * syntax highlighted by Prism.
 */
export function CodeBlock({ children = [], opts, highlightRegex }: CodeBlockProps) {
  const { t } = useTranslation();
  const [wrap, setWrap] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const codeScrollRef = useRef<HTMLDivElement>(null);
  const armReveal = useRevealOnOpen(expanded, expandButtonRef, codeScrollRef);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(copiedTimer.current), []);
  // The view (collapse, wrap, code length) whose last line the reader scrolled to, if any.
  const [endView, setEndView] = useState<string>();

  const codeElement = children.find(
    (child): child is Element => isTag(child) && child.name === 'code'
  );
  const language = getCodeBlockLanguage(codeElement?.attribs.class);
  const label = codeElement?.attribs['data-label'] || undefined;
  const labelExtension = label?.includes('.') ? label.split('.').pop() : undefined;
  const iconToken =
    (language && getCodeBlockLanguageIconToken(language)) ||
    (labelExtension && getCodeBlockLanguageIconToken(labelExtension)) ||
    undefined;
  // The block shows its direction controls as code points; Copy copies the code as it is.
  const source = textContent(codeElement ? codeElement.children : children).replace(/\n$/, '');
  const code = revealDirectionControls(source);
  const formatted = !codeElement && opts !== undefined && children.some((child) => isTag(child));
  const searchMatch = highlightRegex !== undefined && toGlobal(highlightRegex).test(code);

  const long = countShownLines(code, wrap) > LONG_CODE_BLOCK_LINES;
  const collapsed = long && !expanded;
  // Collapsed, the code overflows its box; unwrapped, its lines may overflow sideways. Neither
  // is measured: mounting a block reads no layout.
  const scrollable = collapsed || !wrap;
  const view = `${collapsed}:${wrap}:${code.length}`;
  const atEnd = endView === view;
  const onScroll = (event: SyntheticEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = event.currentTarget;
    // At fractional zoom the native maximum sits just below scrollHeight - clientHeight.
    setEndView(scrollTop >= scrollHeight - clientHeight - 1 ? view : undefined);
  };

  const copy = async () => {
    const done = await copyToClipboard(source);
    setCopied(done);
    clearTimeout(copiedTimer.current);
    if (done) copiedTimer.current = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
  };

  const codeStyle: React.CSSProperties = {
    display: 'block',
    whiteSpace: wrap ? 'pre-wrap' : 'pre',
    overflowWrap: wrap ? 'anywhere' : 'normal',
  };
  let body: ReactNode;
  if (formatted && opts) {
    body = (
      <code id={CODE_BLOCK_CONTENT_ID} className={css.CodeBlockInternal} style={codeStyle}>
        {domToReact(children as DOMNode[], revealingText(opts))}
      </code>
    );
  } else if (searchMatch) {
    body = (
      <code id={CODE_BLOCK_CONTENT_ID} className={css.CodeBlockInternal} style={codeStyle}>
        {renderStyledText(code, highlightRegex)}
      </code>
    );
  } else {
    body = (
      <ErrorBoundary
        fallback={
          <code id={CODE_BLOCK_CONTENT_ID} className={css.CodeBlockInternal} style={codeStyle}>
            {code}
          </code>
        }
      >
        <PrismCode
          code={code}
          language={language}
          id={CODE_BLOCK_CONTENT_ID}
          className={css.CodeBlockInternal}
          style={codeStyle}
        />
      </ErrorBoundary>
    );
  }

  const headerLabel = (
    <div className={css.CodeBlockLabel}>
      {iconToken && (
        <span
          role="img"
          aria-label={t('messageCodeBlock.language', {
            language: language ?? labelExtension,
          })}
        >
          <CodeBlockLanguageIcon token={iconToken} />
        </span>
      )}
      {(label || !iconToken) && (
        <span className={css.CodeBlockLabelText}>{label ?? language ?? 'text'}</span>
      )}
    </div>
  );

  const sourceActions = (
    <>
      <button
        type="button"
        className={css.CodeBlockAction}
        aria-label={t('messageCodeBlock.wrap')}
        title={t('messageCodeBlock.wrap')}
        aria-pressed={wrap}
        onClick={() => setWrap((value) => !value)}
      >
        <WrapTextIcon />
      </button>
      {long && (
        <button
          ref={expandButtonRef}
          type="button"
          className={css.CodeBlockAction}
          aria-label={expanded ? t('messageCodeBlock.collapse') : t('messageCodeBlock.expand')}
          aria-expanded={expanded}
          onClick={() => {
            if (!expanded) armReveal();
            setExpanded((value) => !value);
          }}
        >
          {expanded ? <CollapseIcon /> : <ExpandIcon />}
        </button>
      )}
    </>
  );

  const copyAction = (
    <button
      type="button"
      className={css.CodeBlockAction}
      aria-label={copied ? t('messageCodeBlock.copied') : t('messageCodeBlock.copy')}
      onClick={() => void copy()}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  );

  const sourceBody = (
    <>
      {/* Native scroll areas need a tab stop for keyboard scrolling. */}
      {/* eslint-disable jsx-a11y/no-noninteractive-tabindex */}
      <div
        ref={codeScrollRef}
        className={css.CodeBlockScroll}
        // Collapsed, the block shows its first lines and scrolls through the rest in place.
        style={collapsed ? { maxHeight: `${COLLAPSED_LINES * 1.5}em` } : undefined}
        role={scrollable ? 'region' : undefined}
        aria-label={scrollable ? t('messageCodeBlock.code') : undefined}
        tabIndex={scrollable ? 0 : undefined}
        onScroll={onScroll}
      >
        {body}
        {collapsed && !atEnd && <div className={css.CodeBlockBottomShadow} />}
      </div>
      {/* eslint-enable jsx-a11y/no-noninteractive-tabindex */}
    </>
  );

  if (!formatted && language?.toLowerCase() === 'mermaid') {
    return (
      <MermaidBlock
        source={source}
        searchMatch={searchMatch}
        wrap={wrap}
        headerLabel={headerLabel}
        sourceActions={sourceActions}
        copyAction={copyAction}
        sourceBody={sourceBody}
      />
    );
  }

  return (
    <pre className={classNames(css.CodeBlock, css.MarginSpaced)} data-wrap={wrap}>
      <div className={css.CodeBlockHeader}>
        {headerLabel}
        <div
          className={css.CodeBlockActions}
          role="group"
          aria-label={t('messageCodeBlock.actions')}
          data-code-block-actions=""
        >
          {sourceActions}
          {copyAction}
        </div>
      </div>
      {sourceBody}
    </pre>
  );
}

/** Native `<details>` disclosure with clamped scroll reveal when opened by the reader. */
function RevealDetails(props: ComponentPropsWithoutRef<'details'>) {
  const revealRef = useDetailsRevealOnOpen();
  return <details {...props} ref={revealRef} />;
}

/**
 * A Matrix spoiler (`data-mx-spoiler`, whose value is an optional reason): hidden until clicked
 * or activated with the keyboard. Links inside never load a site icon, even once revealed.
 */
function Spoiler({ reason, children }: { reason?: string; children: ReactNode }) {
  const { t } = useTranslation();
  const [revealed, setRevealed] = useState(false);
  // While hidden, the first click or key press only reveals: a link inside is not followed
  // and the message around it does not see the click.
  const reveal = (event: SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setRevealed(true);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (revealed || (event.key !== 'Enter' && event.key !== ' ')) return;
    reveal(event);
  };
  return (
    <span
      data-mx-spoiler={reason ?? ''}
      className={css.Spoiler({ active: revealed })}
      role={revealed ? undefined : 'button'}
      tabIndex={revealed ? undefined : 0}
      aria-pressed={!revealed}
      aria-label={revealed ? undefined : reason || t('sharedUi.imageContent.spoiler')}
      title={revealed ? undefined : reason || undefined}
      onClick={revealed ? undefined : reveal}
      onKeyDown={onKeyDown}
    >
      <LinkFaviconContext value={false}>{children}</LinkFaviconContext>
    </span>
  );
}

const HEADING_SIZES = {
  h1: 'H3',
  h2: 'H4',
  h3: 'H5',
  h4: 'H6',
  h5: 'H6',
  h6: 'H6',
} as const;

const isHeading = (name: string): name is keyof typeof HEADING_SIZES =>
  Object.prototype.hasOwnProperty.call(HEADING_SIZES, name);

/**
 * Removes bidirectional controls from the text inside a link, in the parsed tree, so a link's
 * text cannot show an address in an order other than the one it holds.
 */
const stripLinkTextBidi = (nodes: ChildNode[]): void => {
  nodes.forEach((node) => {
    if (isText(node)) node.data = stripBidiControls(node.data);
    else if (isTag(node)) stripLinkTextBidi(node.children);
  });
};

const hasAncestor = (node: ChildNode, names: string[]): boolean => {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (isTag(parent) && names.includes(parent.name)) return true;
  }
  return false;
};

const hasClass = (classAttr: string | undefined, name: string): boolean =>
  !!classAttr && classAttr.split(/\s+/).includes(name);

const isFootnoteListItem = (attribs: Record<string, string>): boolean =>
  isFootnoteId(attribs.id) || hasClass(attribs.class, 'footnote-item');

const isTaskList = (children: ChildNode[]): boolean => {
  const items = children.filter((child): child is Element => isTag(child) && child.name === 'li');
  return (
    items.length > 0 &&
    items.every((item) => !isFootnoteListItem(item.attribs) && hasTaskListMarker(item.children))
  );
};

const withoutAttribute = (attribs: Record<string, string>, name: string) => {
  const rest = { ...attribs };
  delete rest[name];
  return rest;
};

type ReactCustomHtmlParserParams = {
  linkifyOpts: LinkifyOpts;
  /** Search matches to mark in the text. */
  highlightRegex?: RegExp;
  /** Called for clicks on mentions; it receives the `data-mention-*` attributes. */
  handleMentionClick?: MouseEventHandler<HTMLElement>;
  /** Whether media is fetched with authentication (MSC3916). */
  useAuthentication?: boolean;
  /** Whether links show the icon of their site. */
  showLinkFavicons?: boolean;
  /**
   * Whether an image with an `https:` source shows as it is, for HTML whose sanitizer already
   * decided which such images load (a plugin's `imageSource`); otherwise only `mxc:` images show.
   */
  httpsImages?: boolean;
  /**
   * False for HTML that did not come from Matrix (a plugin's text from elsewhere): an `mxc:` image
   * then shows as its alt text, so the text's author cannot make the viewer's homeserver fetch
   * media. Unless false, `mxc:` images show, as in a message.
   */
  mxcImages?: boolean;
};

/** Parser options that render message HTML in a room (`roomId`, for member names). */
/** A `<span>` or `<div>` with `data-mx-maths`, which the MindRoom renderers typeset with KaTeX. */
const isMatrixMath = (name: string, attribs: Record<string, string>): boolean =>
  (name === 'span' || name === 'div') && typeof attribs['data-mx-maths'] === 'string';

/** The MindRoom rendering of an element, if it has one; Matrix math typesets once KaTeX loads. */
const renderCustomElement = (
  name: string,
  attribs: Record<string, string>,
  children: ChildNode[],
  options: HTMLReactParserOptions
): ReactElement | undefined =>
  isMatrixMath(name, attribs) ? (
    <WithKatex render={() => renderCustomHtmlElement(name, attribs, children, options) ?? null} />
  ) : (
    renderCustomHtmlElement(name, attribs, children, options)
  );

export const getReactCustomHtmlParser = (
  mx: MatrixClient,
  roomId: string | undefined,
  params: ReactCustomHtmlParserParams
): HTMLReactParserOptions => {
  const parserOptions: HTMLReactParserOptions = {
    replace: (domNode) => {
      if (isText(domNode)) {
        // Whitespace keeps html-react-parser's handling, which drops it inside table structure.
        if (domNode.data.trim() === '' || hasAncestor(domNode, ['code', 'pre'])) return undefined;
        return (
          <>
            {renderTextWithLatex(domNode.data, {
              linkify: !hasAncestor(domNode, ['a']),
              linkifyOpts: params.linkifyOpts,
              highlightRegex: params.highlightRegex,
            })}
          </>
        );
      }
      if (!isTag(domNode)) return undefined;

      const { name, attribs } = domNode;
      const children = domNode.children;

      if (name === 'span' && 'data-mx-spoiler' in attribs) {
        const inner = withoutAttribute(attribs, 'data-mx-spoiler');
        return (
          <Spoiler reason={attribs['data-mx-spoiler'] || undefined}>
            {renderCustomElement(name, inner, children, parserOptions) ??
              domToReact(children as DOMNode[], parserOptions)}
          </Spoiler>
        );
      }

      const customElement = renderCustomElement(name, attribs, children, parserOptions);
      if (customElement) return customElement;

      const props = attributesToProps(attribs);
      if (isHeading(name)) {
        return (
          <Text
            {...props}
            as={name}
            size={HEADING_SIZES[name]}
            className={classNames(css.Heading, css.MarginSpaced, props.className)}
          >
            {domToReact(children as DOMNode[], parserOptions)}
          </Text>
        );
      }

      switch (name) {
        case 'p':
          return (
            <p {...props} className={classNames(css.Paragraph, css.MarginSpaced, props.className)}>
              {domToReact(children as DOMNode[], parserOptions)}
            </p>
          );
        case 'blockquote': {
          const callout = hasAncestor(domNode, ['blockquote', 'li'])
            ? undefined
            : extractCallout(children);
          if (callout) {
            const calloutProps = attributesToProps(withoutAttribute(attribs, 'cite'));
            const { highlightRegex } = params;
            return (
              <Callout
                {...calloutProps}
                type={callout.type}
                className={classNames(css.MarginSpaced, calloutProps.className)}
                renderTitle={
                  highlightRegex
                    ? (title) => {
                        if (hasNonEmptyMatch(title, highlightRegex)) {
                          return renderStyledText(title, highlightRegex);
                        }
                        if (
                          hasNonEmptyMatch(`[!${callout.type}]`, highlightRegex) ||
                          hasNonEmptyMatch(`[!${callout.type.toUpperCase()}]`, highlightRegex)
                        ) {
                          return <span className={css.highlightText}>{title}</span>;
                        }
                        return title;
                      }
                    : undefined
                }
              >
                {callout.bodyNodes.length > 0
                  ? domToReact(callout.bodyNodes as DOMNode[], parserOptions)
                  : undefined}
              </Callout>
            );
          }
          return (
            <blockquote
              {...props}
              className={classNames(css.BlockQuote, css.MarginSpaced, props.className)}
            >
              {domToReact(children as DOMNode[], parserOptions)}
            </blockquote>
          );
        }
        case 'ul': {
          const taskList = isTaskList(children);
          return (
            <ul
              {...props}
              {...(taskList ? { role: 'list' } : undefined)}
              className={classNames(css.List, taskList && taskListCss.TaskList, props.className)}
            >
              {domToReact(children as DOMNode[], parserOptions)}
            </ul>
          );
        }
        case 'ol':
          return (
            <ol {...props} className={classNames(css.List, props.className)}>
              {domToReact(children as DOMNode[], parserOptions)}
            </ol>
          );
        case 'li': {
          const footnoteId = isFootnoteId(attribs.id) ? attribs.id : undefined;
          if (footnoteId || hasClass(attribs.class, 'footnote-item')) {
            const { id: _rawId, ...restProps } = props;
            return (
              <FootnoteItem
                {...restProps}
                footnoteId={footnoteId}
                className={classNames(footnoteCss.FootnoteItem, restProps.className)}
              >
                {domToReact(children as DOMNode[], parserOptions)}
              </FootnoteItem>
            );
          }
          if (domNode.parent && isTag(domNode.parent) && domNode.parent.name === 'ul') {
            const task = extractTaskListItem(children);
            if (task) {
              const highlightMarker =
                params.highlightRegex !== undefined &&
                hasNonEmptyMatch(task.marker, params.highlightRegex);
              return (
                <TaskListItem {...props} checked={task.checked} highlightMarker={highlightMarker}>
                  {domToReact(task.bodyNodes as DOMNode[], parserOptions)}
                </TaskListItem>
              );
            }
          }
          return undefined;
        }
        case 'sup':
          if (hasClass(attribs.class, 'footnote-ref')) {
            return (
              <sup {...props} className={classNames(footnoteCss.FootnoteRef, props.className)}>
                {domToReact(children as DOMNode[], parserOptions)}
              </sup>
            );
          }
          return undefined;
        case 'hr':
          if (hasClass(attribs.class, 'footnotes-sep')) {
            return (
              <hr {...props} className={classNames(footnoteCss.FootnotesSep, props.className)} />
            );
          }
          return undefined;
        case 'section':
          if (hasClass(attribs.class, 'footnotes')) {
            return (
              <section {...props} className={classNames(footnoteCss.Footnotes, props.className)}>
                {domToReact(children as DOMNode[], parserOptions)}
              </section>
            );
          }
          return undefined;
        case 'pre':
          return (
            <CodeBlock opts={parserOptions} highlightRegex={params.highlightRegex}>
              {children}
            </CodeBlock>
          );
        case 'code':
          return (
            <code {...props} className={classNames(css.Code, props.className)}>
              {renderStyledText(
                revealDirectionControls(textContent(children)),
                params.highlightRegex
              )}
            </code>
          );
        case 'a': {
          const { href } = attribs;
          stripLinkTextBidi(children);
          if (isFootnoteHref(href)) {
            const isBackref = hasClass(attribs.class, 'footnote-backref');
            const { id: _rawId, target: _target, rel: _rel, ...restProps } = props;
            // Keep plain backref text (U+21A9 U+FE0E) intact so emoji scaling does not split U+FE0E.
            const linkContent =
              isBackref && children.every(isText)
                ? textContent(children)
                : domToReact(children as DOMNode[], parserOptions);
            return (
              <FootnoteLink
                {...restProps}
                href={href}
                footnoteId={isFootnoteId(attribs.id) ? attribs.id : undefined}
                backref={isBackref}
                className={classNames(
                  isBackref ? footnoteCss.FootnoteBackref : footnoteCss.FootnoteRefLink,
                  restProps.className
                )}
              >
                {linkContent}
              </FootnoteLink>
            );
          }
          const content = domToReact(children as DOMNode[], parserOptions);
          const hasSpoiler = containsSpoiler(children);
          if (href && testMatrixTo(href)) {
            const trimmedText = textContent(children).trim();
            // A link whose text is its own URL has nothing to say beyond where it leads,
            // unless a spoiler hides it.
            const ownText = trimmedText !== href || hasSpoiler;
            const keepRoomLabel =
              ownText &&
              ('data-md' in attribs ||
                hasSpoiler ||
                (!href.startsWith('https://matrix.to/') &&
                  (!children.every(isText) || !/^[#!]/.test(trimmedText))));
            const mention = renderMatrixMention(
              mx,
              roomId,
              href,
              makeMentionCustomProps(params.handleMentionClick),
              ownText ? content : undefined,
              keepRoomLabel
            );
            if (mention) return mention;
          }
          const { id: _rawId, ...linkProps } = props;
          return (
            <CheckedMessageLink
              {...linkProps}
              showFavicon={!!params.showLinkFavicons && !hasSpoiler}
            >
              {content}
            </CheckedMessageLink>
          );
        }
        case 'img': {
          const { src, alt, title } = attribs;
          // Matrix message HTML may only show images from the homeserver (mxc: URIs).
          if (!src?.startsWith('mxc://')) {
            return params.httpsImages && src?.startsWith('https://') ? undefined : <>{alt ?? ''}</>;
          }
          if (params.mxcImages === false) return <>{alt ?? ''}</>;
          const url = mxcUrlToHttp(mx, src, params.useAuthentication) ?? src;
          if ('data-mx-emoticon' in attribs) {
            return (
              <span className={css.EmoticonBase}>
                <InlineImage
                  client={mx}
                  mxcUri={src}
                  src={url}
                  alt={alt ?? title ?? ''}
                  title={title ?? alt}
                  kind="emoticon"
                />
              </span>
            );
          }
          return (
            <InlineImage
              {...props}
              client={mx}
              mxcUri={src}
              src={url}
              alt={alt ?? ''}
              kind={hasAncestor(domNode, ['a']) ? 'linked' : 'standalone'}
            />
          );
        }
        default:
          return undefined;
      }
    },
    // Wrap <details> in transform rather than replace so outer option wrappers (such as tool-trace
    // marker parsing in HtmlBlocks.tsx) still process children inside <details>.
    transform: (reactNode, domNode) => {
      if (
        isTag(domNode) &&
        domNode.name === 'details' &&
        React.isValidElement<ComponentPropsWithoutRef<'details'>>(reactNode) &&
        reactNode.type === 'details'
      ) {
        return <RevealDetails key={reactNode.key} {...reactNode.props} />;
      }
      return reactNode as JSX.Element | string | null;
    },
  };
  return parserOptions;
};
