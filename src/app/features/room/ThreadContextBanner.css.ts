import { style } from '@vanilla-extract/css';
import { config, color } from 'folds';

export const Banner = style({
  padding: `${config.space.S400} ${config.space.S400}`,
  backgroundColor: color.SurfaceVariant.Container,
  borderBottom: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
});

export const TitleRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S300,
  minHeight: '1.5rem',
});

export const TitleColumn = style({
  display: 'flex',
  flexDirection: 'column',
  flexGrow: 1,
  minWidth: 0,
  gap: 0,
});

export const TagsRow = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.3rem',
  flexWrap: 'nowrap',
  overflow: 'hidden',
});

export const SubtitleRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: config.space.S100,
  marginTop: config.space.S100,
  minWidth: 0,
  flexWrap: 'wrap',
});

export const ResolveChip = style({
  marginLeft: 'auto',
  flexShrink: 0,
});

export const OverflowChip = style({
  display: 'inline-flex',
  alignItems: 'center',
  fontSize: '0.65rem',
  fontWeight: 500,
  padding: '0.1rem 0.4rem',
  borderRadius: '0.5rem',
  background: 'rgba(128, 128, 128, 0.2)',
  cursor: 'default',
  border: 'none',
  lineHeight: 1.4,
  whiteSpace: 'nowrap',
  verticalAlign: 'middle',
});

/**
 * Desktop: tags inline on title row (hidden below).
 * Mobile (<480px): tags hidden on title row, shown in a dedicated row below.
 */
export const DesktopOnlyTags = style({
  '@media': {
    '(max-width: 480px)': {
      display: 'none',
    },
  },
});

export const MobileOnlyTags = style({
  display: 'none',
  '@media': {
    '(max-width: 480px)': {
      display: 'flex',
      flexWrap: 'wrap',
      gap: '0.3rem',
      marginTop: config.space.S100,
    },
  },
});

export const SummaryText = style({
  display: 'block',
  minWidth: 0,
  flex: '1 1 0',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const ScheduledWrap = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: config.space.S100,
  minWidth: 0,
  flexShrink: 0,
});

export const MetadataDot = style({
  flexShrink: 0,
});

export const ScheduledIndicator = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: config.space.S100,
  minWidth: 0,
  flexShrink: 0,
  whiteSpace: 'nowrap',
});

export const BannerResolved = style({
  padding: `${config.space.S400} ${config.space.S400}`,
  backgroundColor: color.Success.Container,
  borderBottom: `${config.borderWidth.B300} solid ${color.Success.ContainerLine}`,
  color: color.Success.OnContainer,
});

export const BannerDisabled = style({
  opacity: 0.6,
  pointerEvents: 'none',
});

export const TagPickerInputContainer = style({
  borderBottom: `${config.borderWidth.B300} solid ${color.SurfaceVariant.ContainerLine}`,
  padding: `0 ${config.space.S100}`,
});

export const TagPickerInput = style({
  width: '100%',
  display: 'block',
  padding: `${config.space.S200} ${config.space.S300}`,
  border: 'none',
  outline: 'none',
  font: 'inherit',
  fontSize: '0.8rem',
  lineHeight: 1.4,
  background: 'transparent',
  color: color.SurfaceVariant.OnContainer,
  caretColor: color.SurfaceVariant.OnContainer,
  selectors: {
    '&::placeholder': {
      color: color.SurfaceVariant.OnContainer,
      opacity: '0.5',
    },
    '&:focus::placeholder': {
      opacity: '0',
    },
  },
});
