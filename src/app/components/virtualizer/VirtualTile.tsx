import React, { CSSProperties, ReactNode, forwardRef } from 'react';
import classNames from 'classnames';
import type { VirtualItem } from '@tanstack/react-virtual';
import * as css from './style.css';

type VirtualTileProps = {
  virtualItem: VirtualItem;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
};

/**
 * A row of a `@tanstack/react-virtual` list, placed at its start offset. Pass the virtualizer's
 * `measureElement` as `ref` for rows of varying height (it reads `data-index`); `style.top`
 * overrides the placement.
 */
export const VirtualTile = forwardRef<HTMLDivElement, VirtualTileProps>(





      ref={ref}
    >
      {children}
    </div>
  )
);
