import { createContainer, globalStyle, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { Header as SidePanelHeader, Panel as SidePanelPanel } from '../sidebar/SidePanel.css';

// The panel's own size picks the layout, so it follows the window, Expand and the resize handle.
const panel = createContainer('computerPanel');

// From about the screen's 16:10 shape, the controls below the screen cost it more height than a
// column beside it costs in width, so the screen takes the full height. Measured, the crossover
// is about 3:2. A panel under 28rem tall, a phone in landscape, is too short for the screen's
// 15rem minimum and the controls below it once the Agent select shows, so 5:4 is enough there.
const sideBySide = `${panel} (min-aspect-ratio: 3/2) or ((max-height: 28rem) and (min-aspect-ratio: 5/4))`;

// As wide as the header needs, wider on a big panel, where the screen is limited by height.
const sideColumnWidth = `minmax(min-content, clamp(${toRem(176)}, 22cqw, ${toRem(256)}))`;
const sideColumnEnd = `calc(${config.space.S300} + env(safe-area-inset-right, 0px))`;

// The panel sizes from its column or, on phones, the viewport, never from its content, so it can
// be a size container without collapsing.
export const Panel = style([
  SidePanelPanel,
  {
    containerName: panel,
    containerType: 'size',
  },
]);

export const Layout = style({
  display: 'flex',
  flex: '1 1 auto',
  flexDirection: 'column',
  minHeight: 0,
  '@container': {
    [sideBySide]: {
      display: 'grid',
      gridTemplateAreas: '"screen header" "screen agent" "screen details"',
      gridTemplateColumns: `minmax(0, 1fr) ${sideColumnWidth}`,
      gridTemplateRows: 'auto auto minmax(0, 1fr)',
    },
  },
});

export const Header = style([
  SidePanelHeader,
  {
    '@container': {
      [sideBySide]: { gridArea: 'header', paddingRight: sideColumnEnd },
    },
  },
]);

export const Body = style({
  display: 'flex',
  flex: '1 1 auto',
  flexDirection: 'column',
  gap: config.space.S300,
  minHeight: 0,
  padding: config.space.S300,
  '@container': {
    // Its children join the panel's grid: the screen on one side, the controls on the other.
    [sideBySide]: { display: 'contents' },
  },
});

export const AgentField = style({
  '@container': {
    [sideBySide]: {
      gridArea: 'agent',
      padding: `${config.space.S300} ${sideColumnEnd} 0 ${config.space.S300}`,
    },
  },
});

// The screen, or the spinner while it connects: the full height, clear of the home indicator.
export const ScreenArea = style({
  '@container': {
    [sideBySide]: {
      gridArea: 'screen',
      margin: [
        `max(${config.space.S300}, env(safe-area-inset-top, 0px))`,
        '0',
        `max(${config.space.S300}, env(safe-area-inset-bottom, 0px))`,
        config.space.S300,
      ].join(' '),
    },
  },
});

export const ScreenFrame = style([
  ScreenArea,
  {
    alignItems: 'center',
    background: '#111',
    borderRadius: config.radii.R300,
    display: 'flex',
    flex: '1 1 auto',
    justifyContent: 'center',
    minHeight: toRem(240),
    overflow: 'hidden',
    '@container': {
      [sideBySide]: { minHeight: 0 },
    },
  },
]);

export const Screen = style({
  alignItems: 'center',
  display: 'flex',
  height: '100%',
  justifyContent: 'center',
  minHeight: 0,
  outline: 'none',
  width: '100%',
  selectors: {
    '&:focus-visible': {
      boxShadow: `inset 0 0 0 ${config.borderWidth.B300} ${color.Primary.Main}`,
    },
  },
});

// While in control, touches drive the touchpad, so the browser neither scrolls nor zooms.
export const ScreenInControl = style({
  touchAction: 'none',
});

globalStyle(`${Screen} canvas`, {
  maxHeight: '100%',
  maxWidth: '100%',
});

// Status, notices and actions: below the screen, or the rest of the side column, which scrolls
// on its own when they do not fit.
export const Details = style({
  display: 'flex',
  flexDirection: 'column',
  gap: config.space.S300,
  '@container': {
    [sideBySide]: {
      gridArea: 'details',
      minHeight: 0,
      overflowWrap: 'anywhere',
      overflowY: 'auto',
      padding: `${config.space.S300} ${sideColumnEnd} ${config.space.S300} ${config.space.S300}`,
    },
  },
});

export const Status = style({
  color: color.Surface.OnContainer,
});

export const Error = style({
  color: color.Critical.Main,
});

export const Actions = style({
  display: 'flex',
  flex: '0 0 auto',
  flexWrap: 'wrap',
  gap: config.space.S200,
  paddingBottom: 'env(safe-area-inset-bottom, 0px)',
});

export const AgentSelect = style({
  background: color.SurfaceVariant.Container,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  borderRadius: config.radii.R300,
  color: color.SurfaceVariant.OnContainer,
  font: 'inherit',
  maxWidth: '100%',
  padding: `${config.space.S200} ${config.space.S300}`,
  '@container': {
    // A long agent name fills the column instead of widening it.
    [sideBySide]: { width: '100%' },
  },
});
