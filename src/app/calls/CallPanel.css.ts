import { keyframes, style, type StyleRule } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import {
  Header as SidePanelHeader,
  Panel as SidePanelPanel,
} from '../ui/panels/SidePanel.css';

const { space, radii, borderWidth } = config;

/** Children in a line or a column, `gap` apart. */
const lined = (flexDirection: 'row' | 'column', gap: string, rest: StyleRule = {}): StyleRule => ({
  display: 'flex',
  flexDirection,
  gap,
  ...rest,
});

/** A box in the colors of one folds group: its container fill and the text on it. */
const tinted = (group: { Container: string; OnContainer: string }): StyleRule => ({
  background: group.Container,
  color: group.OnContainer,
});

/** A hairline of the panel's line color, for the edge it is put on. */
const hairline = `${borderWidth.B300} solid ${color.Background.ContainerLine}`;

// It fills its column, and the room's width on phones, where it covers the conversation.
export const Panel = style([SidePanelPanel, { flexGrow: 1, containerType: 'inline-size' }]);

export const Header = style([SidePanelHeader]);

export const HeaderTitle = style(lined('column', '0', { minWidth: 0 }));

export const Body = style(
  lined('column', space.S300, {
    flex: '1 1 auto',
    minHeight: 0,
    overflowY: 'auto',
    padding: space.S300,
  })
);

// Tiles fill the panel's width: one column in a narrow panel, more as it widens. They sit in the
// middle of the space under the notices, as a call of two leaves most of a tall panel free.
export const Tiles = style({
  flex: '1 1 auto',
  alignContent: 'center',
  display: 'grid',
  gridTemplateColumns: `repeat(auto-fill, minmax(${toRem(160)}, 1fr))`,
  gap: space.S200,
  margin: 0,
  padding: 0,
  listStyle: 'none',
});

const speakingPulse = keyframes({
  from: { boxShadow: `0 0 0 0 ${color.Success.Main}` },
  '70%': { boxShadow: `0 0 0 ${toRem(6)} transparent` },
  to: { boxShadow: '0 0 0 0 transparent' },
});

const ring = (width: string, ringColor: string): StyleRule => ({
  outline: `${width} solid ${ringColor}`,
  outlineOffset: `calc(-1 * ${width})`,
});

// A 4:3 card with the picture in its middle; it rings green while its person talks.
export const Tile = style([
  tinted(color.SurfaceVariant),
  ring(borderWidth.B300, color.SurfaceVariant.ContainerLine),
  {
    position: 'relative',
    display: 'grid',
    placeItems: 'center',
    aspectRatio: '4 / 3',
    overflow: 'hidden',
    borderRadius: radii.R400,
    transition: 'outline-color 120ms ease',
    selectors: {
      '&[data-speaking="true"]': ring(toRem(2), color.Success.Main),
      '&[data-connected="false"]': { opacity: 0.7 },
    },
  },
]);

const speakingTile = `${Tile}[data-speaking="true"] &`;

export const TileAvatar = style({
  selectors: { [speakingTile]: { animation: `${speakingPulse} 1.4s ease-out infinite` } },
  '@media': {
    '(prefers-reduced-motion: reduce)': { selectors: { [speakingTile]: { animation: 'none' } } },
  },
});

// A shared screen takes the whole row, at the usual screen shape, letterboxed rather than cropped.
export const ScreenTile = style([
  Tile,
  {
    gridColumn: '1 / -1',
    aspectRatio: '16 / 9',
    background: color.Other.Shadow,
  },
]);

export const ScreenVideo = style({
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'contain',
});

export const ScreenFullScreen = style({
  position: 'absolute',
  insetBlockStart: space.S100,
  insetInlineEnd: space.S100,
});

export const TileVideo = style({
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  background: color.Other.Shadow,
});

// The name sits on a dark scrim, readable on video and on the plain tile alike. A user ID after
// the name wraps onto a line of its own when the tile is too narrow for both (NameWithUserId).
export const TileLabel = style(
  lined('row', space.S100, {
    flexWrap: 'wrap',
    rowGap: 0,
    position: 'absolute',
    insetInlineStart: space.S100,
    insetBlockEnd: space.S100,
    alignItems: 'center',
    maxWidth: `calc(100% - 2 * ${space.S100})`,
    paddingBlock: toRem(2),
    paddingInline: space.S200,
    borderRadius: radii.R300,
    background: 'rgba(0, 0, 0, 0.55)',
    color: '#fff',
  })
);

// "Waiting for ..." over the tile's top, centered; a user ID after the name wraps as in the label.
export const TileStatus = style(
  lined('row', space.S100, {
    flexWrap: 'wrap',
    justifyContent: 'center',
    rowGap: 0,
    position: 'absolute',
    insetBlockStart: space.S100,
    insetInline: space.S100,
    textAlign: 'center',
  })
);

// Before joining: who is in the call, the toggles and Join, in the middle of the panel.
export const Prescreen = style({
  flex: '1 1 auto',
  display: 'grid',
  alignContent: 'center',
  justifyItems: 'center',
  rowGap: space.S400,
  paddingBlock: space.S700,
  paddingInline: space.S400,
  textAlign: 'center',
});

export const Faces = style(lined('row', space.S200, { flexWrap: 'wrap', placeContent: 'center' }));

export const Notice = style([
  tinted(color.Warning),
  lined('row', space.S200, {
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    padding: space.S300,
    borderRadius: radii.R400,
  }),
]);

export const NoticeCritical = style(tinted(color.Critical));

// The text keeps a readable width; an action that does not fit beside it moves under it, at the end.
export const NoticeText = style({
  flex: `1 1 ${toRem(224)}`,
  minWidth: 0,
  overflowWrap: 'anywhere',
});

export const NoticeAction = style({ flexShrink: 0, marginInlineStart: 'auto' });

// The control bar under the tiles: a line about the transcript over the controls.
export const ControlBar = style(
  lined('column', '0', {
    flex: 'none',
    alignItems: 'center',
    padding: space.S300,
    borderBlockStart: hairline,
  })
);

// The controls, centred, wrapping on a narrow panel.
export const Controls = style(
  lined('row', space.S200, {
    flexWrap: 'wrap',
    placeContent: 'center',
    alignItems: 'center',
  })
);

// Empty, it takes no room; it stays in place so screen readers hear what it says next.
export const ControlsStatus = style({
  textAlign: 'center',
  selectors: { '&:not(:empty)': { marginBlockEnd: space.S200 } },
});

// "Paused by Ann", in the colors of the panel's warnings, like Pause while the call is paused. A
// user ID after the name wraps onto a line of its own rather than being cut (NameWithUserId).
export const ControlsPaused = style([
  tinted(color.Warning),
  {
    display: 'inline-flex',
    paddingBlock: toRem(2),
    flexWrap: 'wrap',
    paddingInline: space.S200,
    columnGap: space.S100,
    borderRadius: radii.R300,
    maxWidth: '100%',
  },
]);

export const DeviceMenu = style({
  minWidth: toRem(240),
  maxWidth: toRem(320),
  maxHeight: '60vh',
  overflowY: 'auto',
});

export const DeviceGroupLabel = style({
  paddingBlock: `${space.S200} ${space.S100}`,
  paddingInline: space.S300,
});

// Ending the call is the one solid control, so it is found without looking.
export const EndControl = style({
  background: color.Critical.Main,
  color: color.Critical.OnMain,
  selectors: {
    '&:hover, &:focus-visible': { background: color.Critical.MainHover },
    '&:active': { background: color.Critical.MainActive },
  },
});
