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
import {
  MindroomToolRefParseResult,
  parseMindroomToolRefHtml,
} from '../components/message/mindroomBlocks';
import {
  MindroomToolTraceEvent,
  getMindroomToolTraceEvents,
  isMindroomToolTraceV2,
} from '../components/message/mindroomToolTrace';
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
import { renderLatexToHtml, tokenizeTextWithLatex, unescapeLatexDelimiters } from './math';
import { onEnterOrSpace } from '../utils/keyboard';
import { copyToClipboard, tryDecodeURIComponent } from '../utils/dom';
import { useTimeoutToggle } from '../hooks/useTimeoutToggle';

const ReactPrism = lazy(() => import('./react-prism/ReactPrism'));

const EMOJI_REG_G = new RegExp(`${URL_NEG_LB}(${EMOJI_PATTERN})`, 'g');
const TABLE_STRUCTURE_TAGS = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr', 'colgroup']);

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

const formatRawLatex = (latex: string, displayMode: boolean): string =>
  displayMode ? `$$${latex}$$` : `$${latex}$`;

const renderStyledText = (text: string, highlightRegex?: RegExp): (string | JSX.Element)[] => {
  let jsx = scaleSystemEmoji(text);

  if (highlightRegex) {
    jsx = highlightText(highlightRegex, jsx);
  }

  return jsx;
};

const MathHtml = ({
  latex,
  displayMode,
  className,
  fallback,
  as = 'span',
}: {
  latex: string;
  displayMode: boolean;
  className: string;
  fallback?: React.ReactNode;
  as?: 'span' | 'div';
}) => {
  const renderedHtml = renderLatexToHtml(latex, displayMode);
  const Tag = as;

  if (renderedHtml === latex) {
    return <Tag className={className}>{fallback ?? formatRawLatex(latex, displayMode)}</Tag>;
  }

  return <Tag className={className} dangerouslySetInnerHTML={{ __html: renderedHtml }} />;
};

export const renderTextWithLatex = (
  text: string,
  params: {
    linkify?: boolean;
    linkifyOpts: LinkifyOpts;
    highlightRegex?: RegExp;
    keyPrefix?: string;
  }
): React.ReactNode => {
  const segments = tokenizeTextWithLatex(text, params.linkifyOpts);
  const hasEscapedDelimiters = segments.some(
    (segment) =>
      segment.type === 'text' &&
      unescapeLatexDelimiters(segment.content) !== segment.content
  );
  const hasMath = segments.some((segment) => segment.type === 'math');
  const hasOnlyPlainText = segments.every((segment) => segment.type === 'text');

  if (hasOnlyPlainText && !hasEscapedDelimiters && !hasMath) {
    const jsx = renderStyledText(text, params.highlightRegex);
    if (params.linkify === false) return jsx;
    return <Linkify options={params.linkifyOpts}>{jsx}</Linkify>;
  }

  return segments
    .map((segment, index) => {
      const key = `${params.keyPrefix ?? 'latex'}-${index}`;

      if (segment.type === 'math') {
        return (
          <MathHtml
            key={key}
            as="span"
            latex={segment.content}
            displayMode={segment.displayMode}
            className={segment.displayMode ? css.MathBlock : css.MathInline}
          />
        );
      }

      const content =
        segment.type === 'text' ? unescapeLatexDelimiters(segment.content) : segment.content;
      if (content === '') return null;

      const jsx = renderStyledText(content, params.highlightRegex);
      if (params.linkify === false || segment.type === 'verbatim') {
        return <React.Fragment key={key}>{jsx}</React.Fragment>;
      }

      return (
        <Linkify key={key} options={params.linkifyOpts}>
          {jsx}
        </Linkify>
      );
    })
    .filter((node) => node !== null);
};

/**
 * Recursively extracts and concatenates all text content from an array of ChildNode objects.
 *
 * @param {ChildNode[]} nodes - An array of ChildNode objects to extract text from.
 * @returns {string} The concatenated plain text content of all descendant text nodes.
 */
