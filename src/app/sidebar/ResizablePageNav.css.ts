import { style } from '@vanilla-extract/css';
import { config } from 'folds';

// The new version notice's place at the foot of the room list (shell/NewVersionNotice.tsx): as
// wide as the list, inset from its edges, over the list's last rows. Empty, it has no height, so
// it takes no clicks.
export const NoticeSlot = style({
  position: 'absolute',
  zIndex: 1,
  insetInline: config.space.S200,
  insetBlockEnd: `calc(env(safe-area-inset-bottom, 0px) + ${config.space.S300})`,
});
