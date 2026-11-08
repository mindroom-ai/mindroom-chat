import { createContainer, keyframes, style, type StyleRule } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { Header as SidePanelHeader, Panel as SidePanelPanel } from '../ui/panels/SidePanel.css';

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

// The floating window draws the edge around the call view; the side column's start line would
// double it.
export const InWindow = style({ borderInlineStart: 'none' });

// The title bar answers its own width: one too narrow for a readable title beside all five buttons
// (176 px with their gaps) drops the speaker switch first.
const titleBar = createContainer();
const TITLE_BAR_CROWDED = `${titleBar} (max-width: 280px)`;

export const Header = style([
  SidePanelHeader,
  { containerType: 'inline-size', containerName: titleBar },
]);

// The window's corner grips reach 10 px in for a mouse and 18 px for a finger
// (FloatingCallWindow.css.ts); the end button of the title bar and the bar keeps clear of them.
const clearOfGrips: StyleRule = {
  paddingInlineEnd: space.S300,
  '@media': { '(pointer: coarse)': { paddingInlineEnd: space.S500 } },
};

export const WindowHeader = style(clearOfGrips);

export const HeaderTitle = style(lined('column', '0', { minWidth: 0, flex: '1 1 auto' }));

export const HeaderButtons = style(
  lined('row', space.S100, { flexShrink: 0, alignItems: 'center' })
);

export const SpeakerSwitch = style({ '@container': { [TITLE_BAR_CROWDED]: { display: 'none' } } });

// The minimized window: the others' faces, the title and status, the microphone and leave (or
// Close once the call is over), Expand and Close on one line that moves the window as the title
// bar does. Its end keeps clear of the window's resize grips, as the title bar's does.
export const Bar = style([
  lined('row', space.S200, { alignItems: 'center', paddingInlineStart: space.S300 }),
  clearOfGrips,
  { flex: '1 1 auto', minWidth: 0 },
]);

export const BarFaces = style(
  lined('row', space.S100, { flexShrink: 0, margin: 0, padding: 0, listStyle: 'none' })
);

// Round like the avatar it holds, and ringed in the call's green while its person talks, as on
// the stage.
const talking = { boxShadow: `0 0 0 ${toRem(2)} ${color.Success.Main}` };
export const BarFace = style({
  display: 'flex',
  selectors: { '&[data-speaking="true"]': talking },
  borderRadius: '50%',
});

export const Body = style(
  lined('column', space.S300, {
    flex: '1 1 auto',
    minHeight: 0,
    overflowY: 'auto',
    padding: space.S300,
  })
);

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

// The name sits on a dark scrim, readable on video and on the plain tile alike.
export const TileLabel = style(
  lined('row', space.S100, {
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

export const TileStatus = style({
  position: 'absolute',
  insetBlockStart: space.S100,
  insetInline: space.S100,
  textAlign: 'center',
});

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

// The control bar under the tiles, centred, wrapping on a narrow panel.
export const Controls = style(
  lined('row', space.S200, {
    flex: 'none',
    flexWrap: 'wrap',
    placeContent: 'center',
    alignItems: 'center',
    padding: space.S300,
    borderBlockStart: hairline,
  })
);

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