const extractTextFromChildren = (nodes: ChildNode[]): string => {
  let text = '';

  nodes.forEach((node) => {
    if (node.type === 'text' && typeof node.data === 'string') {
      text += node.data;
    } else if (Array.isArray((node as { children?: unknown }).children)) {
      text += extractTextFromChildren((node as { children: ChildNode[] }).children);
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

type MindroomTagName = 'think' | 'debug' | 'system' | 'plan' | 'analysis' | 'research';

const MINDROOM_BLOCK_META: Record<MindroomTagName, { label: string; icon: IconSrc }> = {
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

function ToolStatusBadge({ pending }: { pending: boolean }) {
  return pending ? (
    <Spinner size="100" variant="Secondary" />
  ) : (
    <Icon size="50" src={Icons.Check} />
  );
}

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
      <button
        type="button"
        className={css.MindroomBlockHeader}
        onClick={() => setExpanded((v) => !v)}
      >
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

type MindroomToolBlockStatus = 'pending' | 'completed' | 'completed_with_result';

type MindroomToolBlockRenderData = {
  index: number;
  status: MindroomToolBlockStatus;
  command: string;
  result?: string;
  resultInline: boolean;
};

const asToolTraceText = (value: unknown): string | undefined =>
  typeof value === 'string' ? value.trim() || undefined : undefined;

const buildToolRefRenderData = (
  toolRef: MindroomToolRefParseResult,
  eventRaw?: MindroomToolTraceEvent
): MindroomToolBlockRenderData => {
  const traceType = asToolTraceText(eventRaw?.type);
  const traceToolName = asToolTraceText(eventRaw?.tool_name) ?? toolRef.toolName;
  const argsPreview = asToolTraceText(eventRaw?.args_preview);
  const resultPreview = asToolTraceText(eventRaw?.result_preview);
  const command = argsPreview ? `${traceToolName}(${argsPreview})` : traceToolName;

  if (
    traceType === 'tool_call_started' ||
    (traceType !== 'tool_call_completed' && toolRef.pending)
  ) {
    return {
      index: toolRef.index,
      status: 'pending',
      command,
      resultInline: false,
    };
  }

  if (resultPreview) {
    return {
      index: toolRef.index,
      status: 'completed_with_result',
      command,
      result: resultPreview,
      resultInline: !resultPreview.includes('\n'),
    };
  }

  return {
    index: toolRef.index,
    status: 'completed',
    command,
    resultInline: false,
  };
};

const renderMindroomToolRefGroupItem = (parsedTool: MindroomToolBlockRenderData) => {
  const prefix = `Tool #${parsedTool.index}: ${parsedTool.command}`;
  const key = `tool-group-item-${parsedTool.index}-${parsedTool.command}`;

  if (parsedTool.status === 'pending') {
    return (
      <Box key={key} className={css.MindroomToolGroupItem}>
        <Text size="T200">{`${prefix} ⏳`}</Text>
      </Box>
    );
  }

  if (parsedTool.status === 'completed_with_result' && parsedTool.result) {
    return (
      <Box key={key} className={css.MindroomToolGroupItem}>
        <Text size="T200">{prefix}</Text>
        <Text as="pre" size="T200" className={css.MindroomBlockResult}>
          {parsedTool.result}
        </Text>
      </Box>
    );
  }

  return (
    <Box key={key} className={css.MindroomToolGroupItem}>
      <Text size="T200">{`${prefix} ✓`}</Text>
    </Box>
  );
};

const renderMindroomToolRefGroupBlock = (parsedTools: MindroomToolBlockRenderData[]) => {
  const label = parsedTools.length === 1 ? '1 tool call' : `${parsedTools.length} tool calls`;
  const pending = parsedTools.length === 1 ? parsedTools[0].status === 'pending' : undefined;

  return (
    <MindroomCollapsibleBlock icon={Icons.Terminal} label={label} pending={pending}>
      <Box className={css.MindroomToolGroupList}>
        {parsedTools.map((parsedTool) => renderMindroomToolRefGroupItem(parsedTool))}
      </Box>
    </MindroomCollapsibleBlock>
  );
};

type ToolRefElementPrefix = {
  html: string;
  trailingChildren: ChildNode[];
};

type ToolRefMatchBoundary = {
  html: string;
  childIndex: number;
  textSplitIndex: number | undefined;
};

const isDomTextNode = (node: unknown): node is DOMText =>
  typeof node === 'object' &&
  node !== null &&
  typeof (node as { data?: unknown }).data === 'string' &&
  !Array.isArray((node as { children?: unknown }).children);

const isDomElementNode = (node: unknown): node is Element =>
  typeof node === 'object' &&
  node !== null &&
  typeof (node as { name?: unknown }).name === 'string' &&
  Array.isArray((node as { children?: unknown }).children);

const cloneDomChildNode = (node: ChildNode): ChildNode => {
  if (isDomTextNode(node)) {
    return new DOMText(node.data);
  }

  if (isDomElementNode(node)) {
    const clonedChildren = node.children.map((child) => cloneDomChildNode(child as ChildNode));
    return new Element(node.name, { ...node.attribs }, clonedChildren);
  }

  return new DOMText('');
};

const trimLeadingToolRefBoundary = (children: ChildNode[]): ChildNode[] => {
  const remaining = [...children];

  const trimLeadingWhitespaceText = () => {
    while (remaining.length > 0) {
      const first = remaining[0];
      if (!isDomTextNode(first) || first.data.trim()) break;
      remaining.shift();
    }
  };

  trimLeadingWhitespaceText();

  if (remaining.length > 0 && isDomElementNode(remaining[0]) && remaining[0].name === 'br') {
    remaining.shift();
    trimLeadingWhitespaceText();
  }

  return remaining;
};

const normalizeLeadingToolRefBoundaryInPlace = (element: Element): boolean => {
  if (!['p', 'div', 'li'].includes(element.name)) return false;
  const children = element.children as ChildNode[];

  let index = 0;
  while (index < children.length) {
    const child = children[index];
    if (!isDomTextNode(child) || child.data.trim()) break;
    index += 1;
  }

  const leadingChild = children[index];
  const hasLeadingBreak =
    index < children.length && isDomElementNode(leadingChild) && leadingChild.name === 'br';
  if (!hasLeadingBreak) return false;

  const trimmedChildren = trimLeadingToolRefBoundary(children);
  element.children = trimmedChildren;
  return true;
};

const parseToolRefIndexFromTextPrefix = (text: string): number | undefined => {
  const match = /^\s*🔧[\s\S]*?\[(\d+)\](?:\s*⏳)?/u.exec(text);
  if (!match) return undefined;

  const index = Number(match[1]);
  if (!Number.isInteger(index) || index < 1) return undefined;
  return index;
};

const getToolRefPrefixFromElement = (element: Element): ToolRefElementPrefix | undefined => {
  if (!['p', 'div', 'li'].includes(element.name)) return undefined;

  let html = '';
  let bestMatch: ToolRefMatchBoundary | undefined;

  const buildPrefixResult = (match: ToolRefMatchBoundary): ToolRefElementPrefix => {
    const matchedChild = element.children[match.childIndex];
    const trailingText =
      isDomTextNode(matchedChild) && match.textSplitIndex !== undefined
        ? matchedChild.data.slice(match.textSplitIndex)
        : '';
    const trailingChildren = trimLeadingToolRefBoundary([
      ...(trailingText ? [new DOMText(trailingText)] : []),
      ...element.children.slice(match.childIndex + 1),
    ]);

    return {
      html: match.html,
      trailingChildren,
    };
  };

  for (let childIndex = 0; childIndex < element.children.length; childIndex += 1) {
    const child = element.children[childIndex];

    if (isDomTextNode(child)) {
      for (let splitIndex = 0; splitIndex <= child.data.length; splitIndex += 1) {
        const candidate = `${html}${child.data.slice(0, splitIndex)}`;
        if (parseMindroomToolRefHtml(candidate)) {
          // Prefer the longest valid marker prefix (e.g. include optional " ⏳" when present).
          bestMatch = {
            html: candidate,
            childIndex,
            textSplitIndex: splitIndex,
          };
        }
      }

      html += child.data;
    } else if (isDomElementNode(child) && child.name === 'code') {
      html += `<code>${extractTextFromChildren(child.children)}</code>`;

      if (parseMindroomToolRefHtml(html)) {
        bestMatch = {
          html,
          childIndex,
          textSplitIndex: undefined,
        };
      }
    } else if (isDomElementNode(child) && child.name === 'span') {
      html += extractTextFromChildren(child.children);

      if (parseMindroomToolRefHtml(html)) {
        bestMatch = {
          html,
          childIndex,
          textSplitIndex: undefined,
        };
      }
    } else if (bestMatch) {
      return buildPrefixResult(bestMatch);
    } else {
      return undefined;
    }
  }

  if (!bestMatch) return undefined;
  return buildPrefixResult(bestMatch);
};

export const withMindroomToolTraceMarkerParserOptions = (
  baseOpts: HTMLReactParserOptions,
  content: Record<string, unknown>
): HTMLReactParserOptions => {
  if (!isMindroomToolTraceV2(content)) return baseOpts;

  const traceEvents = getMindroomToolTraceEvents(content);
  if (!traceEvents || traceEvents.length === 0) return baseOpts;

  const baseReplace = baseOpts.replace;
  const baseTransform = baseOpts.transform;
  const consumedToolIndexes = new Set<number>();
  const groupRootIndexes = new Set<number>();
  const nextOpts: HTMLReactParserOptions = {
    ...baseOpts,
    replace: (domNode) => {
      const isContainer = isDomElementNode(domNode) && ['p', 'div', 'li'].includes(domNode.name);

      if (isContainer) {
        const maybeChildren = domNode.children;
        const maybeToolIndex = parseToolRefIndexFromTextPrefix(
          extractTextFromChildren(maybeChildren as ChildNode[])
        );
        if (maybeToolIndex !== undefined && consumedToolIndexes.has(maybeToolIndex)) {
          return null;
        }
      }

      if (isDomElementNode(domNode)) {
        type ToolRefItem = {
          data: MindroomToolBlockRenderData;
          trailingElement?: Element;
        };

        const buildItem = (element: Element): ToolRefItem | undefined => {
          const toolRefPrefix = getToolRefPrefixFromElement(element);
          if (!toolRefPrefix) return undefined;

          const toolRef = parseMindroomToolRefHtml(toolRefPrefix.html);
          if (!toolRef) return undefined;

          const data = buildToolRefRenderData(toolRef, traceEvents[toolRef.index - 1]);
          const clonedTrailingChildren = toolRefPrefix.trailingChildren.map((child) =>
            cloneDomChildNode(child)
          );
          const trailingElement =
            clonedTrailingChildren.length > 0
              ? new Element(element.name, { ...element.attribs }, clonedTrailingChildren)
              : undefined;

          return { data, trailingElement };
        };

        // Render only the first marker in a consecutive run; later markers are
        // consumed by the first marker's grouped render.
        let previousSibling: ChildNode | null = domNode.prev;
        while (isDomTextNode(previousSibling) && !previousSibling.data.trim()) {
          previousSibling = previousSibling.prev;
        }
        const previousItem = isDomElementNode(previousSibling)
          ? buildItem(previousSibling)
          : undefined;
        if (previousItem && !previousItem.trailingElement) {
          return null;
        }

        const firstItem = buildItem(domNode);
        if (firstItem) {
          const items: ToolRefItem[] = [firstItem];
          const trailingElements: Element[] = [];
          if (firstItem.trailingElement) trailingElements.push(firstItem.trailingElement);
          let boundaryFollower: Element | undefined;

          // A marker paragraph with trailing content is a narrative boundary.
          // Do not merge across that boundary, otherwise tool ordering appears
          // ahead of the narrative text that introduced each call.
          if (!firstItem.trailingElement) {
            let sibling = domNode.next;
            while (sibling) {
              if (isDomTextNode(sibling) && !sibling.data.trim()) {
                sibling = sibling.next;
                continue;
              }

              if (!isDomElementNode(sibling)) break;

              const item = buildItem(sibling);
              if (!item) {
                boundaryFollower = sibling;
                break;
              }

              items.push(item);
              if (item.trailingElement) {
                trailingElements.push(item.trailingElement);
                break;
              }
              sibling = sibling.next;
            }
          }

          if (boundaryFollower) {
            normalizeLeadingToolRefBoundaryInPlace(boundaryFollower);
          }

          items.forEach((item) => consumedToolIndexes.add(item.data.index));
          groupRootIndexes.add(firstItem.data.index);
          const toolBlock = renderMindroomToolRefGroupBlock(items.map((item) => item.data));
          if (trailingElements.length === 0) return toolBlock;

          return (
            <>
              {toolBlock}
              {domToReact(trailingElements, nextOpts)}
            </>
          );
        }
      }

      return baseReplace ? baseReplace(domNode) : undefined;
    },
    transform: (reactNode, domNode, index) => {
      const isContainer = isDomElementNode(domNode) && ['p', 'div', 'li'].includes(domNode.name);

      if (isContainer) {
        const maybeChildren = domNode.children;
        const maybeToolIndex = parseToolRefIndexFromTextPrefix(
          extractTextFromChildren(maybeChildren as ChildNode[])
        );
        if (
          maybeToolIndex !== undefined &&
          consumedToolIndexes.has(maybeToolIndex) &&
          !groupRootIndexes.has(maybeToolIndex)
        ) {
          return null;
        }
      }

      return baseTransform ? baseTransform(reactNode, domNode, index) : reactNode;
    },
  };
  return nextOpts;
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

        if (Object.prototype.hasOwnProperty.call(MINDROOM_BLOCK_META, name)) {
          const blockName = name as MindroomTagName;
          const { icon, label } = MINDROOM_BLOCK_META[blockName];

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

        if ((name === 'span' || name === 'div') && typeof attribs['data-mx-maths'] === 'string') {
          const latex = attribs['data-mx-maths'];
          const fallback = children.length > 0 ? domToReact(children, opts) : undefined;

          return (
            <MathHtml
              as={name === 'div' ? 'div' : 'span'}
              latex={latex}
              displayMode={name === 'div'}
              fallback={fallback}
              className={classNames(
                name === 'div' ? css.MathBlock : css.MathInline,
                props.className
              )}
            />
          );
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
        const parentName =
          domNode.parent && 'name' in domNode.parent ? domNode.parent.name : undefined;

        // React rejects whitespace text nodes directly under table structure tags.
        if (
          parentName &&
          TABLE_STRUCTURE_TAGS.has(parentName) &&
          domNode.data.trim().length === 0
        ) {
          return null;
        }

        const linkify = parentName !== 'code' && parentName !== 'a';
        const parseMath = parentName !== 'code' && parentName !== 'pre' && parentName !== 'a';

        if (parseMath) {
          return (
            <>
              {renderTextWithLatex(domNode.data, {
                linkify,
                linkifyOpts: params.linkifyOpts,
                highlightRegex: params.highlightRegex,
                keyPrefix: `${parentName ?? 'text'}-${domNode.startIndex ?? 0}`,
              })}
            </>
          );
        }

        return <>{renderStyledText(domNode.data, params.highlightRegex)}</>;
      }
      return undefined;
    },
  };
  return opts;
};
