import { style } from '@vanilla-extract/css';
import { recipe } from '@vanilla-extract/recipes';
import { DefaultReset, color, config } from 'folds';

export const View = style({
  display: 'flex',
  flexDirection: 'column',
  flex: '1 1 auto',
  gap: config.space.S100,
  minWidth: 0,
  padding: `0 ${config.space.S300} ${config.space.S300}`,
  overflowY: 'auto',
  overflowX: 'hidden',
  width: '100%',
});

export const EmptyState = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '8rem',
  padding: config.space.S300,
  borderRadius: config.radii.R400,
  border: `${config.borderWidth.B300} dashed ${color.SurfaceVariant.ContainerLine}`,
  color: color.SurfaceVariant.OnContainer,
});

export const Card = style([
  DefaultReset,
  {
    display: 'flex',
    flexDirection: 'column',
    gap: config.space.S100,
    width: '100%',
    minWidth: 0,
    padding: `${config.space.S200} ${config.space.S300}`,
    borderRadius: config.radii.R400,
    border: `${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`,
    backgroundColor: color.Surface.Container,
    boxShadow: config.shadow.E100,
    color: color.Surface.OnContainer,
    textAlign: 'left',
    cursor: 'pointer',
    transition: 'background-color 120ms ease, border-color 120ms ease, box-shadow 120ms ease',
    ':hover': {
      backgroundColor: color.Surface.ContainerHover,
      boxShadow: config.shadow.E200,
    },
    ':focus-visible': {
      outline: `${config.borderWidth.B300} solid ${color.Primary.Main}`,
      outlineOffset: '1px',
    },
  },
]);

export const CardResolved = style({
  borderColor: color.Success.ContainerLine,
  backgroundColor: color.Success.Container,
  color: color.Success.OnContainer,
});

export const TitleRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S100,
  minWidth: 0,
  justifyContent: 'space-between',
});

export const TitleLead = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S100,
  minWidth: 0,
  flex: 1,
});

export const TitleText = style({
  minWidth: 0,
  flex: 1,
  overflowWrap: 'anywhere',
});

export const TimeText = style({
  whiteSpace: 'nowrap',
  flexShrink: 0,
});

export const MessageRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S100,
  minWidth: 0,
  justifyContent: 'space-between',
});

export const MessagePreview = style({
  display: 'flex',
  alignItems: 'center',
  minWidth: 0,
  flex: 1,
});

export const MessageText = style({
  minWidth: 0,
  flex: 1,
});

export const Stats = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S100,
  rowGap: config.space.S100,
  flexShrink: 0,
  flexWrap: 'wrap',
  justifyContent: 'flex-end',
});

export const StatBadge = style({
  flexShrink: 0,
  whiteSpace: 'nowrap',
});

export const ScheduledIndicator = style({
  minWidth: 0,
  flexShrink: 0,
  whiteSpace: 'nowrap',
});

export const MetadataRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S100,
  rowGap: config.space.S100,
  minWidth: 0,
  flexWrap: 'wrap',
});

export const Participants = style({
  display: 'flex',
  alignItems: 'center',
  flexShrink: 0,
});

export const ParticipantAvatar = style({
  flexShrink: 0,
});

export const StatusChip = style({
  flexShrink: 0,
});

export const UnreadWrap = style({
  flexShrink: 0,
  color: color.SurfaceVariant.OnContainer,
});

export const UnreadDot = style({
  display: 'inline-block',
});

export const ScreenReaderText = style({
  border: 0,
  clip: 'rect(0 0 0 0)',
  height: '1px',
  margin: '-1px',
  overflow: 'hidden',
  padding: 0,
  position: 'absolute',
  whiteSpace: 'nowrap',
  width: '1px',
});

export const AttentionDot = recipe({
  base: {
    width: '0.5rem',
    height: '0.5rem',
    borderRadius: '999px',
    flexShrink: 0,
  },
  variants: {
    state: {
      'needs-attention': {
        backgroundColor: color.Critical.Main,
      },
      waiting: {
        backgroundColor: color.Success.Main,
      },
      streaming: {
        backgroundColor: color.Primary.Main,
      },
      resolved: {
        backgroundColor: color.SurfaceVariant.OnContainer,
      },
      idle: {
        backgroundColor: color.SurfaceVariant.ContainerLine,
      },
    },
  },
});
