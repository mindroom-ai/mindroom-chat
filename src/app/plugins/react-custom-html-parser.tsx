/* eslint-disable jsx-a11y/alt-text */
import React, {
  ComponentPropsWithoutRef,
  ReactEventHandler,
  Suspense,
  lazy,
  useMemo,
  useState,
} from 'react';
import {
  Element,
  Text as DOMText,
  HTMLReactParserOptions,
  attributesToProps,
  domToReact,
} from 'html-react-parser';
import { MatrixClient } from 'matrix-js-sdk';
import classNames from 'classnames';
import {
  Box,
  Chip,
  Spinner,
  config,
  Header,
  Icon,
  IconButton,
  IconSrc,
  Icons,
  Scroll,
  Text,
  toRem,
} from 'folds';
import { IntermediateRepresentation, Opts as LinkifyOpts, OptFn } from 'linkifyjs';
import Linkify from 'linkify-react';
import { ErrorBoundary } from 'react-error-boundary';
import { ChildNode } from 'domhandler';
import * as css from '../styles/CustomHtml.css';
import { parseMindroomToolBlock } from '../components/message/mindroomBlocks';
import {
  getMxIdLocalPart,
  getCanonicalAliasRoomId,
  isRoomAlias,
  mxcUrlToHttp,
} from '../utils/matrix';
import { getMemberDisplayName } from '../utils/room';
import { EMOJI_PATTERN, sanitizeForRegex, URL_NEG_LB } from '../utils/regex';
import { getHexcodeForEmoji, getShortcodeFor } from './emoji';
import { findAndReplace } from '../utils/findAndReplace';
import {
  parseMatrixToRoom,
  parseMatrixToRoomEvent,
  parseMatrixToUser,
  testMatrixTo,
} from './matrix-to';
import { onEnterOrSpace } from '../utils/keyboard';
import { copyToClipboard, tryDecodeURIComponent } from '../utils/dom';
import { useTimeoutToggle } from '../hooks/useTimeoutToggle';

const ReactPrism = lazy(() => import('./react-prism/ReactPrism'));

const EMOJI_REG_G = new RegExp(`${URL_NEG_LB}(${EMOJI_PATTERN})`, 'g');

export const LINKIFY_OPTS: LinkifyOpts = {
  attributes: {
    target: '_blank',
    rel: 'noreferrer noopener',
  },
  validate: {
    url: (value) => /^(https|http|ftp|mailto|magnet)?:/.test(value),
  },
  ignoreTags: ['span'],
};

export const makeMentionCustomProps = (
  handleMentionClick?: ReactEventHandler<HTMLElement>,
  content?: string
): ComponentPropsWithoutRef<'a'> => ({
  style: { cursor: 'pointer' },
  target: '_blank',
  rel: 'noreferrer noopener',
  role: 'link',
  tabIndex: handleMentionClick ? 0 : -1,
  onKeyDown: handleMentionClick ? onEnterOrSpace(handleMentionClick) : undefined,
  onClick: handleMentionClick,
  children: content,
});

