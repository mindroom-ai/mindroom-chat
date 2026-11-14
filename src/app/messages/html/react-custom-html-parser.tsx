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
} from 'react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { HTMLReactParserOptions, attributesToProps, domToReact } from 'html-react-parser';
import { isTag, isText } from 'domhandler';
import type { ChildNode, Element } from 'domhandler';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import type { IntermediateRepresentation, Opts as LinkifyOpts } from 'linkifyjs';
import { Text } from 'folds';
import { ErrorBoundary } from 'react-error-boundary';
import * as css from '../../rich-text/CustomHtml.css';
import { renderCustomHtmlElement } from './customHtmlRenderers';
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
import { LinkFaviconContext } from '../../rich-text/MessageLink';
import { CheckedMessageLink } from '../../rich-text/CheckedMessageLink';
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
 * Mentions carry the ID in `data-mention-id` and an event in `data-mention-event-id`, for the
 * mention click handler. A user or room mention reads in its own direction (`dir="auto"`), so a
 * Matrix ID inside right-to-left text keeps its `@` or `#` in front. Undefined for other links.
 */
export const renderMatrixMention = (
  client: MatrixClient,
  viewedRoomId: string | undefined,
  href: string,
  customProps: ComponentPropsWithoutRef<'a'>,
  content?: ReactNode
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
  replace: (node) => {
    if (!isText(node)) return opts.replace?.(node);
    const shown = revealDirectionControls(node.data);
    return shown === node.data ? opts.replace?.(node) : <>{shown}</>;
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
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>();
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
        {domToReact(children, revealingText(opts))}
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

  return (
    <pre className={classNames(css.CodeBlock, css.MarginSpaced)} data-wrap={wrap}>
      <div className={css.CodeBlockHeader}>
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
        <div
          className={css.CodeBlockActions}
          role="group"
          aria-label={t('messageCodeBlock.actions')}
          data-code-block-actions=""
        >
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
              type="button"
              className={css.CodeBlockAction}
              aria-label={expanded ? t('messageCodeBlock.collapse') : t('messageCodeBlock.expand')}
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? <CollapseIcon /> : <ExpandIcon />}
            </button>
          )}
          <button
            type="button"
            className={css.CodeBlockAction}
            aria-label={copied ? t('messageCodeBlock.copied') : t('messageCodeBlock.copy')}
            onClick={() => void copy()}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </button>
        </div>
      </div>
      {/* Native scroll areas need a tab stop for keyboard scrolling. */}
      {/* eslint-disable jsx-a11y/no-noninteractive-tabindex */}
      <div
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
    </pre>
  );
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
      <LinkFaviconContext.Provider value={false}>{children}</LinkFaviconContext.Provider>
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
              domToReact(children, parserOptions)}
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
            {domToReact(children, parserOptions)}
          </Text>
        );
      }

      switch (name) {
        case 'p':
          return (
            <p {...props} className={classNames(css.Paragraph, css.MarginSpaced, props.className)}>
              {domToReact(children, parserOptions)}
            </p>
          );
        case 'blockquote':
          return (
            <blockquote
              {...props}
              className={classNames(css.BlockQuote, css.MarginSpaced, props.className)}
            >
              {domToReact(children, parserOptions)}
            </blockquote>
          );
        case 'ul':
          return (
            <ul {...props} className={classNames(css.List, css.MarginSpaced, props.className)}>
              {domToReact(children, parserOptions)}
            </ul>
          );
        case 'ol':
          return (
            <ol {...props} className={classNames(css.List, css.MarginSpaced, props.className)}>
              {domToReact(children, parserOptions)}
            </ol>
          );
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
          const content = domToReact(children, parserOptions);
          if (href && testMatrixTo(href)) {
            // A link whose text is its own URL has nothing to say beyond where it leads.
            const ownText = textContent(children).trim() !== href;
            const mention = renderMatrixMention(
              mx,
              roomId,
              href,
              makeMentionCustomProps(params.handleMentionClick),
              ownText ? content : undefined
            );
            if (mention) return mention;
          }
          return (
            <CheckedMessageLink
              {...props}
              showFavicon={!!params.showLinkFavicons && !containsSpoiler(children)}
            >
              {content}
            </CheckedMessageLink>
          );
        }
        case 'img': {
          const { src, alt, title } = attribs;
          // Matrix message HTML may only show images from the homeserver (mxc: URIs).
          if (!src?.startsWith('mxc://')) return <>{alt ?? ''}</>;
          const url = mxcUrlToHttp(mx, src, params.useAuthentication) ?? src;
          if ('data-mx-emoticon' in attribs) {
            return (
              <span className={css.EmoticonBase}>
                <img
                  className={css.Emoticon()}
                  src={url}
                  alt={alt ?? title ?? ''}
                  title={title ?? alt}
                  loading="lazy"
                />
              </span>
            );
          }
          return <img {...props} src={url} alt={alt ?? ''} loading="lazy" />;
        }
        default:
          return undefined;
      }
    },
  };
  return parserOptions;
};
