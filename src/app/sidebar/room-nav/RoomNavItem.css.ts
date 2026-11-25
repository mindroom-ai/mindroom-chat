import { style } from '@vanilla-extract/css';
import { color, config } from 'folds';

/** Wraps a row avatar so an optional corner badge (such as an active-run dot) can sit over it. */
export const AvatarSlot = style({
  position: 'relative',
  display: 'inline-flex',
  flexShrink: 0,
});

/** Subtle rounded tile behind non-photo row avatars (group DM count, inline `+` action rows). */
export const SubtleAvatarTile = style({
  backgroundColor: color.SurfaceVariant.Container,
  color: color.SurfaceVariant.OnContainer,
});

/** Rounded-square member count avatar for group direct messages (> 2 active members). */
export const GroupCountAvatar = style([
  SubtleAvatarTile,
  {
    fontVariantNumeric: 'tabular-nums',
  },
]);

/** Keeps the room name truncatable while a trailing self-DM tag stays visible. */
export const NameRow = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: config.space.S100,
  flexGrow: 1,
  minInlineSize: 0,
});

/** Muted inline `you` label beside a self-DM's name. */
export const SelfDirectTag = style({
  flexShrink: 0,
  opacity: config.opacity.P500,
  fontWeight: config.fontWeight.W400,
});
