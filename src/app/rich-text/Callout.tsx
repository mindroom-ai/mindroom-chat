import React, { type ComponentPropsWithoutRef, type ReactNode, useId } from 'react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { cloneNode, Element, isTag, isText, Text, type ChildNode } from 'domhandler';
import IconAlertOctagon from '@tabler/icons-react/icons/IconAlertOctagon';
import IconAlertTriangle from '@tabler/icons-react/icons/IconAlertTriangle';
import IconBulb from '@tabler/icons-react/icons/IconBulb';
import IconInfoCircle from '@tabler/icons-react/icons/IconInfoCircle';
import IconMessageReport from '@tabler/icons-react/icons/IconMessageReport';
import * as css from './Callout.css';

export type CalloutType = 'note' | 'tip' | 'important' | 'warning' | 'caution';

export type ParsedCallout = {
  type: CalloutType;
  bodyNodes: ChildNode[];
};

const CALLOUT_TITLE_KEYS = {
  note: 'sharedUi.callout.note',
  tip: 'sharedUi.callout.tip',
  important: 'sharedUi.callout.important',
  warning: 'sharedUi.callout.warning',
  caution: 'sharedUi.callout.caution',
} as const satisfies Record<CalloutType, string>;

const CALLOUT_ICONS: Record<CalloutType, typeof IconInfoCircle> = {
  note: IconInfoCircle,
  tip: IconBulb,
  important: IconMessageReport,
  warning: IconAlertTriangle,
  caution: IconAlertOctagon,
};

// Matches `[!TYPE]` at the start of a text node (allowing optional horizontal spaces and at most
// one leading newline from pretty-printed HTML). Any non-whitespace text on the same line fails.
const CALLOUT_MARKER_REG =
  /^[ \t]*(?:\r?\n[ \t]*)?\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\r?\n([\s\S]*))?$/i;

const isWhitespaceText = (node: ChildNode): boolean => isText(node) && node.data.trim() === '';
const isBr = (node: ChildNode): boolean => isTag(node) && node.name === 'br';
const trimLeadingBlankLines = (text: string): string => text.replace(/^(?:[ \t]*\r?\n)+/, '');

const createTextWithSameParent = (original: Text, data: string): Text => {
  const copy = new Text(data);
  copy.parent = original.parent;
  return copy;
};

const trimEdgeWhitespace = (nodes: ChildNode[]): ChildNode[] => {
  let start = 0;
  let end = nodes.length;
  while (start < end) {
    const node = nodes[start];
    if (!node || !isWhitespaceText(node)) break;
    start += 1;
  }
  while (end > start) {
    const node = nodes[end - 1];
    if (!node || !isWhitespaceText(node)) break;
    end -= 1;
  }
  return nodes.slice(start, end);
};

const cloneParagraphWithChildren = (paragraph: Element, children: ChildNode[]): Element => {
  const cloned = new Element(paragraph.name, { ...paragraph.attribs }, []);
  cloned.parent = paragraph.parent;
  cloned.children = children.map((child) => {
    const copy = cloneNode(child, true);
    copy.parent = cloned;
    return copy;
  });
  return cloned;
};

const stripLeadingMarker = (
  nodes: ChildNode[]
): { type: CalloutType; remaining: ChildNode[] } | undefined => {
  const firstIndex = nodes.findIndex((node) => !isWhitespaceText(node));
  if (firstIndex === -1) return undefined;
  const first = nodes[firstIndex];
  if (!first || !isText(first)) return undefined;

  const match = CALLOUT_MARKER_REG.exec(first.data);
  const rawType = match?.[1];
  if (!match || !rawType) return undefined;

  const type = rawType.toLowerCase() as CalloutType;
  const afterNewline = match[2];
  let rest = nodes.slice(firstIndex + 1);

  if (afterNewline !== undefined) {
    const trimmed = trimLeadingBlankLines(afterNewline);
    if (trimmed !== '') {
      rest = [createTextWithSameParent(first, trimmed), ...rest];
    }
  } else {
    // No newline inside the text node: only end-of-block or an immediate `<br>` may follow.
    let nextIndex = 0;
    while (nextIndex < rest.length) {
      const candidate = rest[nextIndex];
      if (!candidate || !isWhitespaceText(candidate)) break;
      nextIndex += 1;
    }
    const next = rest[nextIndex];
    if (next !== undefined) {
      if (!isBr(next)) return undefined;
      rest = rest.slice(nextIndex + 1);
    }
  }

  // Drop blank lines (`<br>` or newline-only text) immediately following the marker line.
  while (rest.length > 0) {
    const head = rest[0];
    if (!head) break;
    if (isBr(head) || isWhitespaceText(head)) {
      rest = rest.slice(1);
      continue;
    }
    if (isText(head)) {
      const trimmed = trimLeadingBlankLines(head.data);
      if (trimmed !== head.data) {
        rest =
          trimmed === ''
            ? rest.slice(1)
            : [createTextWithSameParent(head, trimmed), ...rest.slice(1)];
        continue;
      }
    }
    break;
  }

  return { type, remaining: rest };
};

/**
 * Parses a `<blockquote>`'s children as a GitHub-style alert callout without mutating any input
 * DOM nodes. Returns undefined when the blockquote does not start with a valid standalone marker.
 */
export const extractCallout = (children: ChildNode[]): ParsedCallout | undefined => {
  const firstIndex = children.findIndex((node) => !isWhitespaceText(node));
  if (firstIndex === -1) return undefined;
  const first = children[firstIndex];
  if (!first) return undefined;

  // Paragraph-wrapped form (`<blockquote><p>[!NOTE]...</p>...</blockquote>`).
  if (isTag(first) && first.name === 'p') {
    const stripped = stripLeadingMarker(first.children);
    if (!stripped) return undefined;
    const afterFirst = children.slice(firstIndex + 1);
    const bodyNodes =
      stripped.remaining.length > 0
        ? [cloneParagraphWithChildren(first, stripped.remaining), ...afterFirst]
        : afterFirst;
    return {
      type: stripped.type,
      bodyNodes: trimEdgeWhitespace(bodyNodes),
    };
  }

  // Direct-child form (composer `<blockquote data-md=">">[!NOTE]<br/>Body<br/></blockquote>`
  // or raw text `<blockquote>[!NOTE]\nBody</blockquote>`).
  const stripped = stripLeadingMarker(children);
  if (!stripped) return undefined;
  let bodyNodes = trimEdgeWhitespace(stripped.remaining);
  const last = bodyNodes.at(-1);
  if (last && isBr(last)) {
    bodyNodes = trimEdgeWhitespace(bodyNodes.slice(0, -1));
  }
  return {
    type: stripped.type,
    bodyNodes,
  };
};

type CalloutProps = ComponentPropsWithoutRef<'aside'> & {
  type: CalloutType;
  children?: ReactNode;
};

/** Renders a GitHub-style alert callout with a semantic tone, icon, localized title, and body. */
export function Callout({ type, children, className, ...props }: CalloutProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const Icon = CALLOUT_ICONS[type];
  const hasBody = React.Children.toArray(children).length > 0;

  return (
    <aside
      {...props}
      role="note"
      aria-labelledby={titleId}
      data-callout-type={type}
      className={classNames(css.Callout({ tone: type }), className)}
    >
      <div id={titleId} className={css.Header({ tone: type })}>
        <Icon size={16} stroke={1.8} className={css.Icon} aria-hidden="true" />
        <span>{t(CALLOUT_TITLE_KEYS[type])}</span>
      </div>
      {hasBody && <div className={css.Body}>{children}</div>}
    </aside>
  );
}
