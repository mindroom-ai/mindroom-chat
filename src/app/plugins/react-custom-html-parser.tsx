import React, {
  ComponentPropsWithoutRef,
  KeyboardEvent,
  MouseEventHandler,
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
import type { MatrixClient } from 'matrix-js-sdk';
import type { IntermediateRepresentation, Opts as LinkifyOpts } from 'linkifyjs';
import { Text } from 'folds';
import { ErrorBoundary } from 'react-error-boundary';
import * as css from '../styles/CustomHtml.css';
import { renderMindroomCustomHtmlElement } from '../mindroom/html/customHtmlRenderers';
import { renderTextWithMatrixMath } from '../mindroom/html/matrixMath';
import {
  CheckIcon,
  CodeBlockLanguageIcon,
  CollapseIcon,
  CopyIcon,
  ExpandIcon,
  WrapTextIcon,
} from '../mindroom/html/CodeBlockIcons';
import {
  getCodeBlockLanguage,
  getCodeBlockLanguageIconToken,
} from '../mindroom/html/codeBlockLanguage';
import { LinkFaviconContext, MessageLink } from '../mindroom/messages/MessageLink';
import { containsSpoiler } from '../mindroom/messages/linkFaviconPolicy';
import { copyToClipboard } from '../utils/dom';
import { getCanonicalAliasRoomId } from '../utils/matrix';
import { mxcUrlToHttp } from '../utils/mediaUrl';
import { EMOJI_PATTERN, createInsideUrlTest } from '../utils/regex';
import { getMemberDisplayName } from '../utils/room';
import { PrismCode } from './react-prism/ReactPrism';
import {
  parseMatrixToRoom,
  parseMatrixToRoomEvent,
  parseMatrixToUser,
  testMatrixTo,
} from './matrix-to';

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
 * URLs linked (unless `linkify` is false). Text in backticks stays as written.
 */
export const renderTextWithLatex = (
  text: string,
  params: {
    linkify?: boolean;
    linkifyOpts?: LinkifyOpts;
    highlightRegex?: RegExp;
    keyPrefix?: string;
  }
): ReactNode => renderTextWithMatrixMath(text, { ...params, renderStyledText });

/** Props for a mention link: it opens in a new tab unless the click handler handles it. */
export const makeMentionCustomProps = (
  handleMentionClick?: MouseEventHandler<HTMLElement>
): ComponentPropsWithoutRef<'a'> => ({ ...NEW_TAB_LINK, onClick: handleMentionClick });

const roomName = (mx: MatrixClient, roomIdOrAlias: string): string => {
  const roomId = roomIdOrAlias.startsWith('#')
    ? getCanonicalAliasRoomId(mx, roomIdOrAlias)
    : roomIdOrAlias;
  const room = roomId ? mx.getRoom(roomId) : undefined;
  return room?.name ? `#${room.name}` : roomIdOrAlias;
};

/**
 * A Matrix permalink as a mention: a user as `@display name` (the name in `viewedRoomId`), a
 * room as `#room name`, and a link to an event as a link that keeps its text (`content`, else
 * the URL) but opens the event. Mentions carry the ID in `data-mention-id` and an event in
 * `data-mention-event-id`, for the mention click handler. Undefined for other links.
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
    const name = room ? getMemberDisplayName(room, userId) : undefined;
    return (
      <a
        {...customProps}
        href={href}
        className={classNames(
          css.Mention({ highlight: client.getUserId() === userId }),
          customProps.className
        )}
        data-mention-id={userId}
      >
        {name ? `@${name}` : userId}
      </a>
    );
  }

  const eventLink = parseMatrixToRoomEvent(href);
  if (eventLink) {
    return (
      <a
        href={href}
        {...customProps}
        data-mention-id={eventLink.roomIdOrAlias}
        data-mention-event-id={eventLink.eventId}
        data-mention-via={eventLink.viaServers?.join(',') || undefined}
      >
        {content ?? href}
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
      <MessageLink {...attributesToProps(attributes)} showFavicon={showFavicons}>
        {content}
      </MessageLink>
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
  const code = textContent(codeElement ? codeElement.children : children).replace(/\n$/, '');
  const formatted = !codeElement && opts !== undefined && children.some((child) => isTag(child));
  const searchMatch = highlightRegex !== undefined && toGlobal(highlightRegex).test(code);

  const long = countShownLines(code, wrap) > LONG_CODE_BLOCK_LINES;
  const collapsed = long && !expanded;

  const copy = async () => {
    const done = await copyToClipboard(code);
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
        {domToReact(children, opts)}
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
            onClick={copy}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </button>
        </div>
      </div>
      <div
        className={css.CodeBlockScroll}
        style={
          collapsed
            ? // Collapsed, long lines still scroll sideways when they do not wrap.
              { maxHeight: `${COLLAPSED_LINES * 1.5}em`, overflowY: 'hidden' }
            : { maxHeight: 'none' }
        }
      >
        {body}
        {collapsed && <div className={css.CodeBlockBottomShadow} />}
      </div>
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

export type ReactCustomHtmlParserParams = {
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
      const children = domNode.children as ChildNode[];

      if (name === 'span' && 'data-mx-spoiler' in attribs) {
        const inner = withoutAttribute(attribs, 'data-mx-spoiler');
        return (
          <Spoiler reason={attribs['data-mx-spoiler'] || undefined}>
            {renderMindroomCustomHtmlElement(name, inner, children, parserOptions) ??
              domToReact(children, parserOptions)}
          </Spoiler>
        );
      }

      const mindroomElement = renderMindroomCustomHtmlElement(
        name,
        attribs,
        children,
        parserOptions
      );
      if (mindroomElement) return mindroomElement;

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
              {renderStyledText(textContent(children), params.highlightRegex)}
            </code>
          );
        case 'a': {
          const { href } = attribs;
          const content = domToReact(children, parserOptions);
          if (href && testMatrixTo(href)) {
            const mention = renderMatrixMention(
              mx,
              roomId,
              href,
              makeMentionCustomProps(params.handleMentionClick),
              content
            );
            if (mention) return mention;
          }
          return (
            <MessageLink
              {...props}
              showFavicon={!!params.showLinkFavicons && !containsSpoiler(children)}
            >
              {content}
            </MessageLink>
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
