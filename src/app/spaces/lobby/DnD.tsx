import { RefObject } from 'react';
import type { HierarchyItem } from '../useSpaceHierarchy';

export type CanDropCallback = (item: HierarchyItem, container: HierarchyItem) => boolean;

/**
 * Drag and drop for reordering lobby items. Reordering is not wired up yet;
 * the hooks keep the call sites in place and do nothing.
 */
export const useDraggableItem = (
  _item: HierarchyItem,
  _targetRef: RefObject<HTMLElement>,
  _onDragging?: (item?: HierarchyItem) => void,
  _dragHandleRef?: RefObject<HTMLElement>
): boolean | undefined => undefined;

export function ItemDraggableTarget(_props: { item: HierarchyItem; canDrop?: CanDropCallback }) {
  return null;
}
