import { createContainer, globalStyle, style } from '@vanilla-extract/css';
import { color, config, toRem } from 'folds';
import { Header as SidePanelHeader, Panel as SidePanelPanel } from '../ui/panels/SidePanel.css';

export { Data, Error, Notice, Staged } from '../messages/canvas/canvasHost.css';

const canvasPanel = createContainer();

export const Panel = style([
  SidePanelPanel,
  {
    containerName: canvasPanel,
    containerType: 'inline-size',
  },
]);

export const Header = style([
  SidePanelHeader,
  {
    flexWrap: 'wrap',
    rowGap: config.space.S100,
  },
]);

export const TitleGroup = style({
  flex: '1 1 auto',
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
  flexShrink: 0,
  '@container': {
    [`${canvasPanel} (max-width: 380px)`]: {
      order: 1,
      flex: '1 0 100%',
    },
  },
});

export const VersionPill = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: toRem(2),
  padding: toRem(2),
  borderRadius: config.radii.R400,
  backgroundColor: color.SurfaceVariant.Container,
  border: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
});

globalStyle(`${VersionPill} button`, {
  minInlineSize: toRem(32),
  minBlockSize: toRem(32),
});

export const Version = style({
  whiteSpace: 'nowrap',
  paddingInline: config.space.S100,
});
