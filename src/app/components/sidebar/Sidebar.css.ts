import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config } from 'folds';

// The rail itself (Sidebar, SidebarStack) is styled in SidebarItem.css.ts.

/** A sortable row in the sidebar's room list. */
export const SidebarRowDragSource = style([
  DefaultReset,
  {
    position: 'relative',
    width: '100%',
    // Long-press drags on touch screens must not select text or scroll the list instead.
    touchAction: 'manipulation',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    WebkitTouchCallout: 'none',
    outline: 'none',
    selectors: {
      '&:focus-visible': {
        // The row's own corners, as NavItem draws them.
        borderRadius: config.radii.R500,
        boxShadow: `inset 0 0 0 ${config.borderWidth.B600} ${color.Primary.Main}`,
      },
    },
  },
]);
