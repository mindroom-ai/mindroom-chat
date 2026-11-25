import { type ComponentPropsWithoutRef, type ReactNode, useId } from 'react';
import classNames from 'classnames';
import { cloneNode, Element, isTag, isText, Text, type ChildNode } from 'domhandler';
import * as css from './TaskList.css';

export type ParsedTaskListItem = { checked: boolean; marker: string; bodyNodes: ChildNode[] };

const TASK_MARKER_REG = /^[ \t]*(?:\r?\n[ \t]*)?\[([ xX])\][ \t]+([\s\S]*)$/;

const isWhitespaceText = (node: ChildNode): boolean => isText(node) && node.data.trim() === '';

const hasNonWhitespaceFrom = (nodes: ChildNode[], startIndex: number): boolean => {
  for (let i = startIndex; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (node && !isWhitespaceText(node)) return true;
  }
  return false;
};

type TaskMarkerMatch = {
  firstIndex: number;
  first: Text;
  checked: boolean;
  marker: string;
  rest: string;
};

const matchTaskMarker = (nodes: ChildNode[]): TaskMarkerMatch | undefined => {
  const firstIndex = nodes.findIndex((node) => !isWhitespaceText(node));
  const first = firstIndex === -1 ? undefined : nodes[firstIndex];
  if (!first || !isText(first)) return undefined;

  const match = TASK_MARKER_REG.exec(first.data);
  if (!match) return undefined;

  const token = match[1];
  if (!token) return undefined;
  const rest = match[2] ?? '';
  if (rest.trim() === '' && !hasNonWhitespaceFrom(nodes, firstIndex + 1)) return undefined;

  return {
    firstIndex,
    first,
    checked: token !== ' ',
    marker: `[${token}]`,
    rest,
  };
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

const stripTaskMarker = (
  nodes: ChildNode[]
): { checked: boolean; marker: string; remaining: ChildNode[] } | undefined => {
  const matched = matchTaskMarker(nodes);
  if (!matched) return undefined;

  const afterFirst = nodes.slice(matched.firstIndex + 1);
  let remaining = afterFirst;
  if (matched.rest !== '') {
    const textCopy = new Text(matched.rest);
    textCopy.parent = matched.first.parent;
    remaining = [textCopy, ...afterFirst];
  }

  return { checked: matched.checked, marker: matched.marker, remaining };
};

/**
 * Checks whether an `<li>`'s children start with a valid GFM task marker without cloning any DOM
 * nodes. Mirrors `extractTaskListItem` for both tight and loose (`<p>`) items.
 */
export const hasTaskListMarker = (children: ChildNode[]): boolean => {
  const first = children.find((node) => !isWhitespaceText(node));
  if (!first) return false;
  if (isTag(first) && first.name === 'p') {
    return matchTaskMarker(first.children) !== undefined;
  }
  return matchTaskMarker(children) !== undefined;
};

/**
 * Parses an `<li>`'s children as a GFM task list item without mutating any input DOM nodes.
 * Supports tight (`<li>[x] Done</li>`) and loose (`<li><p>[x] Done</p>...</li>`) items.
 */
export const extractTaskListItem = (children: ChildNode[]): ParsedTaskListItem | undefined => {
  const firstIndex = children.findIndex((node) => !isWhitespaceText(node));
  const first = firstIndex === -1 ? undefined : children[firstIndex];
  if (!first) return undefined;

  if (isTag(first) && first.name === 'p') {
    const stripped = stripTaskMarker(first.children);
    if (!stripped) return undefined;
    return {
      checked: stripped.checked,
      marker: stripped.marker,
      bodyNodes: [
        cloneParagraphWithChildren(first, stripped.remaining),
        ...children.slice(firstIndex + 1),
      ],
    };
  }

  const stripped = stripTaskMarker(children);
  return stripped
    ? { checked: stripped.checked, marker: stripped.marker, bodyNodes: stripped.remaining }
    : undefined;
};

type TaskListItemProps = ComponentPropsWithoutRef<'li'> & {
  checked: boolean;
  highlightMarker?: boolean;
  children?: ReactNode;
};

/** Renders a GFM task list item with a read-only accessible checkbox tied to its body text. */
export function TaskListItem({
  checked,
  highlightMarker = false,
  children,
  className,
  ...props
}: TaskListItemProps) {
  const bodyId = useId();
  return (
    <li {...props} className={classNames(css.TaskListItem, className)}>
      <input
        type="checkbox"
        checked={checked}
        disabled
        readOnly
        aria-labelledby={bodyId}
        data-highlighted={highlightMarker ? 'true' : undefined}
        className={classNames(css.TaskCheckbox, highlightMarker && css.TaskCheckboxHighlighted)}
      />
      <div id={bodyId} className={css.TaskItemBody}>
        {children}
      </div>
    </li>
  );
}
