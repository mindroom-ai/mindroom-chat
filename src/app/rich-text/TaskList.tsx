import { type ComponentPropsWithoutRef, type ReactNode, useId } from 'react';
import classNames from 'classnames';
import { cloneNode, Element, isTag, isText, Text, type ChildNode } from 'domhandler';
import * as css from './TaskList.css';

export type ParsedTaskListItem = { checked: boolean; bodyNodes: ChildNode[] };

const TASK_MARKER_REG = /^[ \t]*(?:\r?\n[ \t]*)?\[([ xX])\][ \t]+([\s\S]*)$/;

const isWhitespaceText = (node: ChildNode): boolean => isText(node) && node.data.trim() === '';

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
): { checked: boolean; remaining: ChildNode[] } | undefined => {
  const firstIndex = nodes.findIndex((node) => !isWhitespaceText(node));
  const first = firstIndex === -1 ? undefined : nodes[firstIndex];
  if (!first || !isText(first)) return undefined;

  const match = TASK_MARKER_REG.exec(first.data);
  if (!match) return undefined;

  const rest = match[2] ?? '';
  const afterFirst = nodes.slice(firstIndex + 1);
  let remaining = afterFirst;
  if (rest !== '') {
    const textCopy = new Text(rest);
    textCopy.parent = first.parent;
    remaining = [textCopy, ...afterFirst];
  }
  if (!remaining.some((node) => !isWhitespaceText(node))) return undefined;

  return { checked: match[1] !== ' ', remaining };
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
      bodyNodes: [
        cloneParagraphWithChildren(first, stripped.remaining),
        ...children.slice(firstIndex + 1),
      ],
    };
  }

  const stripped = stripTaskMarker(children);
  return stripped ? { checked: stripped.checked, bodyNodes: stripped.remaining } : undefined;
};

type TaskListItemProps = ComponentPropsWithoutRef<'li'> & {
  checked: boolean;
  children?: ReactNode;
};

/** Renders a GFM task list item with a read-only accessible checkbox tied to its body text. */
export function TaskListItem({ checked, children, className, ...props }: TaskListItemProps) {
  const bodyId = useId();
  return (
    <li {...props} className={classNames(css.TaskListItem, className)}>
      <input
        type="checkbox"
        checked={checked}
        disabled
        readOnly
        aria-labelledby={bodyId}
        className={css.TaskCheckbox}
      />
      <div id={bodyId} className={css.TaskItemBody}>
        {children}
      </div>
    </li>
  );
}
