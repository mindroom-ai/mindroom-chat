import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';

// The icon rail at the left edge: home, direct messages, spaces, inbox, account.









    borderInlineEnd: `${config.borderWidth.B300} solid ${color.Background.ContainerLine}`,
  },
]);














  // Long-press drags on touch screens must not select text or scroll the list instead.
  touchAction: 'manipulation',
  userSelect: 'none',
  WebkitUserSelect: 'none',
  WebkitTouchCallout: 'none',
  outline: 'none',
} as const;

/** A sortable icon in the rail (space or folder). */
export const SidebarDragSource = style([DefaultReset, dragSource, { position: 'relative' }]);

/** A sortable row in the sidebar's room list. */
export const SidebarRowDragSource = style([
  DefaultReset,
  dragSource,
  {
    position: 'relative',
    width: '100%',
    selectors: {
      '&:focus-visible': {
        borderRadius: config.radii.R400,
        boxShadow: `inset 0 0 0 ${config.borderWidth.B600} ${color.Primary.Main}`,
      },
    },
  },
]);
