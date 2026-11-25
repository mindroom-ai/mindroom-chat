import { createContainer, globalStyle, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { Panel as SidePanelPanel } from '../ui/panels/SidePanel.css';

export { Data, Error, Notice, Staged } from '../messages/canvas/canvasHost.css';

const canvasPanel = createContainer();
// Wrap the version row before SidePanel.Header would push PanelHeaderControls onto row 2 (which
// would strand VersionSeparator at the end of row 1); expressed in rem so it scales with pageZoom.
const narrowPanel = `${canvasPanel} (max-width: 26rem)`;

export const Panel = style([
  SidePanelPanel,
  {
    containerName: canvasPanel,
    containerType: 'inline-size',
  },
]);

export { Header } from '../ui/panels/SidePanel.css';

export const TitleGroup = style({
  flex: '1 1 5rem',
  minWidth: 0,
});

export const Title = style({
  flex: '1 1 auto',
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
});

export const FrameWrap = style({
  flex: '1 1 auto',
  minHeight: 0,
  overflow: 'hidden',
  position: 'relative',
  width: '100%',
});

export const Frame = style({
  backgroundColor: color.Surface.Container,
  border: 'none',
  display: 'block',
  height: '100%',
  // eslint-disable-next-line no-restricted-syntax -- FrameWrap is dir=ltr so top-left stays the scale origin.
  left: 0,
  position: 'absolute',
  top: 0,
  width: '100%',
});

export const Footer = style({
  display: 'flex',
  flexDirection: 'column',
  flex: '0 0 auto',
  gap: config.space.S200,
  minHeight: '2.5rem',
  alignItems: 'flex-start',
  padding: `${config.space.S200} ${config.space.S300}`,
  paddingBottom: `calc(${config.space.S200} + env(safe-area-inset-bottom, 0px))`,
});

export const VersionRow = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: config.space.S200,
  flexShrink: 0,
  '@container': {
    [narrowPanel]: {
      order: 1,
      flex: '1 0 100%',
    },
  },
});

export const VersionPill = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: toRem(2),
});

globalStyle(`${VersionPill} button`, {
  minInlineSize: toRem(32),
  minBlockSize: toRem(32),
});

export const VersionSeparator = style({
  inlineSize: config.borderWidth.B300,
  blockSize: toRem(16),
  flexShrink: 0,
  backgroundColor: color.Surface.ContainerLine,
  selectors: {
    [`${VersionRow}:last-child &`]: { display: 'none' },
  },
  '@container': {
    [narrowPanel]: { display: 'none' },
  },
});

export const Version = style({
  whiteSpace: 'nowrap',
  paddingInline: toRem(2),
  fontVariantNumeric: 'tabular-nums',
});
