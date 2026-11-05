import { style } from '@vanilla-extract/css';
import { DefaultReset, color, config, toRem } from 'folds';

// Wide enough for a room name, its topic and the Join button on one row; as tall as the list
// needs, up to 640 px or the window less a margin, with only the list scrolling.
export const Dialog = style({
  width: '100%',
  maxWidth: toRem(480),
  maxHeight: `min(${toRem(640)}, calc(100dvh - ${toRem(48)}))`,
  display: 'flex',
  flexDirection: 'column',
});

export const TitleBar = style({
  flexShrink: 0,
  paddingBlock: 0,
  paddingInlineStart: config.space.S400,
  paddingInlineEnd: config.space.S200,
});

// The field stays on top, the list takes the rest and scrolls, the Explore link stays below it.
export const Panel = style({
  display: 'flex',
  flexDirection: 'column',
  flexGrow: 1,
  minHeight: 0,
});

export const Field = style({
  flexShrink: 0,
  paddingInline: config.space.S400,
  paddingBlockEnd: config.space.S300,
});

export const Results = style({
  flexGrow: 1,
  minHeight: 0,
  overflowY: 'auto',
  overscrollBehavior: 'contain',
  paddingInline: config.space.S200,
  paddingBlockEnd: config.space.S200,
});

export const SectionLabel = style({
  paddingInline: config.space.S200,
  paddingBlock: config.space.S100,
});

export const RoomList = style([
  DefaultReset,
  {
    listStyle: 'none',
    display: 'flex',
    flexDirection: 'column',
    gap: config.space.S100,
  },
]);

// Name and details on the left, the action on the right; an error takes a line of its own.
export const Row = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  alignItems: 'center',
  columnGap: config.space.S300,
  rowGap: config.space.S100,
  paddingBlock: config.space.S200,
  paddingInlineStart: config.space.S200,
  paddingInlineEnd: config.space.S300,
  borderRadius: config.radii.R400,
  selectors: {
    '&:hover, &:focus-within': { backgroundColor: color.Surface.ContainerHover },
  },
});

// The avatar, name and details are one button that opens the room or its preview.
export const RowBody = style({
  all: 'unset',
  display: 'flex',
  minInlineSize: 0,
  columnGap: config.space.S300,
  alignItems: 'center',
  cursor: 'pointer',
});

export const RowText = style({
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
});

// Join, Joining and Open keep one width, so the row does not shift while a join runs.
export const RowAction = style({
  minWidth: toRem(84),
});

export const RowError = style({
  gridColumn: '1 / -1',
  color: color.Critical.Main,
});

export const Status = style({
  paddingInline: config.space.S200,
  paddingBlock: config.space.S300,
});

export const ExploreFooter = style({
  flexShrink: 0,
  display: 'flex',
  placeContent: 'center',
  paddingBlock: config.space.S300,
  paddingInline: config.space.S400,
  borderBlockStart: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
});

export const ExploreLink = style({
  color: color.Surface.OnContainer,
  opacity: config.opacity.P400,
  textDecoration: 'none',
  selectors: {
    '&:hover, &:focus-visible': { opacity: 1, textDecoration: 'underline' },
  },
});