export const renderMatrixMention = (
  mx: MatrixClient,
  currentRoomId: string | undefined,
  href: string,
  customProps: ComponentPropsWithoutRef<'a'>
) => {
  const userId = parseMatrixToUser(href);
  if (userId) {
    const currentRoom = mx.getRoom(currentRoomId);

    return (
      <a
        href={href}
        {...customProps}
        className={css.Mention({ highlight: mx.getUserId() === userId })}
        data-mention-id={userId}
      >
        {`@${
          (currentRoom && getMemberDisplayName(currentRoom, userId)) ?? getMxIdLocalPart(userId)
        }`}
      </a>
    );
  }

  const matrixToRoom = parseMatrixToRoom(href);
  if (matrixToRoom) {
    const { roomIdOrAlias, viaServers } = matrixToRoom;
    const mentionRoom = mx.getRoom(
      isRoomAlias(roomIdOrAlias) ? getCanonicalAliasRoomId(mx, roomIdOrAlias) : roomIdOrAlias
    );

    const fallbackContent = mentionRoom ? `#${mentionRoom.name}` : roomIdOrAlias;

    return (
      <a
        href={href}
        {...customProps}
        className={css.Mention({
          highlight: currentRoomId === (mentionRoom?.roomId ?? roomIdOrAlias),
        })}
        data-mention-id={mentionRoom?.roomId ?? roomIdOrAlias}
        data-mention-via={viaServers?.join(',')}
      >
        {customProps.children ? customProps.children : fallbackContent}
      </a>
    );
  }

  const matrixToRoomEvent = parseMatrixToRoomEvent(href);
  if (matrixToRoomEvent) {
    const { roomIdOrAlias, eventId, viaServers } = matrixToRoomEvent;
    const mentionRoom = mx.getRoom(
      isRoomAlias(roomIdOrAlias) ? getCanonicalAliasRoomId(mx, roomIdOrAlias) : roomIdOrAlias
    );

    return (
      <a
        href={href}
        {...customProps}
        className={css.Mention({
          highlight: currentRoomId === (mentionRoom?.roomId ?? roomIdOrAlias),
        })}
        data-mention-id={mentionRoom?.roomId ?? roomIdOrAlias}
        data-mention-event-id={eventId}
        data-mention-via={viaServers?.join(',')}
      >
        {customProps.children
          ? customProps.children
          : `Message: ${mentionRoom ? `#${mentionRoom.name}` : roomIdOrAlias}`}
      </a>
    );
  }

  return undefined;
};

export const factoryRenderLinkifyWithMention = (
  mentionRender: (href: string) => JSX.Element | undefined
): OptFn<(ir: IntermediateRepresentation) => any> => {
  const render: OptFn<(ir: IntermediateRepresentation) => any> = ({
    tagName,
    attributes,
    content,
  }) => {
    if (tagName === 'a' && testMatrixTo(tryDecodeURIComponent(attributes.href))) {
      const mention = mentionRender(tryDecodeURIComponent(attributes.href));
      if (mention) return mention;
    }

    return <a {...attributes}>{content}</a>;
  };
  return render;
};

export const scaleSystemEmoji = (text: string): (string | JSX.Element)[] =>
  findAndReplace(
    text,
    EMOJI_REG_G,
    (match, pushIndex) => (
      <span key={`scaleSystemEmoji-${pushIndex}`} className={css.EmoticonBase}>
        <span className={css.Emoticon()} title={getShortcodeFor(getHexcodeForEmoji(match[0]))}>
          {match[0]}
        </span>
      </span>
    ),
    (txt) => txt
  );

export const makeHighlightRegex = (highlights: string[]): RegExp | undefined => {
  const pattern = highlights.map(sanitizeForRegex).join('|');
  if (!pattern) return undefined;
  return new RegExp(pattern, 'gi');
};

export const highlightText = (
  regex: RegExp,
  data: (string | JSX.Element)[]
): (string | JSX.Element)[] =>
  data.flatMap((text) => {
    if (typeof text !== 'string') return text;

    return findAndReplace(
      text,
      regex,
      (match, pushIndex) => (
        <span key={`highlight-${pushIndex}`} className={css.highlightText}>
          {match[0]}
        </span>
      ),
      (txt) => txt
    );
  });

/**
 * Recursively extracts and concatenates all text content from an array of ChildNode objects.
 *
 * @param {ChildNode[]} nodes - An array of ChildNode objects to extract text from.
 * @returns {string} The concatenated plain text content of all descendant text nodes.
 */
const extractTextFromChildren = (nodes: ChildNode[]): string => {
  let text = '';

  nodes.forEach((node) => {
    if (node.type === 'text') {
      text += node.data;
    } else if (node instanceof Element && node.children) {
      text += extractTextFromChildren(node.children);
    }
  });

  return text;
};

export function CodeBlock({
  children,
  opts,
}: {
  children: ChildNode[];
  opts: HTMLReactParserOptions;
}) {
  const code = children[0];
  const languageClass =
    code instanceof Element && code.name === 'code' ? code.attribs.class : undefined;
  const language =
    languageClass && languageClass.startsWith('language-')
      ? languageClass.replace('language-', '')
      : languageClass;

  const LINE_LIMIT = 14;
  const largeCodeBlock = useMemo(
    () => extractTextFromChildren(children).split('\n').length > LINE_LIMIT,
    [children]
  );

  const [expanded, setExpand] = useState(false);
  const [copied, setCopied] = useTimeoutToggle();

  const handleCopy = () => {
    copyToClipboard(extractTextFromChildren(children));
    setCopied();
  };

  const toggleExpand = () => {
    setExpand(!expanded);
  };

  return (
    <Text size="T300" as="pre" className={css.CodeBlock}>
      <Header variant="Surface" size="400" className={css.CodeBlockHeader}>
        <Box grow="Yes">
          <Text size="L400" truncate>
            {language ?? 'Code'}
          </Text>
        </Box>
        <Box shrink="No" gap="200">
          <Chip
            variant={copied ? 'Success' : 'Surface'}
            fill="None"
            radii="Pill"
            onClick={handleCopy}
            before={copied && <Icon size="50" src={Icons.Check} />}
          >
            <Text size="B300">{copied ? 'Copied' : 'Copy'}</Text>
          </Chip>
          {largeCodeBlock && (
            <IconButton
              size="300"
              variant="SurfaceVariant"
              outlined
              radii="300"
              onClick={toggleExpand}
              aria-label={expanded ? 'Collapse' : 'Expand'}
            >
              <Icon size="50" src={expanded ? Icons.ChevronTop : Icons.ChevronBottom} />
            </IconButton>
          )}
        </Box>
      </Header>
      <Scroll
        style={{
          maxHeight: largeCodeBlock && !expanded ? toRem(300) : undefined,
          paddingBottom: largeCodeBlock ? config.space.S400 : undefined,
        }}
        direction="Both"
        variant="SurfaceVariant"
        size="300"
        visibility="Hover"
        hideTrack
      >
        <div id="code-block-content" className={css.CodeBlockInternal}>
          {domToReact(children, opts)}
        </div>
      </Scroll>
      {largeCodeBlock && !expanded && <Box className={css.CodeBlockBottomShadow} />}
    </Text>
  );
}

type MindroomTagName = 'tool' | 'tool-group' | 'think' | 'debug' | 'system' | 'plan' | 'analysis' | 'research';

const MINDROOM_BLOCK_META: Record<
  Exclude<MindroomTagName, 'tool-group'>,
  { label: string; icon: IconSrc }
> = {
  tool: {
    label: 'Tool',
    icon: Icons.Terminal,
  },
  think: {
    label: 'AI Thinking Process',
    icon: Icons.Bulb,
  },
  debug: {
    label: 'Debug Information',
    icon: Icons.Code,
  },
  system: {
    label: 'System Processing',
    icon: Icons.Server,
  },
  plan: {
    label: 'Planning & Strategy',
    icon: Icons.OrderList,
  },
  analysis: {
    label: 'Analysis & Evaluation',
    icon: Icons.Search,
  },
  research: {
    label: 'Research & Sources',
    icon: Icons.Explore,
  },
};

const ToolStatusBadge = ({ pending }: { pending: boolean }) =>
  pending ? (
    <Spinner size="100" variant="Secondary" />
  ) : (
    <Icon size="50" src={Icons.Check} />
  );

function MindroomCollapsibleBlock({
  icon,
  label,
  subtitle,
  pending,
  inlineResult,
  children,
}: {
  icon: IconSrc;
  label: string;
  subtitle?: string;
  pending?: boolean;
  inlineResult?: string;
  children?: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Text as="div" size="T300" className={css.MindroomBlock}>
      <button type="button" className={css.MindroomBlockHeader} onClick={() => setExpanded((v) => !v)}>
        <Box grow="Yes" className={css.MindroomBlockHeaderMeta}>
          <Icon size="50" src={icon} />
          {pending !== undefined && <ToolStatusBadge pending={pending} />}
          <Text size="L400" truncate>
            {label}
          </Text>
          {subtitle && (
            <Text size="T200" truncate>
              {subtitle}
            </Text>
          )}
          {inlineResult && (
            <Text size="T200" truncate className={css.MindroomBlockInlineResult}>
              {'-> '}
              {inlineResult}
            </Text>
          )}
        </Box>
        <Icon size="50" src={expanded ? Icons.ChevronTop : Icons.ChevronBottom} />
      </button>
      {expanded && <Box className={css.MindroomBlockBody}>{children}</Box>}
    </Text>
  );
}

const ToolGroupItem = ({ raw }: { raw: string }) => {
  const parsedTool = parseMindroomToolBlock(raw);
  const showResultBlock = parsedTool.status === 'completed_with_result' && !parsedTool.resultInline;

  return (
    <Box className={css.MindroomToolGroupItem} direction="Column" gap="100">
      <Box alignItems="Center" gap="100">
        <ToolStatusBadge pending={parsedTool.status === 'pending'} />
        <Text size="T300" truncate>
          <code className={css.Code}>{parsedTool.command || 'tool'}</code>
        </Text>
        {parsedTool.status === 'completed_with_result' && parsedTool.resultInline && parsedTool.result && (
          <Text size="T200" truncate className={css.MindroomBlockInlineResult}>
            {'-> '}
            {parsedTool.result}
          </Text>
        )}
      </Box>
      {showResultBlock && parsedTool.result && (
        <Text as="pre" size="T200" className={css.MindroomBlockResult}>
          {parsedTool.result}
        </Text>
      )}
    </Box>
  );
};

export const getReactCustomHtmlParser = (
  mx: MatrixClient,
  roomId: string | undefined,
  params: {
    linkifyOpts: LinkifyOpts;
    highlightRegex?: RegExp;
    handleSpoilerClick?: ReactEventHandler<HTMLElement>;
    handleMentionClick?: ReactEventHandler<HTMLElement>;
    useAuthentication?: boolean;
  }
): HTMLReactParserOptions => {
  const opts: HTMLReactParserOptions = {
    replace: (domNode) => {
      if (domNode instanceof Element && 'name' in domNode) {
        const { name, attribs, children, parent } = domNode;
        const props = attributesToProps(attribs);

        if (name === 'tool-group') {
          const toolChildren = children.filter(
            (child): child is Element => child instanceof Element && child.name === 'tool'
          );
          const nonToolChildren = children.filter(
            (child) => !(child instanceof Element && child.name === 'tool')
          );

          return (
            <MindroomCollapsibleBlock
              icon={Icons.BlockCode}
              label="Tool Group"
              subtitle={`${toolChildren.length} tool call${toolChildren.length === 1 ? '' : 's'}`}
            >
              <Box className={css.MindroomToolGroupList}>
                {toolChildren.map((toolNode, index) => {
                  const rawTool = extractTextFromChildren(toolNode.children);
                  const parsedTool = parseMindroomToolBlock(rawTool);
                  return (
                    <ToolGroupItem
                      key={`tool-group-item-${parsedTool.command || 'tool'}-${index}`}
                      raw={rawTool}
                    />
                  );
                })}
              </Box>
              {nonToolChildren.length > 0 && (
                <Box style={{ marginTop: config.space.S200 }}>{domToReact(nonToolChildren, opts)}</Box>
              )}
            </MindroomCollapsibleBlock>
          );
        }

        if (Object.prototype.hasOwnProperty.call(MINDROOM_BLOCK_META, name)) {
          const blockName = name as Exclude<MindroomTagName, 'tool-group'>;
          const { icon, label } = MINDROOM_BLOCK_META[blockName];

          if (blockName === 'tool') {
            const parsedTool = parseMindroomToolBlock(extractTextFromChildren(children));
            const showResultBlock =
              parsedTool.status === 'completed_with_result' && !parsedTool.resultInline;
            const inlineResult =
              parsedTool.status === 'completed_with_result' && parsedTool.resultInline
                ? parsedTool.result
                : undefined;

            return (
              <MindroomCollapsibleBlock
                icon={icon}
                label={label}
                subtitle={parsedTool.command || 'tool'}
                pending={parsedTool.status === 'pending'}
                inlineResult={inlineResult}
              >
                {showResultBlock && parsedTool.result && (
                  <Text as="pre" size="T200" className={css.MindroomBlockResult}>
                    {parsedTool.result}
                  </Text>
                )}
              </MindroomCollapsibleBlock>
            );
          }

          return (
            <MindroomCollapsibleBlock icon={icon} label={label}>
              {domToReact(children, opts)}
            </MindroomCollapsibleBlock>
          );
        }

        if (name === 'h1') {
          return (
            <Text {...props} className={css.Heading} size="H2">
              {domToReact(children, opts)}
            </Text>
          );
        }

        if (name === 'h2') {
          return (
            <Text {...props} className={css.Heading} size="H3">
              {domToReact(children, opts)}
            </Text>
          );
        }

        if (name === 'h3') {
          return (
            <Text {...props} className={css.Heading} size="H4">
              {domToReact(children, opts)}
            </Text>
          );
        }

        if (name === 'h4') {
          return (
            <Text {...props} className={css.Heading} size="H4">
              {domToReact(children, opts)}
            </Text>
          );
        }

        if (name === 'h5') {
          return (
            <Text {...props} className={css.Heading} size="H5">
              {domToReact(children, opts)}
            </Text>
          );
        }

        if (name === 'h6') {
          return (
            <Text {...props} className={css.Heading} size="H6">
              {domToReact(children, opts)}
            </Text>
          );
        }

        if (name === 'p') {
          return (
            <Text {...props} className={classNames(css.Paragraph, css.MarginSpaced)} size="Inherit">
              {domToReact(children, opts)}
            </Text>
          );
        }

        if (name === 'pre') {
          return <CodeBlock opts={opts}>{children}</CodeBlock>;
        }

        if (name === 'blockquote') {
          return (
            <Text {...props} size="Inherit" as="blockquote" className={css.BlockQuote}>
              {domToReact(children, opts)}
            </Text>
          );
        }

        if (name === 'ul') {
          return (
            <ul {...props} className={css.List}>
              {domToReact(children, opts)}
            </ul>
          );
        }
        if (name === 'ol') {
          return (
            <ol {...props} className={css.List}>
              {domToReact(children, opts)}
            </ol>
          );
        }

        if (name === 'code') {
          if (parent && 'name' in parent && parent.name === 'pre') {
            const codeReact = domToReact(children, opts);
            if (typeof codeReact === 'string') {
              let lang = props.className;
              if (lang === 'language-rs') lang = 'language-rust';
              else if (lang === 'language-js') lang = 'language-javascript';
              else if (lang === 'language-ts') lang = 'language-typescript';
              return (
                <ErrorBoundary fallback={<code {...props}>{codeReact}</code>}>
                  <Suspense fallback={<code {...props}>{codeReact}</code>}>
                    <ReactPrism>
                      {(ref) => (
                        <code ref={ref} {...props} className={lang}>
                          {codeReact}
                        </code>
                      )}
                    </ReactPrism>
                  </Suspense>
                </ErrorBoundary>
              );
            }
          } else {
            return (
              <Text as="code" size="T300" className={css.Code} {...props}>
                {domToReact(children, opts)}
              </Text>
            );
          }
        }

        if (name === 'a' && testMatrixTo(tryDecodeURIComponent(props.href))) {
          const content = children.find((child) => !(child instanceof DOMText))
            ? undefined
            : children.map((c) => (c instanceof DOMText ? c.data : '')).join();

          const mention = renderMatrixMention(
            mx,
            roomId,
            tryDecodeURIComponent(props.href),
            makeMentionCustomProps(params.handleMentionClick, content)
          );

          if (mention) return mention;
        }

        if (name === 'span' && 'data-mx-spoiler' in props) {
          return (
            <span
              {...props}
              role="button"
              tabIndex={params.handleSpoilerClick ? 0 : -1}
              onKeyDown={params.handleSpoilerClick}
              onClick={params.handleSpoilerClick}
              className={css.Spoiler()}
              aria-pressed
              style={{ cursor: 'pointer' }}
            >
              {domToReact(children, opts)}
            </span>
          );
        }

        if (name === 'img') {
          const htmlSrc = mxcUrlToHttp(mx, props.src, params.useAuthentication);
          if (htmlSrc && props.src.startsWith('mxc://') === false) {
            return (
              <a href={htmlSrc} target="_blank" rel="noreferrer noopener">
                {props.alt || props.title || htmlSrc}
              </a>
            );
          }
          if (htmlSrc && 'data-mx-emoticon' in props) {
            return (
              <span className={css.EmoticonBase}>
                <span className={css.Emoticon()}>
                  <img {...props} className={css.EmoticonImg} src={htmlSrc} />
                </span>
              </span>
            );
          }
          if (htmlSrc) return <img {...props} className={css.Img} src={htmlSrc} />;
        }
      }

      if (domNode instanceof DOMText) {
        const linkify =
          !(domNode.parent && 'name' in domNode.parent && domNode.parent.name === 'code') &&
          !(domNode.parent && 'name' in domNode.parent && domNode.parent.name === 'a');

        let jsx = scaleSystemEmoji(domNode.data);

        if (params.highlightRegex) {
          jsx = highlightText(params.highlightRegex, jsx);
        }

        if (linkify) {
          return <Linkify options={params.linkifyOpts}>{jsx}</Linkify>;
        }
        return jsx;
      }
      return undefined;
    },
  };
  return opts;
};
