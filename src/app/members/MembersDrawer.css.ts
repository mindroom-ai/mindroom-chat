import { style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';

// Measured from the members panel of docs/design/reference/room-light.png (1x): the header is
// folds Header size 600 (54 px) with the count 12 px in; the filter and sort row, the search
// field and the member rows start 8 px from the panel's start edge and stop 20 px before its
// end edge, where the inset scrollbar runs; the field is 40 px high with 12 px corners; group
// labels take 32 px with 12 px between groups; member rows are 40 px with 24 px round avatars.

/** Where content stops before the end edge: S200 plus the inset scrollbar's 12 px track. */
const endInset = `calc(${config.space.S200} + ${toRem(12)})`;

// Fills the resizable members panel around it, which owns the width and draws the divider.
// Its own stacking context keeps the sticky header under that divider.
export const MembersDrawer = style({
  inlineSize: '100%',
  blockSize: '100%',
  minHeight: 0,
  isolation: 'isolate',
});

/** Around the scrolling column: places the inset scrollbar and the scroll to top button. */
export const MemberDrawerContentBase = style({
  position: 'relative',
  minHeight: 0,
});

/** The count header stays at the top while the list scrolls under it. */
export const MembersHeaderControl = style({
  position: 'sticky',
  insetBlockStart: 0,
  zIndex: 2,
  paddingInline: `${config.space.S300} ${endInset}`,
});

export const MembersHeaderCount = style({
  fontWeight: config.fontWeight.W600,
});

/** "1 Invited" after the count: text that opens the Invited filter. */
export const MembersHeaderInvited = style({
  flexShrink: 0,
  padding: 0,
  border: 0,
  background: 'none',
  color: color.Secondary.Main,
  font: 'inherit',
  cursor: 'pointer',
  selectors: {
    '&:hover': { textDecoration: 'underline' },
    '&:focus-visible': {
      outline: `${config.borderWidth.B400} solid ${color.Primary.Main}`,
      outlineOffset: config.borderWidth.B400,
      borderRadius: config.radii.R300,
    },
  },
});

/** The line that says why the list is empty. */
export const MembersGroupLabel = style({
  paddingBlock: config.space.S400,
  textAlign: 'center',
});

/** Places one row of the virtual list; the row's offset comes as a transform. */
export const DrawerVirtualItem = style({
  position: 'absolute',
  insetInline: 0,
  insetBlockStart: 0,
});

/** A power level group's name above its members. */
export const MemberGroupTitle = style({
  display: 'flex',
  alignItems: 'center',
  blockSize: toRem(32),
  paddingInline: config.space.S200,
  fontWeight: config.fontWeight.W600,
});

/** Groups after the first keep a gap above their title. */
export const MemberGroupTitleSpaced = style({
  marginTop: config.space.S300,
});

export const MemberRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S200,
  inlineSize: '100%',
  blockSize: toRem(40),
  paddingInline: config.space.S200,
  border: 0,
  borderRadius: config.radii.R400,
  background: 'none',
  color: 'inherit',
  textAlign: 'start',
  cursor: 'pointer',
  selectors: {
    '&:hover, &:focus-visible': { backgroundColor: color.Background.ContainerHover },
    '&:active, &[aria-pressed="true"]': { backgroundColor: color.Background.ContainerActive },
    '&:focus-visible': { outline: `${config.borderWidth.B400} solid ${color.Primary.Main}` },
  },
});

export const MemberAvatar = style({
  inlineSize: toRem(24),
  blockSize: toRem(24),
  flexShrink: 0,
  borderRadius: '50%',
  overflow: 'hidden',
});

export const MemberName = style({
  flexGrow: 1,
  minWidth: 0,
});

export const JoinRequestItem = style({
  padding: config.space.S200,
  borderRadius: config.radii.R400,
});

export const JoinRequestMessage = style({
  whiteSpace: 'pre-wrap',
});

export const JoinRequestActions = style({
  paddingTop: config.space.S100,
});

/** Under the matching members, the people outside the room the search found, after a line. */
export const InviteSection = style({
  marginTop: config.space.S300,
  paddingTop: config.space.S100,
  borderTop: `${config.borderWidth.B300} solid ${color.Background.ContainerLine}`,
});

/** The section's title, like a group's, with the directory search's spinner at the end. */
export const InviteSectionTitle = style([
  MemberGroupTitle,
  { justifyContent: 'space-between', gap: config.space.S200 },
]);

/** "Searching users" while the directory has not answered and nothing else is listed. */
export const InviteSearching = style({
  paddingInline: config.space.S200,
  paddingBlock: config.space.S100,
});

export const InviteList = style({
  marginBlock: 0,
  paddingInline: 0,
  listStyle: 'none',
});

/** A person to invite: avatar, name over user ID, and the Invite button; 48 px high. */
export const InviteRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S200,
  minBlockSize: toRem(48),
  paddingInline: config.space.S200,
});

export const InviteAvatar = style({
  inlineSize: toRem(32),
  blockSize: toRem(32),
  flexShrink: 0,
  borderRadius: '50%',
  overflow: 'hidden',
});

export const InviteIdentity = style({
  display: 'flex',
  flexDirection: 'column',
  flexGrow: 1,
  minWidth: 0,
});

export const InviteButton = style({
  flexShrink: 0,
});

/** The button once the invitation went out: a confirmation, not dimmed like a control turned off. */
export const InviteSent = style({
  vars: { [config.opacity.Disabled]: '1' },
  selectors: { '&[aria-disabled="true"]': { cursor: 'default' } },
});

/** Read by screen readers only: the line that says an invitation went out. */
// Pinned to the panel's top corner: left where it falls, below a long member list, the browser
// would scroll the whole page to bring it into view for find in page or a screen reader.
export const VisuallyHidden = style({
  position: 'absolute',
  insetBlockStart: 0,
  insetInlineStart: 0,
  inlineSize: 1,
  blockSize: 1,
  margin: 0,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
});
