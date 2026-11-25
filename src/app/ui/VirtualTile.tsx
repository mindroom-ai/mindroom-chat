import { CSSProperties, ReactNode, type Ref } from 'react';
import classNames from 'classnames';
import type { VirtualItem } from '@tanstack/react-virtual';
import * as css from './VirtualTile.css';

type VirtualTileProps = {
  virtualItem: VirtualItem;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  ref?: Ref<HTMLDivElement>;
};

/**
 * A row of a `@tanstack/react-virtual` list, placed at its start offset. Pass the virtualizer's
 * `measureElement` as `ref` for rows of varying height (it reads `data-index`); `style.top`
 * overrides the placement.
 */
export function VirtualTile({ virtualItem, className, style, children, ref }: VirtualTileProps) {
  const placement: CSSProperties = { top: virtualItem.start, ...style };

  return (
    <div
      ref={ref}
      data-index={virtualItem.index}
      className={classNames(css.VirtualTile, className)}
      style={placement}
    >
      {children}
    </div>
  );
}
