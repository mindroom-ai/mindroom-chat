import React, { ReactNode, useState } from 'react';
import { Element, HTMLReactParserOptions, Text as DOMText, domToReact } from 'html-react-parser';
import { ChildNode } from 'domhandler';
import { Box, Icon, IconSrc, Icons, Spinner, Text } from 'folds';
import { MindroomToolRefParseResult, parseMindroomToolRefHtml } from './blocks';
import {
  MindroomToolTraceEvent,
  getMindroomToolTraceEvents,
  isMindroomToolTraceV2,
} from './toolTrace';
import * as css from './MindroomHtmlBlocks.css';

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

const extractTextFromChildren = (nodes: ChildNode[]): string => {
  let text = '';

  nodes.forEach((node) => {
    if (isDomTextNode(node)) {
      text += node.data;
    } else if (isDomElementNode(node)) {
      text += extractTextFromChildren((node as { children: ChildNode[] }).children);
    }
  });

  return text;
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
  children?: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Text as="div" size="T300" className={css.Block}>
      <button type="button" className={css.BlockHeader} onClick={() => setExpanded((v) => !v)}>
        <Box grow="Yes" className={css.BlockHeaderMeta}>
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
            <Text size="T200" truncate className={css.BlockInlineResult}>
              {'-> '}
              {inlineResult}
            </Text>
          )}
        </Box>
        <Icon size="50" src={expanded ? Icons.ChevronTop : Icons.ChevronBottom} />
      </button>
      {expanded && <Box className={css.BlockBody}>{children}</Box>}
    </Text>
  );
}

export const renderMindroomHtmlBlock = (
  name: string,
  children: ChildNode[],
  opts: HTMLReactParserOptions
): React.ReactElement | undefined => {
  if (!Object.prototype.hasOwnProperty.call(MINDROOM_BLOCK_META, name)) return undefined;

  const blockName = name as MindroomTagName;
  const { icon, label } = MINDROOM_BLOCK_META[blockName];

  return (
    <MindroomCollapsibleBlock icon={icon} label={label}>
      {domToReact(children, opts)}
    </MindroomCollapsibleBlock>
  );
};

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
      <Box key={key} className={css.ToolGroupItem}>
        <Text size="T200">{`${prefix} ⏳`}</Text>
      </Box>
    );
  }

  if (parsedTool.status === 'completed_with_result' && parsedTool.result) {
    return (
      <Box key={key} className={css.ToolGroupItem}>
        <Text size="T200">{prefix}</Text>
        <Text as="pre" size="T200" className={css.BlockResult}>
          {parsedTool.result}
        </Text>
      </Box>
    );
  }

  return (
    <Box key={key} className={css.ToolGroupItem}>
      <Text size="T200">{`${prefix} ✓`}</Text>
    </Box>
  );
};

const renderMindroomToolRefGroupBlock = (parsedTools: MindroomToolBlockRenderData[]) => {
  const label = parsedTools.length === 1 ? '1 tool call' : `${parsedTools.length} tool calls`;
  const pending = parsedTools.length === 1 ? parsedTools[0].status === 'pending' : undefined;

  return (
    <MindroomCollapsibleBlock icon={Icons.Terminal} label={label} pending={pending}>
      <Box className={css.ToolGroupList}>
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
  const traceEvents = isMindroomToolTraceV2(content)
    ? getMindroomToolTraceEvents(content)
    : undefined;

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

          const data = buildToolRefRenderData(toolRef, traceEvents?.[toolRef.index - 1]);
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
